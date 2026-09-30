import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";
import { isAdminEmail } from "@/lib/config";
import { getDb, safeObjectIds, toObjectId } from "@/lib/db";
import { slugify } from "@/lib/slug";
import type { OnboardingStatus, Organization, PaymentAccountStatus } from "@/lib/types";

/** Thrown by admin mutations so routes can map to a status code. */
export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Server-side admin gate. The middleware matcher is only a UX redirect —
 * every admin route and page must call this.
 */
export async function requireAdmin(): Promise<{ id: string; email: string }> {
  const session = await auth();
  const id = session?.user?.id;
  const email = session?.user?.email;
  if (!id || !email) throw new AdminError("Unauthorized", 401);
  if (!isAdminEmail(email)) throw new AdminError("Forbidden", 403);
  return { id, email };
}

/** Throwing variant for client-supplied ids — a bad id is a 400, not a skip. */
function requireObjectId(id: string): ObjectId {
  const _id = toObjectId(id);
  if (!_id) throw new AdminError("Invalid organization", 400);
  return _id;
}

/** Derive the flags that must stay consistent with the payment status. */
function derivedFields(status: PaymentAccountStatus, previous: string) {
  const verified = status === "VERIFIED";
  let onboardingStatus: OnboardingStatus;
  if (verified) {
    onboardingStatus = "ACTIVE";
  } else if (previous === "ACTIVE") {
    // Approval was withdrawn — the org can no longer take money.
    onboardingStatus = "PAYMENT_PENDING";
  } else {
    onboardingStatus = (previous as OnboardingStatus) || "STARTED";
  }
  return { verified, onboardingStatus };
}

export interface AdminOrg {
  id: string;
  name: string;
  slug: string;
  onboardingStatus: OnboardingStatus;
  paymentAccountStatus: PaymentAccountStatus;
  razorpayAccountId: string | null;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  createdAt: string;
}

export interface AdminOrgRow {
  org: AdminOrg;
  owner: { id: string; name: string; email: string } | null;
  eventCount: number;
}

export async function listOrganizations(): Promise<AdminOrgRow[]> {
  const db = await getDb();
  const orgs = await db
    .collection<Organization>("organizations")
    .find({})
    .sort({ createdAt: -1 })
    .toArray();

  const ownerIds = [...new Set(orgs.map((o) => o.ownerId).filter(Boolean))];
  const ownerOids = safeObjectIds(ownerIds);
  const owners = ownerOids.length
    ? await db
        .collection<{ _id: ObjectId; name?: string; email: string }>("users")
        .find({ _id: { $in: ownerOids } })
        .toArray()
    : [];
  const ownerById = new Map(owners.map((u) => [u._id.toString(), u]));

  const orgIds = orgs.flatMap((o) => (o._id ? [o._id.toString()] : []));
  const counts = orgIds.length
    ? await db
        .collection("events")
        .aggregate<{ _id: string; n: number }>([
          { $match: { organizationId: { $in: orgIds } } },
          { $group: { _id: "$organizationId", n: { $sum: 1 } } },
        ])
        .toArray()
    : [];
  const countByOrg = new Map(counts.map((c) => [c._id, c.n]));

  return orgs.flatMap((org) => {
    // Skip a doc we cannot render rather than 500-ing the whole list.
    if (!org._id || !org.createdAt) return [];
    const owner = org.ownerId ? ownerById.get(org.ownerId) : undefined;
    const id = org._id.toString();
    return [
      {
        org: {
          id,
          name: org.name,
          slug: org.slug,
          onboardingStatus: org.onboardingStatus,
          paymentAccountStatus: org.paymentAccountStatus,
          razorpayAccountId: org.razorpayAccountId ?? null,
          payoutsEnabled: org.payoutsEnabled,
          chargesEnabled: org.chargesEnabled,
          createdAt: new Date(org.createdAt).toISOString(),
        },
        owner: owner
          ? { id: owner._id.toString(), name: owner.name ?? "", email: owner.email }
          : null,
        eventCount: countByOrg.get(id) ?? 0,
      },
    ];
  });
}

export interface CreateOrgInput {
  name: string;
  ownerName: string;
  ownerEmail: string;
  /** Required only when the owner has no account yet. */
  ownerPassword?: string;
  razorpayAccountId?: string;
  paymentAccountStatus?: PaymentAccountStatus;
}

/**
 * Create an organization and its OWNER membership. When the owner has no
 * account yet, one is provisioned and marked verified — the admin vouches
 * for the address, so the email round-trip is skipped.
 */
export async function createOrganizationForOwner(
  input: CreateOrgInput,
): Promise<{ org: Organization; ownerCreated: boolean }> {
  const db = await getDb();
  const email = input.ownerEmail.trim().toLowerCase();
  const name = input.name.trim();
  if (name.length < 2) throw new AdminError("Organization name is required", 400);

  let owner = await db
    .collection<{ _id: ObjectId; name?: string; email: string }>("users")
    .findOne({ email });
  let ownerCreated = false;

  if (!owner) {
    const password = input.ownerPassword ?? "";
    if (password.length < 8)
      throw new AdminError(
        "This email has no Morbin account — set a password (8+ chars) to create one",
        400,
      );
    const ownerName = input.ownerName.trim() || name;
    const doc = {
      name: ownerName,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      // Admin-provisioned: skip the verification email.
      emailVerified: new Date(),
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { insertedId } = await db.collection("users").insertOne(doc);
    owner = { _id: insertedId, name: ownerName, email };
    ownerCreated = true;
  }

  if (await db.collection("organizations").findOne({ ownerId: owner._id.toString() }))
    throw new AdminError("That user already owns an organization", 409);

  const status = input.paymentAccountStatus ?? "NOT_STARTED";
  const { verified, onboardingStatus } = derivedFields(status, "STARTED");
  const accountId = input.razorpayAccountId?.trim() || null;

  const base = slugify(name) || "org";
  let slug = base;
  for (let i = 0; i < 5; i++) {
    if (!(await db.collection("organizations").findOne({ slug }))) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  }
  if (await db.collection("organizations").findOne({ slug }))
    throw new AdminError("Could not generate a unique slug — retry", 409);

  const now = new Date();
  const org: Organization = {
    name,
    slug,
    ownerId: owner._id.toString(),
    onboardingStatus,
    razorpayAccountId: accountId,
    paymentAccountStatus: status,
    payoutsEnabled: verified,
    chargesEnabled: verified,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await db.collection<Organization>("organizations").insertOne(org);
  await db.collection("memberships").insertOne({
    organizationId: insertedId.toString(),
    userId: owner._id.toString(),
    role: "OWNER",
    createdAt: now,
  });
  return { org: { ...org, _id: insertedId }, ownerCreated };
}

export interface UpdateOrgInput {
  name?: string;
  razorpayAccountId?: string | null;
  paymentAccountStatus?: PaymentAccountStatus;
}

/** Admin edit: rename, re-point the Razorpay account, change approval status. */
export async function updateOrganizationAsAdmin(
  id: string,
  input: UpdateOrgInput,
): Promise<Organization> {
  const db = await getDb();
  const _id = requireObjectId(id);
  const existing = await db.collection<Organization>("organizations").findOne({ _id });
  if (!existing) throw new AdminError("Organization not found", 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) throw new AdminError("Organization name is required", 400);
    patch.name = name;
    const slug = slugify(name) || existing.slug;
    if (slug !== existing.slug) {
      if (await db.collection("organizations").findOne({ slug, _id: { $ne: _id } }))
        throw new AdminError("That name is already taken", 409);
      patch.slug = slug;
    }
  }

  if (input.razorpayAccountId !== undefined) {
    patch.razorpayAccountId = input.razorpayAccountId?.trim() || null;
  }

  if (input.paymentAccountStatus !== undefined) {
    const status = input.paymentAccountStatus;
    const { verified, onboardingStatus } = derivedFields(status, existing.onboardingStatus);
    patch.paymentAccountStatus = status;
    patch.payoutsEnabled = verified;
    patch.chargesEnabled = verified;
    patch.onboardingStatus = onboardingStatus;
  }

  await db.collection<Organization>("organizations").updateOne({ _id }, { $set: patch });
  return { ...existing, ...patch, _id } as Organization;
}
