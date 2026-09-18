import { ObjectId } from "mongodb";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { slugify } from "@/lib/slug";
import type { Membership, Organization } from "@/lib/types";

export async function getOrgById(id: string): Promise<Organization | null> {
  try {
    const db = await getDb();
    return db
      .collection<Organization>("organizations")
      .findOne({ _id: new ObjectId(id) });
  } catch {
    return null;
  }
}

export async function getOrgByOwner(ownerId: string): Promise<Organization | null> {
  const db = await getDb();
  return db.collection<Organization>("organizations").findOne({ ownerId });
}

export async function createOrganization(
  userId: string,
  name: string,
): Promise<Organization> {
  const db = await getDb();
  const base = slugify(name) || "org";
  let slug = base;
  for (let i = 0; i < 5; i++) {
    const taken = await db.collection("organizations").findOne({ slug });
    if (!taken) break;
    slug = `${base}-${Math.random().toString(36).slice(2, 7)}`;
  }
  const now = new Date();
  const org: Organization = {
    name: name.trim(),
    slug,
    ownerId: userId,
    onboardingStatus: "STARTED",
    razorpayAccountId: null,
    paymentAccountStatus: "NOT_STARTED",
    payoutsEnabled: false,
    chargesEnabled: false,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await db.collection<Organization>("organizations").insertOne(org);
  const membership: Membership = {
    organizationId: insertedId.toString(),
    userId,
    role: "OWNER",
    createdAt: now,
  };
  await db.collection<Membership>("memberships").insertOne(membership);
  return { ...org, _id: insertedId };
}

/** Returns the caller's org if they own it (MVP: one org per user). */
export async function requireOwnerOrg(): Promise<
  | { ok: true; userId: string; org: Organization }
  | { ok: false; status: number; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, status: 401, error: "Unauthorized" };
  const org = await getOrgByOwner(session.user.id);
  if (!org || !org._id)
    return { ok: false, status: 404, error: "No organization yet" };
  return { ok: true, userId: session.user.id, org };
}
