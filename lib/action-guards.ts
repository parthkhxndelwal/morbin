import { auth } from "@/lib/auth";
import { getOrgForUser } from "@/lib/organizations";
import { can, type Capability } from "@/lib/permissions";
import type { Organization, OrgRole } from "@/lib/types";
import type { ObjectId } from "mongodb";

export interface OrgActor {
  userId: string;
  org: Organization & { _id: ObjectId };
  orgId: string;
  role: OrgRole;
}

/**
 * Authorise a server action for the caller's organisation.
 *
 * Returns a message instead of redirecting or throwing, so the action can hand
 * it back as `err(...)` and the dialog shows it in place. Suspended
 * organisations can still read, but not change, anything that sells.
 */
export async function orgActor(
  capability: Capability,
  opts: { allowSuspended?: boolean } = {},
): Promise<{ actor: OrgActor } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Your session has ended. Sign in again." };
  const resolved = await getOrgForUser(session.user.id);
  if (!resolved?.org._id) return { error: "You're not part of an organisation." };
  if (!can(resolved.role, capability)) {
    return { error: "Only the organisation owner can do that." };
  }
  if (!opts.allowSuspended && resolved.org.status === "SUSPENDED") {
    return { error: "This organisation is suspended. Contact Morbin support." };
  }
  return {
    actor: {
      userId: session.user.id,
      org: { ...resolved.org, _id: resolved.org._id },
      orgId: resolved.org._id.toString(),
      role: resolved.role,
    },
  };
}
