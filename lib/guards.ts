import { redirect } from "next/navigation";
import type { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/config";
import { getOrgByOwner } from "@/lib/organizations";
import type { Organization } from "@/lib/types";

/** An org that made it out of the database always carries its `_id`. */
type ResolvedOrg = Organization & { _id: ObjectId };

/**
 * Session + organization guard for the organizer dashboard pages. It redirects
 * rather than returning null, so callers can treat the result as settled:
 *
 *   no session            → /auth
 *   admin allowlisted     → /dashboard/admin
 *   signed in, no org yet → /auth
 *
 * app/dashboard/layout.tsx already enforces the org for non-admins, so the
 * lookup below is redundant as a gate — it stays because these pages need the
 * org document itself (name, payment status, `org._id`).
 *
 * The admin hop must live in a page, not in app/dashboard/layout.tsx: that
 * layout also wraps /dashboard/admin, so redirecting there would loop.
 */
export async function requireOrgSession(): Promise<{ userId: string; org: ResolvedOrg }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/auth");
  // Admins need not own an organization; send them where they belong in one
  // hop instead of bouncing them out through /auth and back in again.
  if (isAdminEmail(session.user.email)) redirect("/dashboard/admin");
  const org = await getOrgByOwner(session.user.id);
  if (!org || !org._id) redirect("/auth");
  // Rebuilt so the caller sees a non-optional `_id` without a cast.
  return { userId: session.user.id, org: { ...org, _id: org._id } };
}
