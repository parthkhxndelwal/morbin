import "server-only";

import { getDb, safeObjectIds } from "@/lib/db";
import type { LedgerEntry, Organization, Payout, PayoutAccount } from "@/lib/types";

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
