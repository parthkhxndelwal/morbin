import { redirect } from "next/navigation";
import type { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { can, type Capability } from "@/lib/permissions";
import { getOrgForUser } from "@/lib/organizations";
import type { Organization, OrgRole } from "@/lib/types";

/** An org that made it out of the database always carries its `_id`. */
type ResolvedOrg = Organization & { _id: ObjectId };

export interface OrgSession {
  userId: string;
  org: ResolvedOrg;
  role: OrgRole;
}

/**
 * Session + organization guard for the organizer dashboard pages. It redirects
 * rather than returning null, so callers can treat the result as settled:
 *
 *   no session            → /auth
 *   admin allowlisted     → /dashboard/admin
 *   signed in, no org yet → /auth
 *
 * Membership is resolved through `memberships`, so a MEMBER — who does not own
 * the organization — reaches their dashboard exactly as an OWNER does.
 *
 * The admin hop must live in a page, not in app/dashboard/layout.tsx: that
 * layout also wraps /dashboard/admin, so redirecting there would loop.
 */
export async function requireOrgSession(): Promise<OrgSession> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth");
  // Admins need not own an organization; send them where they belong in one
  // hop instead of bouncing them out through /auth and back in again.
  if (session.user.role === "ADMIN") redirect("/dashboard/admin");

  const resolved = await getOrgForUser(session.user.id);
  if (!resolved?.org._id) redirect("/auth");

  return {
    userId: session.user.id,
    // Rebuilt so the caller sees a non-optional `_id` without a cast.
    org: { ...resolved.org, _id: resolved.org._id },
    role: resolved.role,
  };
}

/**
 * Same guard, for pages and handlers that may only be performed by an OWNER —
 * creating and publishing events, adding ticket types, issuing refunds.
 * A MEMBER gets a 403 rather than a redirect, because the page itself is
 * legitimate for them; only the action is not.
 */
export async function requireOwnerSession(): Promise<OrgSession> {
  const ctx = await requireOrgSession();
  if (ctx.role !== "OWNER") throw new ForbiddenError();
  return ctx;
}

/** Thrown by the guards; route handlers map it to a 403 response. */
export class ForbiddenError extends Error {
  readonly status = 403;
  constructor(message = "You do not have permission to do that.") {
    super(message);
  }
}

/** Re-exported so handlers can write `can(ctx.role, "manageEvents")`. */
export { can };
export type { Capability };
