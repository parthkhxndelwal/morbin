import "server-only";

import type { ObjectId } from "mongodb";
import { findOrCreateOwnerUser, sendAccountSetup } from "@/lib/account-setup";
import { audit, notify } from "@/lib/audit";
import { getDb, toObjectId } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { getOrgBalance, type OrgBalance } from "@/lib/ledger";
import { mediaBucket } from "@/lib/media";
import { getPayoutAccountView } from "@/lib/payout-accounts";
import { getPlatformSettings } from "@/lib/platform-settings";
import { MAX_FEE_BPS } from "@/lib/pricing";
import { slugify } from "@/lib/slug";
import { TxAbort, withTransaction } from "@/lib/tx";
import type {
  Event,
  LedgerEntry,
  Membership,
  Organization,
  OrganizationType,
  PaymentAccountStatus,
  User,
} from "@/lib/types";

/**
 * Admin-side organisation management: creating organisations (the owner sets
 * their own password from an emailed link), the platform fee with its history,
 * retention, and the read model behind the organisation page.
 */

interface FeeChange {
  _id?: ObjectId;
  organizationId: string;
  fromBps: number | null;
  toBps: number | null;
  note: string | null;
  by: string;
  at: Date;
}

/* ── Create ─────────────────────────────────────────────────────────────── */

export async function createOrganization(
  input: { name: string; type: OrganizationType; ownerEmail: string; ownerName: string },
  admin: { id: string; email: string },
): Promise<{ id: string; ownerCreated: boolean }> {
  const name = input.name.trim();
  const { userId, created } = await findOrCreateOwnerUser(input.ownerEmail, input.ownerName);
  const db = await getDb();
  const owns = await db.collection<Organization>("organizations").findOne({ ownerId: userId }, { projection: { _id: 1 } });
  if (owns) throw new TxAbort("That person already owns an organisation.", 409);

  const base = slugify(name) || "org";
  let slug = base;
  for (let i = 0; i < 5 && (await db.collection("organizations").findOne({ slug })); i++) {
    slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }

  const now = new Date();
  const id = await withTransaction(async (session, tx) => {
    const { insertedId } = await tx.collection<Organization>("organizations").insertOne(
      {
        name,
        slug,
        ownerId: userId,
        type: input.type,
        status: "ACTIVE",
        onboardingStatus: "STARTED",
        paymentAccountStatus: "NOT_STARTED",
        payoutsEnabled: false,
        chargesEnabled: false,
        createdAt: now,
        updatedAt: now,
      },
      { session },
    );
    await tx
      .collection<Membership>("memberships")
      .insertOne({ organizationId: insertedId.toString(), userId, role: "OWNER", createdAt: now }, { session });
    await audit(
      {
        actorId: admin.id,
        actorRole: "ADMIN",
        action: "organization.created",
        targetType: "organization",
        targetId: insertedId.toString(),
        organizationId: insertedId.toString(),
        meta: { ownerCreated: created },
      },
      session,
    );
    return insertedId.toString();
  });

  const owner = await db.collection<User>("users").findOne({ _id: toObjectId(userId)! }, { projection: { passwordHash: 1 } });
  if (!owner?.passwordHash) await sendAccountSetup(userId, { organizationName: name, inviterName: "Morbin" });
  return { id, ownerCreated: created };
}

/** Send the owner a fresh set-password link (they haven't set one yet). */
export async function resendOwnerSetup(organizationId: string): Promise<void> {
  const db = await getDb();
  const org = await db.collection<Organization>("organizations").findOne({ _id: toObjectId(organizationId)! });
  if (!org) throw new TxAbort("Organisation not found.", 404);
  const owner = await db.collection<User>("users").findOne({ _id: toObjectId(org.ownerId)! }, { projection: { passwordHash: 1 } });
  if (owner?.passwordHash) throw new TxAbort("The owner has already set a password.", 409);
  await sendAccountSetup(org.ownerId, { organizationName: org.name, inviterName: "Morbin" });
}

/* ── Settings the admin controls ────────────────────────────────────────── */

async function orgOrThrow(id: string): Promise<Organization & { _id: ObjectId }> {
  const db = await getDb();
  const _id = toObjectId(id);
  const org = _id ? await db.collection<Organization>("organizations").findOne({ _id }) : null;
  if (!org) throw new TxAbort("Organisation not found.", 404);
  return org as Organization & { _id: ObjectId };
}

/**
 * Set the platform fee (GST-inclusive). `bps` null returns the organisation to
 * the platform default. Applies to orders placed from now on; every order
 * already placed keeps the pricing it was frozen with.
 */
export async function setOrganizationFee(
  organizationId: string,
  bps: number | null,
  note: string | null,
  adminId: string,
): Promise<void> {
  if (bps !== null && (!Number.isInteger(bps) || bps < 0 || bps > MAX_FEE_BPS)) {
    throw new TxAbort(`The fee must be between 0% and ${MAX_FEE_BPS / 100}%.`);
  }
  const org = await orgOrThrow(organizationId);
  const from = org.feeBps ?? null;
  if (from === bps) return;
  const db = await getDb();
  const now = new Date();
  await db.collection<Organization>("organizations").updateOne({ _id: org._id }, { $set: { feeBps: bps, updatedAt: now } });
  await db.collection<FeeChange>("feeChanges").insertOne({ organizationId, fromBps: from, toBps: bps, note, by: adminId, at: now });
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: "organization.fee.changed",
    targetType: "organization",
    targetId: organizationId,
    organizationId,
    meta: { fromBps: from, toBps: bps },
  });
  const settings = await getPlatformSettings();
  const pct = ((bps ?? settings.defaultFeeBps) / 100).toString();
  await notify({
    organizationId,
    audience: "ORG_OWNER",
    kind: "FEE_CHANGED",
    title: `Platform fee is now ${pct}%`,
    body: `Applies to orders placed from ${formatDate(now)}. Existing orders keep the fee they were charged.`,
    link: "/dashboard/settings",
  });
}

export async function setOrganizationRetention(organizationId: string, months: number | null, adminId: string): Promise<void> {
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) {
    throw new TxAbort("Retention must be between 1 and 120 months.");
  }
  const org = await orgOrThrow(organizationId);
  const db = await getDb();
  await db.collection<Organization>("organizations").updateOne({ _id: org._id }, { $set: { retentionMonths: months, updatedAt: new Date() } });
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: "organization.retention.changed",
    targetType: "organization",
    targetId: organizationId,
    organizationId,
    meta: { from: org.retentionMonths ?? null, to: months },
  });
}

/** Admin edit of identity and payment status. */
export async function updateOrganizationBasics(
  organizationId: string,
  input: { name: string; type: OrganizationType; paymentAccountStatus: PaymentAccountStatus },
  adminId: string,
): Promise<void> {
  const org = await orgOrThrow(organizationId);
  const db = await getDb();
  const verified = input.paymentAccountStatus === "VERIFIED";
  const now = new Date();
  await db.collection<Organization>("organizations").updateOne(
    { _id: org._id },
    {
      $set: {
        name: input.name.trim(),
        type: input.type,
        paymentAccountStatus: input.paymentAccountStatus,
        payoutsEnabled: verified,
        chargesEnabled: verified,
        onboardingStatus: verified ? "ACTIVE" : org.onboardingStatus === "ACTIVE" ? "PAYMENT_PENDING" : org.onboardingStatus,
        updatedAt: now,
      },
    },
  );
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: "organization.updated",
    targetType: "organization",
    targetId: organizationId,
    organizationId,
    meta: {
      fields: ["name", "type", "paymentAccountStatus"].filter(
        (k) => (org as unknown as Record<string, unknown>)[k] !== (input as Record<string, unknown>)[k],
      ),
    },
  });
}

export async function setOrganizationSuspended(organizationId: string, suspended: boolean, adminId: string): Promise<void> {
  const org = await orgOrThrow(organizationId);
  const status = suspended ? "SUSPENDED" : "ACTIVE";
  if (org.status === status) return;
  const db = await getDb();
  await db.collection<Organization>("organizations").updateOne({ _id: org._id }, { $set: { status, updatedAt: new Date() } });
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: suspended ? "organization.suspended" : "organization.restored",
    targetType: "organization",
    targetId: organizationId,
    organizationId,
    meta: {},
  });
}

/* ── Read model ─────────────────────────────────────────────────────────── */

export interface AdminOrgDetail {
  id: string;
  name: string;
  slug: string;
  type: OrganizationType;
  status: "ACTIVE" | "SUSPENDED";
  paymentAccountStatus: PaymentAccountStatus;
  createdAt: string;
  contact: { email: string | null; phone: string | null; gstin: string | null; address: string | null };
  owner: { id: string; name: string; email: string; hasPassword: boolean } | null;
  fee: { customBps: number | null; effectiveBps: number; defaultBps: number; bearer: "CUSTOMER" | "ORGANISER" };
  feeHistory: { fromBps: number | null; toBps: number | null; note: string | null; at: string }[];
  retentionMonths: number | null;
  defaultRetentionMonths: number;
  requireApprovalForSupportChanges: boolean;
  balance: OrgBalance;
  ledger: { id: string; type: string; amountPaise: number; memo: string; settled: boolean; at: string }[];
  events: { id: string; title: string; status: string; startsAt: string }[];
  account: { accountName: string; ifsc: string; last4: string; verified: boolean } | null;
}

export async function getAdminOrgDetail(id: string): Promise<AdminOrgDetail | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const db = await getDb();
  const org = await db.collection<Organization>("organizations").findOne({ _id });
  if (!org) return null;
  const [owner, settings, feeHistory, balance, ledger, events, account] = await Promise.all([
    db.collection<User>("users").findOne({ _id: toObjectId(org.ownerId)! }, { projection: { name: 1, email: 1, passwordHash: 1 } }),
    getPlatformSettings(),
    db.collection<FeeChange>("feeChanges").find({ organizationId: id }).sort({ at: -1 }).limit(20).toArray(),
    getOrgBalance(id),
    db.collection<LedgerEntry>("ledgerEntries").find({ organizationId: id }).sort({ createdAt: -1 }).limit(50).toArray(),
    db
      .collection<Event>("events")
      .find({ organizationId: id }, { projection: { title: 1, status: 1, startsAt: 1 } })
      .sort({ startsAt: -1 })
      .limit(200)
      .toArray(),
    getPayoutAccountView(id),
  ]);
  return {
    id,
    name: org.name,
    slug: org.slug,
    type: org.type ?? "EVENT",
    status: org.status ?? "ACTIVE",
    paymentAccountStatus: org.paymentAccountStatus,
    createdAt: org.createdAt.toISOString(),
    contact: {
      email: org.contactEmail ?? null,
      phone: org.contactPhone ?? null,
      gstin: org.gstin ?? null,
      address: org.address ?? null,
    },
    owner: owner
      ? { id: owner._id!.toString(), name: owner.name ?? "", email: owner.email, hasPassword: !!owner.passwordHash }
      : null,
    fee: {
      customBps: org.feeBps ?? null,
      effectiveBps: org.feeBps ?? settings.defaultFeeBps,
      defaultBps: settings.defaultFeeBps,
      bearer: org.feeBearer ?? "ORGANISER",
    },
    feeHistory: feeHistory.map((f) => ({ fromBps: f.fromBps, toBps: f.toBps, note: f.note, at: f.at.toISOString() })),
    retentionMonths: org.retentionMonths ?? null,
    defaultRetentionMonths: settings.defaultRetentionMonths,
    requireApprovalForSupportChanges: !!org.requireApprovalForSupportChanges,
    balance,
    ledger: ledger.map((l) => ({
      id: l._id!.toString(),
      type: l.type,
      amountPaise: l.amountPaise,
      memo: l.memo,
      settled: l.payoutId !== null,
      at: l.createdAt.toISOString(),
    })),
    events: events.map((e) => ({ id: e._id!.toString(), title: e.title, status: e.status, startsAt: e.startsAt.toISOString() })),
    account: account
      ? { accountName: account.accountName, ifsc: account.ifsc, last4: account.last4, verified: !!account.verifiedAt }
      : null,
  };
}

/**
 * Delete an organisation that never did business — one created by mistake.
 * Refused once there is any money or any other person involved (suspend it
 * instead, so history is kept). Removes what the organisation alone owns; the
 * owner's user account stays. The audit log keeps the record of it.
 */
export async function deleteUnusedOrganization(organizationId: string, adminId: string): Promise<void> {
  const org = await orgOrThrow(organizationId);
  const db = await getDb();
  const [orders, ledger, payouts, others] = await Promise.all([
    db.collection("orders").countDocuments({ organizationId }),
    db.collection("ledgerEntries").countDocuments({ organizationId }),
    db.collection("payouts").countDocuments({ organizationId }),
    db.collection("memberships").countDocuments({ organizationId, userId: { $ne: org.ownerId } }),
  ]);
  if (orders || ledger || payouts) {
    throw new TxAbort("This organisation has sales or money on record. Suspend it instead so the history is kept.", 409);
  }
  if (others) throw new TxAbort(`Remove its ${others} other member${others === 1 ? "" : "s"} first, or suspend it instead.`, 409);

  const eventIds = (
    await db.collection("events").find({ organizationId }, { projection: { _id: 1 } }).toArray()
  ).map((e) => e._id.toString());
  const banners = eventIds.length
    ? (
        await db
          .collection<{ bannerKey?: string | null }>("eventBranding")
          .find({ eventId: { $in: eventIds }, bannerKey: { $ne: null } }, { projection: { bannerKey: 1 } })
          .toArray()
      ).flatMap((b) => (b.bannerKey ? [b.bannerKey] : []))
    : [];
  await withTransaction(async (session, tx) => {
    if (eventIds.length) {
      for (const c of ["ticketTypes", "checkoutFlows", "eventBranding", "checkoutSessions"]) {
        await tx.collection(c).deleteMany({ eventId: { $in: eventIds } }, { session });
      }
      await tx.collection("events").deleteMany({ organizationId }, { session });
    }
    for (const c of ["memberships", "teamInvites", "payoutAccounts", "feeChanges", "notifications"]) {
      await tx.collection(c).deleteMany({ organizationId }, { session });
    }
    await tx.collection("organizations").deleteOne({ _id: org._id }, { session });
    await audit(
      {
        actorId: adminId,
        actorRole: "ADMIN",
        action: "organization.deleted",
        targetType: "organization",
        targetId: organizationId,
        organizationId,
        meta: { name: org.name, events: eventIds.length },
      },
      session,
    );
  });
  // Files are not transactional; remove them only once the records are gone.
  await Promise.all(banners.map((key) => mediaBucket().delete(key)));
}
