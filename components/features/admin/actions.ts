"use server";

import { revalidatePath } from "next/cache";
import { AdminError, requireAdmin } from "@/lib/admin";
import {
  createOrganization,
  deleteUnusedOrganization,
  resendOwnerSetup,
  setOrganizationFee,
  setOrganizationRetention,
  setOrganizationSuspended,
  updateOrganizationBasics,
} from "@/lib/admin-orgs";
import { err, ok, zodFieldErrors, type Result } from "@/lib/result";
import { inviteToTeam, removeFromTeam, revokeInvite, type InviteOutcome } from "@/lib/team";
import { TxAbort } from "@/lib/tx";
import { adminCreateOrgSchema, adminOrgBasicsSchema, feePercentSchema, teamInviteSchema } from "@/lib/validations";

/**
 * Morbin admin actions on organisations. Each re-checks the admin role on the
 * server; the rules live in lib/admin-orgs and lib/team.
 */

async function admin(): Promise<{ id: string; email: string } | { error: string }> {
  try {
    return await requireAdmin();
  } catch (error) {
    return { error: error instanceof AdminError ? error.message : "Forbidden" };
  }
}

async function run<T>(fn: () => Promise<T>, message: string | ((d: T) => string)): Promise<Result<T>> {
  try {
    const data = await fn();
    revalidatePath("/dashboard/admin", "layout");
    return ok(data, typeof message === "string" ? message : message(data));
  } catch (error) {
    if (error instanceof TxAbort || error instanceof AdminError) return err(error.message);
    console.error("[admin:action]", error);
    return err("Something went wrong. Please try again.");
  }
}

export async function createOrganizationAction(formData: FormData): Promise<Result<{ id: string }>> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  const parsed = adminCreateOrgSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  return run(
    async () => ({ id: (await createOrganization(parsed.data, a)).id }),
    "Organisation created",
  );
}

export async function updateOrganizationAction(id: string, formData: FormData): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  const parsed = adminOrgBasicsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  return run(() => updateOrganizationBasics(id, parsed.data, a.id), "Organisation updated");
}

export async function setFeeAction(id: string, formData: FormData): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  const parsed = feePercentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  return run(() => setOrganizationFee(id, parsed.data.fee, parsed.data.note, a.id), "Fee updated — the owner has been told");
}

export async function setRetentionAction(id: string, months: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  const value = months.trim() === "" ? null : Number(months);
  if (value !== null && !Number.isInteger(value)) return err("Enter a whole number of months.");
  return run(() => setOrganizationRetention(id, value, a.id), "Retention updated");
}

export async function setSuspendedAction(id: string, suspended: boolean): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  return run(() => setOrganizationSuspended(id, suspended, a.id), suspended ? "Organisation suspended" : "Organisation restored");
}

export async function deleteOrganizationAction(id: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  return run(() => deleteUnusedOrganization(id, a.id), "Organisation deleted");
}

export async function resendOwnerSetupAction(id: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  return run(() => resendOwnerSetup(id), "Setup link sent to the owner");
}

/* Members, as support */

export async function adminInviteMemberAction(organizationId: string, formData: FormData): Promise<Result<InviteOutcome>> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  const parsed = teamInviteSchema.safeParse({ email: formData.get("email") ?? "", name: formData.get("name") ?? "" });
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  return run(
    () => inviteToTeam({ organizationId, userId: a.id, role: "ADMIN" }, parsed.data),
    (o) => (o.kind === "added" ? `${o.email} added` : `Invite sent to ${o.email}`),
  );
}

export async function adminRemoveMemberAction(organizationId: string, userId: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  return run(() => removeFromTeam({ organizationId, userId: a.id, role: "ADMIN" }, userId), "Member removed");
}

export async function adminRevokeInviteAction(organizationId: string, inviteId: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  return run(() => revokeInvite({ organizationId, userId: a.id, role: "ADMIN" }, inviteId), "Invite revoked");
}
