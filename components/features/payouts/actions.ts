"use server";

import { revalidatePath } from "next/cache";
import { AdminError, requireAdmin } from "@/lib/admin";
import { orgActor } from "@/lib/action-guards";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents";
import { issueOrgFeeInvoice } from "@/lib/invoices";
import { isEncryptionNotConfigured, revealPayoutAccountNumber, verifyPayoutAccount } from "@/lib/payout-accounts";
import {
  acknowledgePayout,
  cancelPayout,
  issuePayout,
  markPayoutPaid,
  previewPayout,
  raisePayoutQuery,
  replacePayoutStatement,
  replyToPayoutQuery,
} from "@/lib/payouts";
import { err, ok, type Result } from "@/lib/result";
import { TxAbort } from "@/lib/tx";
import type { PayoutTotals } from "@/lib/types";
import { parseLocalDateTime } from "@/lib/validations";

async function run<T>(fn: () => Promise<T>, message?: string): Promise<Result<T>> {
  try {
    const data = await fn();
    revalidatePath("/dashboard", "layout");
    return ok(data, message);
  } catch (error) {
    if (error instanceof TxAbort || error instanceof AdminError) return err(error.message);
    console.error("[payouts:action]", error);
    return err(error instanceof Error ? error.message : "Something went wrong. Please try again.");
  }
}

/* Organisation owner */

export async function acknowledgePayoutAction(id: string): Promise<Result> {
  const guard = await orgActor("finance", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  return run(() => acknowledgePayout(guard.actor.orgId, id, guard.actor.userId), "Payout acknowledged");
}

export async function raiseQueryAction(id: string, message: string): Promise<Result> {
  const guard = await orgActor("finance", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  return run(() => raisePayoutQuery(guard.actor.orgId, id, guard.actor.userId, message.slice(0, 2000)), "Query sent to Morbin");
}

/* Morbin admin */

async function adminId(): Promise<string | { error: string }> {
  try {
    return (await requireAdmin()).id;
  } catch (error) {
    return { error: error instanceof AdminError ? error.message : "Forbidden" };
  }
}

function cutoffFrom(value: string): Date | null {
  if (!value) return new Date();
  return parseLocalDateTime(value);
}

export async function previewPayoutAction(
  organizationId: string,
  cutoff: string,
): Promise<Result<{ totals: PayoutTotals; count: number }>> {
  const a = await adminId();
  if (typeof a !== "string") return err(a.error);
  const at = cutoffFrom(cutoff);
  if (!at) return err("Enter a valid cut-off.");
  return run(() => previewPayout(organizationId, at));
}

export async function issuePayoutAction(organizationId: string, formData: FormData): Promise<Result<{ id: string }>> {
  const a = await adminId();
  if (typeof a !== "string") return err(a.error);
  const at = cutoffFrom(String(formData.get("cutoff") ?? ""));
  if (!at) return err("Check the cut-off.", { cutoff: "Enter a valid date and time" });
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  return run(async () => {
    const p = await issuePayout({ organizationId, cutoff: at, note, adminId: a });
    return { id: p._id!.toString() };
  }, "Draft payout created");
}

export async function cancelPayoutAction(id: string): Promise<Result> {
  const a = await adminId();
  if (typeof a !== "string") return err(a.error);
  return run(() => cancelPayout(id, a), "Payout cancelled");
}

async function pdfFrom(formData: FormData): Promise<{ fileName: string; body: Buffer } | string> {
  const file = formData.get("statement");
  if (!(file instanceof File) || file.size === 0) return "Attach the settlement statement (PDF).";
  if (file.size > MAX_DOCUMENT_BYTES) return "The statement must be under 10 MB.";
  return { fileName: file.name, body: Buffer.from(await file.arrayBuffer()) };
}

export async function markPayoutPaidAction(id: string, formData: FormData): Promise<Result> {
  const a = await adminId();
  if (typeof a !== "string") return err(a.error);
  const statement = await pdfFrom(formData);
  if (typeof statement === "string") return err(statement, { statement });
  const bankReference = String(formData.get("bankReference") ?? "").trim();
  if (bankReference.length < 4) return err("Check the highlighted fields.", { bankReference: "Enter the UTR / transfer reference" });
  const transferredAt = parseLocalDateTime(String(formData.get("transferredAt") ?? ""));
  if (!transferredAt) return err("Check the highlighted fields.", { transferredAt: "Enter when the transfer was made" });
  return run(
    async () => {
      await markPayoutPaid({ id, adminId: a, bankReference: bankReference.slice(0, 80), transferredAt, statement });
    },
    "Payout marked paid — the organisation has been notified",
  );
}

/** Retry the ORG_FEE invoice for a paid payout (e.g. after GST settings were completed). */
export async function issueFeeInvoiceAction(id: string): Promise<Result> {
  const a = await adminId();
  if (typeof a !== "string") return err(a.error);
  return run(async () => {
    const invoice = await issueOrgFeeInvoice(id);
    if (!invoice) throw new TxAbort("No invoice is due, or Morbin's GST details in Admin → Settings are incomplete.");
  }, "Fee invoice issued");
}

export async function replyToQueryAction(id: string, formData: FormData): Promise<Result> {
  const a = await adminId();
  if (typeof a !== "string") return err(a.error);
  const message = String(formData.get("message") ?? "").trim();
  if (message.length < 2) return err("Check the highlighted fields.", { message: "Write a reply" });
  const raw = String(formData.get("adjustment") ?? "").replace(/[₹,\s]/g, "");
  let adjustmentPaise = 0;
  if (raw) {
    if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) return err("Check the highlighted fields.", { adjustment: "Enter an amount like 250 or -250" });
    adjustmentPaise = Math.round(Number(raw) * 100);
  }
  const resolve = formData.get("resolve") === "on";
  return run(
    () => replyToPayoutQuery({ id, adminId: a, message: message.slice(0, 2000), resolve, adjustmentPaise }),
    resolve ? "Reply sent and query resolved" : "Reply sent",
  );
}

export async function replaceStatementAction(id: string, formData: FormData): Promise<Result> {
  const a = await adminId();
  if (typeof a !== "string") return err(a.error);
  const statement = await pdfFrom(formData);
  if (typeof statement === "string") return err(statement, { statement });
  return run(() => replacePayoutStatement({ id, adminId: a, statement }), "Statement replaced");
}

/** The full account number for making the transfer. Audited on every call. */
export async function revealAccountNumberAction(organizationId: string): Promise<Result<string>> {
  const a = await adminId();
  if (typeof a !== "string") return err(a.error);
  try {
    const number = await revealPayoutAccountNumber(organizationId, a);
    return number ? ok(number) : err("No payout account on file.");
  } catch (error) {
    if (isEncryptionNotConfigured(error)) return err(error.message);
    console.error("[payouts:reveal]", error);
    return err("The account number couldn't be read. Ask the organisation to re-enter it.");
  }
}

export async function verifyAccountAction(organizationId: string): Promise<Result> {
  const a = await adminId();
  if (typeof a !== "string") return err(a.error);
  return run(async () => {
    if (!(await verifyPayoutAccount(organizationId, a))) throw new TxAbort("Already verified, or no account on file.");
  }, "Payout account marked verified");
}
