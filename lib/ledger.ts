import type { ClientSession, Db } from "mongodb";
import { getDb } from "@/lib/db";
import type { LedgerEntry, LedgerEntryType, Order, PayoutTotals } from "@/lib/types";

/**
 * The organisation money ledger.
 *
 * Entries are append-only and keyed (`key` is unique), so writing the same
 * movement twice — a webhook retried, a request double-submitted — is a no-op
 * rather than a double credit. Balances are always sums of entries.
 */

export type NewLedgerEntry = Omit<LedgerEntry, "_id" | "payoutId" | "createdAt">;

/** Insert entries inside the caller's transaction; existing keys are skipped. */
export async function appendLedger(
  db: Db,
  session: ClientSession,
  entries: NewLedgerEntry[],
): Promise<void> {
  const now = new Date();
  for (const entry of entries) {
    if (!Number.isInteger(entry.amountPaise)) throw new Error("Ledger amounts must be integer paise");
    if (entry.amountPaise === 0) continue;
    await db
      .collection<LedgerEntry>("ledgerEntries")
      .updateOne(
        { key: entry.key },
        { $setOnInsert: { ...entry, payoutId: null, createdAt: now } },
        { upsert: true, session },
      );
  }
}

/** Ledger entries for a paid order, from its frozen pricing. */
export function saleEntries(order: Order, createdBy: string | null): NewLedgerEntry[] {
  const orderId = order._id!.toString();
  const ticketTotal = order.pricing?.ticketTotalPaise ?? order.subtotalPaise;
  const entries: NewLedgerEntry[] = [
    {
      organizationId: order.organizationId,
      eventId: order.eventId,
      orderId,
      refundCaseId: null,
      type: "SALE",
      amountPaise: ticketTotal,
      memo: `Order ${orderId.slice(-8).toUpperCase()} — ticket sales`,
      key: `sale:${orderId}`,
      createdBy,
    },
  ];
  // The fee only touches the organisation's balance when it absorbs it.
  const absorbedFee =
    order.pricing?.bearer === "ORGANISER"
      ? order.pricing.feePaise
      : order.pricing
        ? 0
        : order.platformFeePaise; // pre-pricing orders always deducted the fee
  if (absorbedFee > 0) {
    entries.push({
      organizationId: order.organizationId,
      eventId: order.eventId,
      orderId,
      refundCaseId: null,
      type: "PLATFORM_FEE",
      amountPaise: -absorbedFee,
      memo: `Order ${orderId.slice(-8).toUpperCase()} — Morbin fee (incl. GST)`,
      key: `fee:${orderId}`,
      createdBy,
    });
  }
  return entries;
}

export interface OrgBalance {
  /** Owed to the organisation and not yet in any payout (holds already deducted). */
  unsettledPaise: number;
  /** Same, broken down by kind. */
  unsettled: PayoutTotals;
  /** Everything ever paid out (payouts marked PAID or later). */
  paidOutPaise: number;
  /** In a DRAFT payout, i.e. about to be paid. */
  inDraftPaise: number;
}

export function emptyTotals(): PayoutTotals {
  return {
    salesPaise: 0,
    feesPaise: 0,
    refundsPaise: 0,
    refundCostsPaise: 0,
    adjustmentsPaise: 0,
    netPaise: 0,
  };
}

const TOTAL_FIELD: Record<LedgerEntryType, keyof PayoutTotals> = {
  SALE: "salesPaise",
  PLATFORM_FEE: "feesPaise",
  REFUND: "refundsPaise",
  REFUND_REVERSAL: "refundsPaise",
  REFUND_COST: "refundCostsPaise",
  ADJUSTMENT: "adjustmentsPaise",
};

/** Fold `{ type, sum }` rows into PayoutTotals. */
export function totalsFrom(rows: { _id: LedgerEntryType; sum: number }[]): PayoutTotals {
  const t = emptyTotals();
  for (const row of rows) {
    t[TOTAL_FIELD[row._id]] += row.sum;
    t.netPaise += row.sum;
  }
  return t;
}

/** Unsettled ledger totals, optionally only up to a cut-off. Usable inside a transaction. */
export async function unsettledTotals(
  db: Db,
  organizationId: string,
  opts: { cutoff?: Date; session?: ClientSession } = {},
): Promise<{ totals: PayoutTotals; count: number }> {
  const match: Record<string, unknown> = { organizationId, payoutId: null };
  if (opts.cutoff) match.createdAt = { $lte: opts.cutoff };
  const rows = await db
    .collection<LedgerEntry>("ledgerEntries")
    .aggregate<{ _id: LedgerEntryType; sum: number; n: number }>(
      [{ $match: match }, { $group: { _id: "$type", sum: { $sum: "$amountPaise" }, n: { $sum: 1 } } }],
      { session: opts.session },
    )
    .toArray();
  return { totals: totalsFrom(rows), count: rows.reduce((s, r) => s + r.n, 0) };
}

export async function getOrgBalance(organizationId: string): Promise<OrgBalance> {
  const db = await getDb();
  const [{ totals }, payouts] = await Promise.all([
    unsettledTotals(db, organizationId),
    db
      .collection("payouts")
      .aggregate<{ _id: string; sum: number }>([
        { $match: { organizationId, status: { $ne: "CANCELLED" } } },
        { $group: { _id: "$status", sum: { $sum: "$totals.netPaise" } } },
      ])
      .toArray(),
  ]);
  const byStatus = new Map(payouts.map((p) => [p._id, p.sum]));
  return {
    unsettledPaise: totals.netPaise,
    unsettled: totals,
    inDraftPaise: byStatus.get("DRAFT") ?? 0,
    paidOutPaise:
      (byStatus.get("PAID") ?? 0) +
      (byStatus.get("ACKNOWLEDGED") ?? 0) +
      (byStatus.get("DISPUTED") ?? 0) +
      (byStatus.get("RESOLVED") ?? 0),
  };
}
