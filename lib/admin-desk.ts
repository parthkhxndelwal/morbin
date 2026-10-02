import "server-only";

import { getDb, safeObjectIds, toObjectId } from "@/lib/db";
import type { AuditLog, EmailRecord, LedgerEntry, Organization, Payout, PayoutAccount, User } from "@/lib/types";

/**
 * Read models for the Morbin admin desk. Plain DTOs only; every page that uses
 * these has already called `requireAdmin()`.
 */

export interface PayableOrgRow {
  organizationId: string;
  organizationName: string;
  /** Owed and not yet in any payout (refund holds already deducted). */
  unsettledPaise: number;
  entryCount: number;
  oldestEntryAt: string;
  /** A draft already locks some entries; issue one at a time. */
  hasDraft: boolean;
  account: { last4: string; ifsc: string; accountName: string; verified: boolean } | null;
}

/** Organisations with unsettled ledger entries, largest balance first. */
export async function getPayableOrgs(): Promise<PayableOrgRow[]> {
  const db = await getDb();
  const sums = await db
    .collection<LedgerEntry>("ledgerEntries")
    .aggregate<{ _id: string; net: number; n: number; oldest: Date }>([
      { $match: { payoutId: null } },
      { $group: { _id: "$organizationId", net: { $sum: "$amountPaise" }, n: { $sum: 1 }, oldest: { $min: "$createdAt" } } },
      { $sort: { net: -1 } },
    ])
    .toArray();
  if (sums.length === 0) return [];
  const ids = sums.map((s) => s._id);
  const [orgs, accounts, drafts] = await Promise.all([
    db
      .collection<Organization>("organizations")
      .find({ _id: { $in: safeObjectIds(ids) } }, { projection: { name: 1 } })
      .toArray(),
    db
      .collection<PayoutAccount>("payoutAccounts")
      .find({ organizationId: { $in: ids } }, { projection: { organizationId: 1, last4: 1, ifsc: 1, accountName: 1, verifiedAt: 1 } })
      .toArray(),
    db
      .collection<Payout>("payouts")
      .find({ organizationId: { $in: ids }, status: "DRAFT" }, { projection: { organizationId: 1 } })
      .toArray(),
  ]);
  const names = new Map(orgs.map((o) => [o._id!.toString(), o.name]));
  const accountBy = new Map(accounts.map((a) => [a.organizationId, a]));
  const draftOrgs = new Set(drafts.map((d) => d.organizationId));
  return sums.map((s) => {
    const a = accountBy.get(s._id);
    return {
      organizationId: s._id,
      organizationName: names.get(s._id) ?? "Unknown organisation",
      unsettledPaise: s.net,
      entryCount: s.n,
      oldestEntryAt: s.oldest.toISOString(),
      hasDraft: draftOrgs.has(s._id),
      account: a ? { last4: a.last4, ifsc: a.ifsc, accountName: a.accountName, verified: !!a.verifiedAt } : null,
    };
  });
}

export interface PlatformOverview {
  ticketSales30dPaise: number;
  ticketSalesAllPaise: number;
  feeRevenue30dPaise: number;
  feeRevenueAllPaise: number;
  owedToOrgsPaise: number;
  inDraftPayoutsPaise: number;
  orgs: { active: number; suspended: number; unverified: number };
  waiting: { applications: number; refunds: number; failedRefunds: number; payoutQueries: number; failedEmails: number; dataRequests: number; overdueDataRequests: number };
}

/**
 * Platform-wide figures for the admin home. Ticket sales are ticket value net
 * of refunds; fee revenue is Morbin's fee excluding GST (the GST is owed to
 * the government, not earned).
 */
export async function getPlatformOverview(): Promise<PlatformOverview> {
  const db = await getDb();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sold = { status: { $in: ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] } };
  const salesExpr = { $subtract: [{ $ifNull: ["$subtotalPaise", "$totalPaise"] }, { $ifNull: ["$refundedPaise", 0] }] };
  const feeExpr = { $ifNull: ["$pricing.feeBasePaise", 0] };
  const sumOrders = (match: Record<string, unknown>) =>
    db
      .collection("orders")
      .aggregate<{ sales: number; fees: number }>([
        { $match: match },
        { $group: { _id: null, sales: { $sum: salesExpr }, fees: { $sum: feeExpr } } },
      ])
      .toArray()
      .then((r) => r[0] ?? { sales: 0, fees: 0 });

  const [all, recent, owed, drafts, orgStatus, unverified, applications, refunds, failedRefunds, queries, failedEmails, dataRequests, overdueDataRequests] =
    await Promise.all([
      sumOrders(sold),
      sumOrders({ ...sold, createdAt: { $gte: since } }),
      db
        .collection<LedgerEntry>("ledgerEntries")
        .aggregate<{ net: number }>([{ $match: { payoutId: null } }, { $group: { _id: null, net: { $sum: "$amountPaise" } } }])
        .toArray(),
      db
        .collection<Payout>("payouts")
        .aggregate<{ net: number }>([{ $match: { status: "DRAFT" } }, { $group: { _id: null, net: { $sum: "$totals.netPaise" } } }])
        .toArray(),
      db
        .collection<Organization>("organizations")
        .aggregate<{ _id: string; n: number }>([{ $group: { _id: { $ifNull: ["$status", "ACTIVE"] }, n: { $sum: 1 } } }])
        .toArray(),
      db.collection<Organization>("organizations").countDocuments({ paymentAccountStatus: { $ne: "VERIFIED" } }),
      db.collection("applications").countDocuments({ status: "NEW" }),
      db.collection("refundCases").countDocuments({ status: "REQUESTED" }),
      db.collection("refundCases").countDocuments({ status: "FAILED" }),
      db.collection<Payout>("payouts").countDocuments({ status: "DISPUTED" }),
      db.collection("emailDeliveries").countDocuments({ status: "FAILED" }),
      db.collection("dataRequests").countDocuments({ status: "OPEN" }),
      // Due within a week, or already past it.
      db.collection("dataRequests").countDocuments({ status: "OPEN", dueAt: { $lt: new Date(Date.now() + 7 * 86_400_000) } }),
    ]);
  const statusCount = new Map(orgStatus.map((s) => [s._id, s.n]));
  return {
    ticketSales30dPaise: recent.sales,
    ticketSalesAllPaise: all.sales,
    feeRevenue30dPaise: recent.fees,
    feeRevenueAllPaise: all.fees,
    owedToOrgsPaise: owed[0]?.net ?? 0,
    inDraftPayoutsPaise: drafts[0]?.net ?? 0,
    orgs: { active: statusCount.get("ACTIVE") ?? 0, suspended: statusCount.get("SUSPENDED") ?? 0, unverified },
    waiting: { applications, refunds, failedRefunds, payoutQueries: queries, failedEmails, dataRequests, overdueDataRequests },
  };
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  actorRole: string;
  action: string;
  target: string;
  organizationName: string | null;
  organizationId: string | null;
  meta: string;
}

/** The latest audit entries with people and organisations named. Meta never holds personal data. */
export async function getAuditRows(limit = 2000): Promise<AuditRow[]> {
  const db = await getDb();
  const logs = await db.collection<AuditLog>("auditLogs").find({}).sort({ at: -1 }).limit(limit).toArray();
  const userIds = [...new Set(logs.map((l) => l.actorId).filter((x): x is string => !!x))];
  const orgIds = [...new Set(logs.map((l) => l.organizationId).filter((x): x is string => !!x))];
  const [users, orgs] = await Promise.all([
    db.collection<User>("users").find({ _id: { $in: safeObjectIds(userIds) } }, { projection: { email: 1, name: 1 } }).toArray(),
    db.collection<Organization>("organizations").find({ _id: { $in: safeObjectIds(orgIds) } }, { projection: { name: 1 } }).toArray(),
  ]);
  const userBy = new Map(users.map((u) => [u._id!.toString(), u.email]));
  const orgBy = new Map(orgs.map((o) => [o._id!.toString(), o.name]));
  return logs.map((l) => ({
    id: l._id!.toString(),
    at: l.at.toISOString(),
    actor: l.actorId ? (userBy.get(l.actorId) ?? "deleted user") : "System",
    actorRole: l.actorRole,
    action: l.action,
    target: l.targetId ? `${l.targetType} ${l.targetId.slice(-8)}` : l.targetType,
    organizationName: l.organizationId ? (orgBy.get(l.organizationId) ?? "deleted organisation") : null,
    organizationId: l.organizationId,
    meta: Object.keys(l.meta ?? {}).length ? JSON.stringify(l.meta) : "",
  }));
}

export interface FailedEmailRow {
  id: string;
  kind: string;
  recipient: string;
  attempts: number;
  lastError: string | null;
}

export async function getFailedEmails(): Promise<FailedEmailRow[]> {
  const db = await getDb();
  const rows = await db.collection<EmailRecord>("emailDeliveries").find({ status: "FAILED" }).sort({ _id: -1 }).limit(200).toArray();
  return rows.map((r) => ({
    id: r._id!.toString(),
    kind: r.kind,
    recipient: r.recipient,
    attempts: r.attempts,
    lastError: r.lastError ?? null,
  }));
}

/** Put a failed email back in the queue for another full set of attempts. */
export async function retryEmail(id: string): Promise<boolean> {
  const db = await getDb();
  const _id = toObjectId(id);
  if (!_id) return false;
  const r = await db
    .collection<EmailRecord>("emailDeliveries")
    .updateOne({ _id, status: "FAILED" }, { $set: { status: "QUEUED", attempts: 0, nextAttemptAt: null, lastError: null } });
  return r.modifiedCount > 0;
}
