"use server";

import { revalidatePath } from "next/cache";
import { orgActor } from "@/lib/action-guards";
import { audit } from "@/lib/audit";
import { getDb, toObjectId } from "@/lib/db";
import {
  getPayoutAccountView,
  isEncryptionNotConfigured,
  savePayoutAccount,
} from "@/lib/payout-accounts";
import { err, ok, zodFieldErrors, type Result } from "@/lib/result";
import type { FeeBearer } from "@/lib/pricing";
import type { Organization } from "@/lib/types";
import {
  feeBearerSchema,
  orgProfileSchema,
  payoutAccountSchema,
} from "@/lib/validations";

/**
 * Server actions for `/dashboard/settings`.
 *
 * Each one re-authorises through `orgActor("finance")` — the `finance`
 * capability is owner-only — validates the FormData with the same zod schema
 * the form was written against, writes only the fields it owns, records the
 * change in the audit log, and returns a `Result` rather than throwing.
 *
 * Two invariants worth stating: the fee *rate* is never written here (only the
 * admin sets it, so no form posts it and no action reads it), and the payout
 * account number is passed straight to `lib/payout-accounts`, which refuses to
 * store it unencrypted.
 */

const INVALID = "Check the highlighted fields.";

/** A validation failure that belongs on one field, thrown from inside `run`. */
class FieldAbort extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
  }
}

async function run<T>(fn: () => Promise<T>, message?: string): Promise<Result<T>> {
  try {
    const data = await fn();
    revalidatePath("/dashboard/settings");
    // The organisation's name sits in the sidebar of every dashboard page.
    revalidatePath("/dashboard", "layout");
    return ok(data, message);
  } catch (error) {
    if (error instanceof FieldAbort) return err(error.message, { [error.field]: error.message });
    if (isEncryptionNotConfigured(error)) return err(error.message);
    console.error("[settings:action]", error);
    return err("Something went wrong. Please try again.");
  }
}

/** Edit the organisation's profile: name, contact details, GSTIN, address. */
export async function updateOrgProfileAction(formData: FormData): Promise<Result> {
  const guard = await orgActor("finance");
  if ("error" in guard) return err(guard.error);
  const parsed = orgProfileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err(INVALID, zodFieldErrors(parsed.error.issues));
  const v = parsed.data;

  return run(async () => {
    const db = await getDb();
    await db.collection<Organization>("organizations").updateOne(
      { _id: toObjectId(guard.actor.orgId) as never },
      {
        $set: {
          name: v.name,
          contactEmail: v.contactEmail,
          contactPhone: v.contactPhone,
          gstin: v.gstin,
          address: v.address,
          updatedAt: new Date(),
        },
      },
    );
    await audit({
      actorId: guard.actor.userId,
      actorRole: guard.actor.role,
      action: "organization.profile.updated",
      targetType: "organization",
      targetId: guard.actor.orgId,
      organizationId: guard.actor.orgId,
      // Field names only: an audit log is a durable record and must never hold
      // the values it describes.
      meta: { fields: ["name", "contactEmail", "contactPhone", "gstin", "address"] },
    });
  }, "Organisation profile saved");
}

/** Choose who bears the convenience fee. The rate stays admin-set and read-only. */
export async function setFeeBearerAction(formData: FormData): Promise<Result> {
  const guard = await orgActor("finance");
  if ("error" in guard) return err(guard.error);
  const parsed = feeBearerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err(INVALID, zodFieldErrors(parsed.error.issues));
  const next: FeeBearer = parsed.data.feeBearer;

  return run(async () => {
    const db = await getDb();
    await db.collection<Organization>("organizations").updateOne(
      { _id: toObjectId(guard.actor.orgId) as never },
      { $set: { feeBearer: next, updatedAt: new Date() } },
    );
    await audit({
      actorId: guard.actor.userId,
      actorRole: guard.actor.role,
      action: "organization.feeBearer.updated",
      targetType: "organization",
      targetId: guard.actor.orgId,
      organizationId: guard.actor.orgId,
      meta: { from: guard.actor.org.feeBearer ?? "ORGANISER", to: next },
    });
  }, next === "CUSTOMER" ? "Buyers will pay the fee" : "Your organisation absorbs the fee");
}

/**
 * Save the payout bank details. A blank account number keeps the stored one, so
 * the owner can fix a name or IFSC without re-entering (and re-transmitting) an
 * account number the server already holds sealed.
 */
export async function savePayoutAccountAction(
  formData: FormData,
): Promise<Result<{ last4: string; rotated: boolean }>> {
  const guard = await orgActor("finance");
  if ("error" in guard) return err(guard.error);
  const parsed = payoutAccountSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err(INVALID, zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  const rotated = v.accountNumber !== null;

  return run(async () => {
    // Read inside the guarded block: a blank number only means "keep the stored
    // one" if there *is* one.
    const existing = await getPayoutAccountView(guard.actor.orgId);
    if (!rotated && !existing) throw new FieldAbort("accountNumber", "Enter the account number");

    const view = await savePayoutAccount(guard.actor.orgId, {
      accountName: v.accountName,
      ifsc: v.ifsc,
      accountNumber: v.accountNumber,
    });
    await audit({
      actorId: guard.actor.userId,
      actorRole: guard.actor.role,
      action: "organization.payoutAccount.updated",
      targetType: "organization",
      targetId: guard.actor.orgId,
      organizationId: guard.actor.orgId,
      // `rotated` only — the account number is never written to a log, and its
      // last four digits are recorded on the payout account itself.
      meta: { rotated, first: existing === null },
    });
    return { last4: view.last4, rotated };
  }, rotated ? "Payout bank details saved" : "Payout bank details updated");
}

/** "Support changes need my approval": Morbin support prepares, the owner makes it live. */
export async function setSupportApprovalAction(on: boolean): Promise<Result> {
  const guard = await orgActor("finance", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  return run(async () => {
    const db = await getDb();
    await db
      .collection<Organization>("organizations")
      .updateOne({ _id: toObjectId(guard.actor.orgId) as never }, { $set: { requireApprovalForSupportChanges: on, updatedAt: new Date() } });
    await audit({
      actorId: guard.actor.userId,
      actorRole: guard.actor.role,
      action: "organization.supportApproval.changed",
      targetType: "organization",
      targetId: guard.actor.orgId,
      organizationId: guard.actor.orgId,
      meta: { on },
    });
  }, on ? "Support changes now need your approval" : "Support can make changes directly");
}
