import { ObjectId } from "mongodb";
import bcrypt from "bcryptjs";
import { auth } from "@/lib/auth";

import { getDb, safeObjectIds, toObjectId } from "@/lib/db";
import { describeBlocks, planForceDelete, type ForceDeleteDecision } from "@/lib/admin-delete-plan";
import { passwordProblem } from "@/lib/admin-bootstrap-plan";
import { releaseOrder } from "@/lib/orders";
import { slugify } from "@/lib/slug";
import type {
  Event,
  Membership,
  OnboardingStatus,
  Order,
  Organization,
  OrganizationType,
  OrgRole,
  PaymentAccountStatus,
  User,
} from "@/lib/types";

/** Password policy shared by every admin-provisioned account. */
export { MIN_PASSWORD_LENGTH } from "@/lib/admin-bootstrap-plan";

function assertPassword(password: string | undefined): string {
  const problem = passwordProblem(password);
  if (problem) throw new AdminError(problem, 400);
  return password!;
}

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
 * Server-side admin gate. The proxy matcher is only a UX redirect — every
 * admin route and page must call this.
 *
 * Authorisation is answered by the `role` field on the user document, not by
 * the ADMIN_EMAILS env allowlist. That separation matters: it means an operator
 * can revoke admin by changing one database field, and an env change alone
 * cannot silently grant admin to whoever happens to hold the address. The
 * allowlist only decides who the bootstrap is permitted to *promote*.
 *
 * The role is re-read from the database on every call rather than trusted from
 * the session token, so a demotion takes effect immediately instead of waiting
 * for the holder to sign in again.
 */
export async function requireAdmin(): Promise<{ id: string; email: string }> {
  const session = await auth();
  const id = session?.user?.id;
  const email = session?.user?.email;
  if (!id || !email) throw new AdminError("Unauthorized", 401);

  const db = await getDb();
  const user = await db
    .collection<{ role?: string }>("users")
    .findOne({ _id: toObjectId(id) as never }, { projection: { role: 1 } });
  if (user?.role !== "ADMIN") throw new AdminError("Forbidden", 403);

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
  type: OrganizationType;
  status: "ACTIVE" | "SUSPENDED";
  onboardingStatus: OnboardingStatus;
  paymentAccountStatus: PaymentAccountStatus;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  createdAt: string;
  memberCount: number;
  orderCount: number;
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
  const tally = (collection: string) =>
    orgIds.length
      ? db
          .collection(collection)
          .aggregate<{ _id: string; n: number }>([
            { $match: { organizationId: { $in: orgIds } } },
            { $group: { _id: "$organizationId", n: { $sum: 1 } } },
          ])
          .toArray()
          .then((r) => new Map(r.map((c) => [c._id, c.n])))
      : Promise.resolve(new Map<string, number>());

  const [countByOrg, memberByOrg, orderByOrg] = await Promise.all([
    tally("events"),
    tally("memberships"),
    tally("orders"),
  ]);

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
          // Pre-typed orgs predate the type field; they were all event
          // organizers, so default rather than showing a blank in the UI.
          type: org.type ?? "EVENT",
          status: org.status ?? "ACTIVE",
          onboardingStatus: org.onboardingStatus,
          paymentAccountStatus: org.paymentAccountStatus,
          payoutsEnabled: org.payoutsEnabled,
          chargesEnabled: org.chargesEnabled,
          createdAt: new Date(org.createdAt).toISOString(),
          memberCount: memberByOrg.get(id) ?? 0,
          orderCount: orderByOrg.get(id) ?? 0,
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
  type?: OrganizationType;
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
    const password = assertPassword(input.ownerPassword);
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
    type: input.type ?? "EVENT",
    status: "ACTIVE",
    onboardingStatus,
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
  type?: OrganizationType;
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

  if (input.type !== undefined) {
    patch.type = input.type;
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

/* ------------------------------------------------------------------ *
 * Organization deletion (soft)
 * ------------------------------------------------------------------ */

/**
 * Suspend or restore an organization.
 *
 * Suspension is deliberately not a delete. An organization owns events, orders
 * and issued tickets, and some of those orders represent money already settled
 * through Razorpay. A suspended org keeps every record for accounting while
 * being unable to publish events or take new orders.
 */
export async function setOrganizationStatus(
  id: string,
  status: "ACTIVE" | "SUSPENDED",
): Promise<Organization> {
  const db = await getDb();
  const _id = requireObjectId(id);
  const existing = await db.collection<Organization>("organizations").findOne({ _id });
  if (!existing) throw new AdminError("Organization not found", 404);
  await db
    .collection<Organization>("organizations")
    .updateOne({ _id }, { $set: { status, updatedAt: new Date() } });
  return { ...existing, status, _id };
}

/**
 * Hard delete, refused whenever there is something worth keeping.
 *
 * This is the *safe* delete: it removes the organization document and nothing
 * else, so it can only ever run against an org with no orders and no members.
 * An org with sales history or people attached is refused rather than
 * cascaded, because losing paid-order history silently is worse than asking
 * the admin to suspend instead.
 *
 * When the admin genuinely needs the org gone despite that, they call
 * `forceDeleteOrganization` below — which cascades, and so carries different
 * obligations.
 */
export async function deleteOrganization(id: string): Promise<{ deleted: true }> {
  const db = await getDb();
  const _id = requireObjectId(id);
  const orgId = _id.toString();
  const existing = await db.collection<Organization>("organizations").findOne({ _id });
  if (!existing) throw new AdminError("Organization not found", 404);

  const [orders, members] = await Promise.all([
    db.collection("orders").countDocuments({ organizationId: orgId }),
    db.collection("memberships").countDocuments({ organizationId: orgId }),
  ]);

  if (orders > 0)
    throw new AdminError(
      `This organization has ${orders} order${orders === 1 ? "" : "s"} on record. Suspend it instead so the sales history is kept.`,
      409,
    );
  if (members > 0)
    throw new AdminError(
      `This organization still has ${members} member${members === 1 ? "" : "s"}. Remove them first, or suspend it instead.`,
      409,
    );

  await db.collection<Organization>("organizations").deleteOne({ _id });
  return { deleted: true };
}

/** What a force delete actually removed, for the audit log and the UI flash. */
export interface ForceDeleteResult {
  deleted: true;
  counts: ForceDeleteDecision["counts"];
}

/**
 * Cascade delete an organization and everything hanging off it, despite orders
 * and members existing.
 *
 * The decision about whether this is safe lives in `planForceDelete` so it can
 * be tested without a database; this function is only the I/O that carries it
 * out. Two preconditions matter and are enforced here rather than trusted:
 *
 *   1. **No unrefunded captured payments.** Morbin is the merchant of record, so
 *      a PAID order is a record of money Morbin holds. Cascading it away leaves
 *      an obligation with no document behind it. The operator refunds first,
 *      which leaves the order as REFUNDED — a terminal state we are happy to
 *      delete.
 *
 *   2. **No order inside its checkout hold.** Deleting a CREATED order opens a
 *      hole: if the buyer pays a second later, `payment.captured` arrives,
 *      `findOne({ razorpayOrderId })` misses, and the handler 500s. Razorpay
 *      retries that for days against a record that no longer exists — the buyer
 *      is charged and never gets a ticket. Expiring the order first closes the
 *      hole: the webhook's `status !== "CREATED"` guard then short-circuits and
 *      acknowledges the payment without fulfilling it.
 *
 * Deletion runs child-first (tickets before orders, orders before the org) so
 * that a failure part-way leaves a partial org rather than orphaned rows that
 * nothing references. There is no transaction: MongoDB only offers them on a
 * replica set, and this project targets a standalone-capable deployment.
 */
export async function forceDeleteOrganization(
  id: string,
): Promise<ForceDeleteResult> {
  const db = await getDb();
  const _id = requireObjectId(id);
  const orgId = _id.toString();
  const existing = await db.collection<Organization>("organizations").findOne({ _id });
  if (!existing) throw new AdminError("Organization not found", 404);

  const orders = await db
    .collection<Order>("orders")
    .find({ organizationId: orgId })
    .project({ status: 1, totalPaise: 1, buyerEmail: 1, items: 1 })
    .toArray();

  const eventDocs = await db
    .collection<Event>("events")
    .find({ organizationId: orgId })
    .project({ _id: 1 })
    .toArray();
  const eventIds = eventDocs.map((e) => e._id!.toString());
  const eventOids = safeObjectIds(eventIds);

  const [
    ticketCount,
    membershipCount,
    ticketTypeCount,
    checkoutFlowCount,
    brandingCount,
    checkoutSessionCount,
  ] = await Promise.all([
      eventOids.length
        ? db.collection("tickets").countDocuments({ eventId: { $in: eventIds } })
        : 0,
      db.collection("memberships").countDocuments({ organizationId: orgId }),
      eventOids.length
        ? db.collection("ticketTypes").countDocuments({ eventId: { $in: eventIds } })
        : 0,
      eventOids.length
        ? db.collection("checkoutFlows").countDocuments({ eventId: { $in: eventIds } })
        : 0,
      eventOids.length
        ? db.collection("eventBranding").countDocuments({ eventId: { $in: eventIds } })
        : 0,
      eventOids.length
        ? db.collection("checkoutSessions").countDocuments({ eventId: { $in: eventIds } })
        : 0,
    ]);

  const decision = planForceDelete({
    orderStatuses: orders.map((o) => ({
      status: o.status,
      totalPaise: o.totalPaise,
      buyerEmail: o.buyerEmail,
    })),
    eventCount: eventIds.length,
    ticketCount,
    membershipCount,
    ticketTypeCount,
    checkoutFlowCount,
    brandingCount,
    checkoutSessionCount,
  });

  if (!decision.proceed)
    throw new AdminError(describeBlocks(decision.blocks), 409);

  // Belt and braces. `planForceDelete` refuses to proceed while any order is
  // CREATED, so `inFlight` is always empty here — this loop is unreachable
  // today. It stays because it is the one place that would close the
  // late-payment hole if the plan's rule were ever relaxed, and the ordering
  // matters: expire before deleting, never after.
  const inFlight = orders.filter((o) => o.status === "CREATED");
  for (const order of inFlight) {
    await releaseOrder(order._id as ObjectId, "EXPIRED");
  }

  // Unpublish first: a live event page is the one thing a buyer can still act
  // on mid-cascade. Setting every event terminal means any page or checkout
  // that resolves during the delete stops selling rather than 404ing on a
  // half-deleted org.
  if (eventOids.length)
    await db
      .collection<Event>("events")
      .updateMany({ _id: { $in: eventOids } }, { $set: { status: "CANCELLED" } });

  // Child-first. `orders` carries `organizationId` directly; everything else is
  // reached through the event ids, so a partially-failed run can only leave
  // extra rows behind, never rows that outlive their parent.
  if (eventOids.length) {
    await db.collection("tickets").deleteMany({ eventId: { $in: eventIds } });
    await db.collection("ticketTypes").deleteMany({ eventId: { $in: eventIds } });
    await db.collection("checkoutFlows").deleteMany({ eventId: { $in: eventIds } });
    await db.collection("eventBranding").deleteMany({ eventId: { $in: eventIds } });
    await db.collection("checkoutSessions").deleteMany({ eventId: { $in: eventIds } });
  }
  await db.collection("orders").deleteMany({ organizationId: orgId });
  if (eventOids.length) await db.collection("events").deleteMany({ _id: { $in: eventOids } });
  await db.collection("memberships").deleteMany({ organizationId: orgId });

  // Users are deliberately NOT deleted. An account may own or belong to other
  // organizations, and orders/tickets elsewhere reference the same user id.
  await db.collection<Organization>("organizations").deleteOne({ _id });

  // Force delete is the one admin action with no undo, so it is always logged
  // with the totals even though nothing reads the log.
  console.log(
    `[admin] FORCE deleted organization ${orgId} (${existing.name}): ` +
      `${decision.counts.orders} orders, ${decision.counts.tickets} tickets, ` +
      `${decision.counts.events} events, ${decision.counts.memberships} memberships`,
  );

  return { deleted: true, counts: decision.counts };
}

/* ------------------------------------------------------------------ *
 * Members
 * ------------------------------------------------------------------ */

export interface AdminMember {
  userId: string;
  membershipId: string;
  name: string;
  email: string;
  role: OrgRole;
  emailVerified: boolean;
  createdAt: string;
  isOwner: boolean;
}

export async function listOrgMembers(orgId: string): Promise<AdminMember[]> {
  const db = await getDb();
  const _id = requireObjectId(orgId);
  const org = await db.collection<Organization>("organizations").findOne({ _id });
  if (!org) throw new AdminError("Organization not found", 404);

  const memberships = await db
    .collection<Membership>("memberships")
    .find({ organizationId: _id.toString() })
    .sort({ createdAt: 1 })
    .toArray();
  if (memberships.length === 0) return [];

  const users = await db
    .collection<User>("users")
    .find({ _id: { $in: safeObjectIds(memberships.map((m) => m.userId)) } })
    .toArray();
  const userById = new Map(users.map((u) => [u._id!.toString(), u]));

  return memberships.flatMap((m) => {
    const user = userById.get(m.userId);
    // A membership whose user row vanished is unrenderable; skip rather than
    // show a blank row the admin cannot act on.
    if (!user) return [];
    return [
      {
        userId: m.userId,
        membershipId: m._id!.toString(),
        name: user.name ?? "",
        email: user.email,
        role: m.role,
        emailVerified: !!user.emailVerified,
        createdAt: new Date(m.createdAt).toISOString(),
        isOwner: m.userId === org.ownerId,
      },
    ];
  });
}

export interface AddMemberInput {
  email: string;
  name?: string;
  /** Required only when the email has no account yet. */
  password?: string;
  role?: OrgRole;
}

/**
 * Add a member to an organization, provisioning the account if the email is
 * new. Idempotent in the way that matters: re-adding an existing member
 * updates their role rather than creating a duplicate membership.
 */
export async function addOrgMember(
  orgId: string,
  input: AddMemberInput,
): Promise<{ member: AdminMember; userCreated: boolean }> {
  const db = await getDb();
  const _id = requireObjectId(orgId);
  const orgIdStr = _id.toString();
  const org = await db.collection<Organization>("organizations").findOne({ _id });
  if (!org) throw new AdminError("Organization not found", 404);

  const email = input.email.trim().toLowerCase();
  if (!email) throw new AdminError("Email is required", 400);

  let user = await db.collection<User>("users").findOne({ email });
  let userCreated = false;

  if (!user) {
    const password = assertPassword(input.password);
    const name = input.name?.trim() || email.split("@")[0];
    const doc = {
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
      // Admin-provisioned: skip the verification email round-trip.
      emailVerified: new Date(),
      image: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { insertedId } = await db.collection<User>("users").insertOne(doc);
    user = { ...doc, _id: insertedId };
    userCreated = true;
  }

  const existing = await db
    .collection<Membership>("memberships")
    .findOne({ organizationId: orgIdStr, userId: user._id!.toString() });
  if (existing) {
    throw new AdminError("That person is already a member of this organization", 409);
  }

  const role = input.role ?? "MEMBER";
  if (role === "OWNER")
    throw new AdminError(
      "An organization has exactly one owner. Change the owner explicitly instead.",
      400,
    );

  const now = new Date();
  const { insertedId } = await db.collection<Membership>("memberships").insertOne({
    organizationId: orgIdStr,
    userId: user._id!.toString(),
    role,
    createdAt: now,
  });

  return {
    userCreated,
    member: {
      userId: user._id!.toString(),
      membershipId: insertedId.toString(),
      name: user.name ?? "",
      email: user.email,
      role,
      emailVerified: !!user.emailVerified,
      createdAt: now.toISOString(),
      isOwner: false,
    },
  };
}

export interface UpdateMemberInput {
  name?: string;
  role?: OrgRole;
  /** Omit to leave the password alone; a new value resets it. */
  password?: string;
}

/** Update a member's name, role, or reset their password. */
export async function updateOrgMember(
  orgId: string,
  userId: string,
  input: UpdateMemberInput,
): Promise<AdminMember> {
  const db = await getDb();
  const _id = requireObjectId(orgId);
  const org = await db.collection<Organization>("organizations").findOne({ _id });
  if (!org) throw new AdminError("Organization not found", 404);

  const membership = await db
    .collection<Membership>("memberships")
    .findOne({ organizationId: _id.toString(), userId });
  if (!membership)
    throw new AdminError("That person is not a member of this organization", 404);
  const isOwner = userId === org.ownerId;

  if (input.role !== undefined) {
    if (isOwner && input.role !== "OWNER")
      throw new AdminError(
        "The owner's role cannot be lowered. Transfer ownership first.",
        400,
      );
    if (!isOwner && input.role === "OWNER")
      throw new AdminError(
        "An organization has exactly one owner. Transfer ownership explicitly instead.",
        400,
      );
    await db
      .collection<Membership>("memberships")
      .updateOne({ _id: membership._id }, { $set: { role: input.role } });
  }

  const userPatch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) userPatch.name = input.name.trim();
  if (input.password !== undefined && input.password !== "") {
    userPatch.passwordHash = await bcrypt.hash(assertPassword(input.password), 12);
    // A password reset by an admin implies the address is reachable.
    userPatch.emailVerified = new Date();
  }
  const userOid = toObjectId(userId);
  if (!userOid) throw new AdminError("Invalid user", 400);
  await db.collection<User>("users").updateOne({ _id: userOid }, { $set: userPatch });

  const [member] = await listOrgMembers(_id.toString());
  const updated = member?.userId === userId ? member : null;
  if (!updated) throw new AdminError("Could not update that member", 500);
  return updated;
}

/**
 * Remove someone from an organization.
 *
 * The account itself is kept: the same person may belong to another
 * organization, and their past orders and issued tickets still reference them.
 */
export async function removeOrgMember(orgId: string, userId: string): Promise<{ removed: true }> {
  const db = await getDb();
  const _id = requireObjectId(orgId);
  const org = await db.collection<Organization>("organizations").findOne({ _id });
  if (!org) throw new AdminError("Organization not found", 404);
  if (org.ownerId === userId)
    throw new AdminError(
      "The owner cannot be removed. Transfer ownership first.",
      400,
    );

  const r = await db
    .collection<Membership>("memberships")
    .deleteOne({ organizationId: _id.toString(), userId });
  if (r.deletedCount === 0)
    throw new AdminError("That person is not a member of this organization", 404);
  return { removed: true };
}
