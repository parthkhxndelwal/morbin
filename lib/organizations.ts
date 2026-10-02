import { getDb, toObjectId } from "@/lib/db";
import type { Membership, Organization } from "@/lib/types";

/**
 * Resolve the organization a user belongs to.
 *
 * This deliberately goes through `memberships` rather than matching
 * `organizations.ownerId` directly. A user can belong to an org without owning
 * it, and resolving by ownership alone left every non-owner member unable to
 * reach their own dashboard — the owner-only lookup returned null and sent
 * them back to sign-in with no way to tell "not onboarded" from "onboarded as
 * a member".
 *
 * Ownership is still recorded on the organization (an org must always have
 * exactly one owner), and we fall back to it so an organization whose
 * membership row is missing can still be reached by its owner.
 */
export async function getOrgForUser(
  userId: string,
): Promise<{ org: Organization; role: Membership["role"] } | null> {
  const db = await getDb();

  const membership = await db
    .collection<Membership>("memberships")
    .findOne({ userId }, { sort: { createdAt: 1 } });
  if (membership) {
    const org = await db
      .collection<Organization>("organizations")
      .findOne({ _id: toObjectId(membership.organizationId) as never });
    if (org) return { org, role: membership.role };
  }

  // Fallback: the user owns the org but has no membership row.
  const owned = await db
    .collection<Organization>("organizations")
    .findOne({ ownerId: userId });
  return owned ? { org: owned, role: "OWNER" } : null;
}

/** Convenience wrapper when only the organization is needed. */
export async function getOrgForUserId(userId: string): Promise<Organization | null> {
  return (await getOrgForUser(userId))?.org ?? null;
}
