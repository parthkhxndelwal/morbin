"use server";

import { revalidatePath } from "next/cache";
import { orgActor, type OrgActor } from "@/lib/action-guards";
import { err, ok, zodFieldErrors, type Result } from "@/lib/result";
import { inviteToTeam, removeFromTeam, resendInvite, revokeInvite, type InviteOutcome } from "@/lib/team";
import { TxAbort } from "@/lib/tx";
import { teamInviteSchema } from "@/lib/validations";

/**
 * Team management for `/dashboard/team`. Owner-only (`manageTeam`); every rule
 * — one organisation per person, the owner can't be removed, resend limits —
 * lives in `lib/team`, and these only authorise, validate and report.
 */

function actorOf(a: OrgActor) {
  return { organizationId: a.orgId, userId: a.userId, role: a.role };
}

async function run<T>(fn: () => Promise<T>, message: string | ((data: T) => string)): Promise<Result<T>> {
  try {
    const data = await fn();
    revalidatePath("/dashboard/team");
    return ok(data, typeof message === "string" ? message : message(data));
  } catch (error) {
    if (error instanceof TxAbort) return err(error.message);
    console.error("[team:action]", error);
    return err("Something went wrong. Please try again.");
  }
}

export async function inviteMemberAction(formData: FormData): Promise<Result<InviteOutcome>> {
  const guard = await orgActor("manageTeam");
  if ("error" in guard) return err(guard.error);
  const parsed = teamInviteSchema.safeParse({
    email: formData.get("email") ?? "",
    name: formData.get("name") ?? "",
  });
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  return run(
    () => inviteToTeam(actorOf(guard.actor), parsed.data),
    (o) => (o.kind === "added" ? `${o.email} added to your team` : `Invite sent to ${o.email}`),
  );
}

export async function resendInviteAction(inviteId: string): Promise<Result> {
  const guard = await orgActor("manageTeam");
  if ("error" in guard) return err(guard.error);
  return run(() => resendInvite(actorOf(guard.actor), inviteId), "Invite sent again with a fresh link");
}

// Taking access away must always work, even for a suspended organisation.
export async function revokeInviteAction(inviteId: string): Promise<Result> {
  const guard = await orgActor("manageTeam", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  return run(() => revokeInvite(actorOf(guard.actor), inviteId), "Invite revoked");
}

export async function removeMemberAction(userId: string): Promise<Result> {
  const guard = await orgActor("manageTeam", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  return run(() => removeFromTeam(actorOf(guard.actor), userId), "Removed from your team");
}
