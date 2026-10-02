"use server";

import { revalidatePath } from "next/cache";
import { AdminError, requireAdmin } from "@/lib/admin";
import { retryEmail } from "@/lib/admin-desk";
import { approveApplication, rejectApplication, requestApplicationInfo } from "@/lib/applications";
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
import { savePlatformSettings } from "@/lib/platform-settings";
import { runRetention } from "@/lib/retention";
import {
  adminCreateOrgSchema,
  adminOrgBasicsSchema,
  feePercentSchema,
  platformSettingsSchema,
  teamInviteSchema,
} from "@/lib/validations";

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

/* Applications */

export async function approveApplicationAction(id: string): Promise<Result<{ organizationId: string }>> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  return run(() => approveApplication(id, a), "Approved — the owner has been emailed");
}

export async function rejectApplicationAction(id: string, reason: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  if (reason.trim().length < 5) return err("Tell them why (at least 5 characters).");
  return run(() => rejectApplication(id, reason.trim().slice(0, 2000), a.id), "Rejected — the applicant has been emailed");
}

export async function requestApplicationInfoAction(id: string, message: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  if (message.trim().length < 5) return err("Write your question (at least 5 characters).");
  return run(() => requestApplicationInfo(id, message.trim().slice(0, 2000), a.id), "Question sent to the applicant");
}

export async function retryEmailAction(id: string): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  return run(async () => {
    if (!(await retryEmail(id))) throw new TxAbort("That email is no longer failed.");
  }, "Queued to send again");
}

export async function savePlatformSettingsAction(formData: FormData): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  const parsed = platformSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const v = parsed.data;
  return run(
    () =>
      savePlatformSettings(
        {
          defaultFeeBps: v.defaultFee,
          defaultRetentionMonths: v.defaultRetentionMonths,
          gst: {
            legalName: v.legalName,
            tradeName: v.tradeName,
            gstin: v.gstin,
            pan: v.pan,
            address: v.address,
            state: v.state,
            stateCode: v.stateCode,
            sac: v.sac,
            rateBps: v.gstRate,
            splitRule: v.splitRule,
            invoicePrefix: v.invoicePrefix,
            footerText: v.footerText,
          },
        },
        a.id,
      ),
    "Settings saved",
  );
}

export async function runRetentionAction(): Promise<Result> {
  const a = await admin();
  if ("error" in a) return err(a.error);
  return run(async () => {
    const r = await runRetention({ trigger: "ADMIN", actorId: a.id });
    if (!r.ran) throw new TxAbort("A retention run is already in progress.");
  }, "Retention run finished");
}
