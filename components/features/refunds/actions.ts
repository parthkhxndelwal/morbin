"use server";

import { revalidatePath } from "next/cache";
import { AdminError, requireAdmin } from "@/lib/admin";
import { orgActor } from "@/lib/action-guards";
import {
  approveRefund,
  cancelRefundRequest,
  completeRefundManually,
  dispatchRefund,
  markSettledByOrg,
  rejectRefund,
} from "@/lib/refunds";
import { err, ok, type Result } from "@/lib/result";
import { TxAbort } from "@/lib/tx";

async function run(fn: () => Promise<unknown>, message: string): Promise<Result> {
  try {
    await fn();
    revalidatePath("/dashboard", "layout");
    return ok(undefined, message);
  } catch (error) {
    if (error instanceof TxAbort || error instanceof AdminError) return err(error.message);
    console.error("[refunds:action]", error);
    return err("Something went wrong. Please try again.");
  }
}

/* Organisation owner */

export async function withdrawRefundAction(caseId: string): Promise<Result> {
  const guard = await orgActor("refund", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  return run(() => cancelRefundRequest(guard.actor.orgId, caseId, guard.actor.userId), "Refund request withdrawn");
}

export async function markSettledAction(caseId: string, reference: string): Promise<Result> {
  const guard = await orgActor("refund", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  if (reference.trim().length < 3) return err("Enter the payment reference you used (UTR, UPI ref, receipt no.).");
  return run(
    () => markSettledByOrg(guard.actor.orgId, caseId, guard.actor.userId, reference.trim().slice(0, 120)),
    "Marked as settled",
  );
}

/* Morbin admin */

async function admin() {
  try {
    return { admin: await requireAdmin() };
  } catch (error) {
    return { error: error instanceof AdminError ? error.message : "Forbidden" };
  }
}

export async function approveRefundAction(caseId: string, note: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error!);
  return run(() => approveRefund(caseId, a.admin.id, note), "Refund approved");
}

export async function rejectRefundAction(caseId: string, note: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error!);
  if (note.trim().length < 5) return err("Tell the organisation why (at least 5 characters).");
  return run(() => rejectRefund(caseId, a.admin.id, note), "Refund rejected");
}

export async function retryRefundAction(caseId: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error!);
  return run(() => dispatchRefund(caseId), "Refund sent to Razorpay");
}

export async function completeManuallyAction(caseId: string, reference: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error!);
  if (reference.trim().length < 3) return err("Enter the bank transfer reference.");
  return run(() => completeRefundManually(caseId, a.admin.id, reference.trim().slice(0, 120)), "Marked as refunded");
}
