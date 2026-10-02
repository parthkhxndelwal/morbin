/**
 * The decision half of a forced organization delete, kept free of I/O and of
 * the `@/` bundler alias so it can be exercised directly by
 * lib/admin-delete-plan.check.mts (plain Node cannot resolve a path alias).
 *
 * Cascade deletion is the risky part, not the refusal. A plain delete only ever
 * removed a leaf document, so "is there anything worth keeping" was a complete
 * safety argument. Once we cascade into orders, tickets and events, the
 * questions that matter are different ones:
 *
 *   - money that is already captured must be refunded before its record goes,
 *     because Morbin is the merchant of record and a captured payment with no
 *     order document is money Morbin holds with no way to prove what for;
 *   - an order still inside its checkout hold may be *about* to be paid. If we
 *     delete it, Razorpay will keep retrying `payment.captured` against an order
 *     that no longer exists, the handler answers 500 forever, and the buyer ends
 *     up charged with no ticket and no record. Those must be expired first, so
 *     the webhook's status check short-circuits instead of looping.
 */

/** Order states that a force delete must handle differently. */
export type ForceDeleteBlock =
  /** A captured, unrefunded payment: buyer money is held against a doomed record. */
  | { kind: "captured-payments"; count: number; amountPaise: number }
  /** Orders mid-checkout that could still be paid, or that hold inventory. */
  | { kind: "in-flight-orders"; count: number };

export interface ForceDeleteDecision {
  /** True when it is safe to cascade right now with no operator intervention. */
  proceed: boolean;
  blocks: ForceDeleteBlock[];
  /** Human-readable totals for the confirmation dialog and the audit log. */
  counts: {
    orders: number;
    events: number;
    tickets: number;
    memberships: number;
    ticketTypes: number;
    checkoutFlows: number;
    eventBranding: number;
    checkoutSessions: number;
    /** Orders that must be expired first so no payment can arrive afterwards. */
    ordersToExpire: number;
    /** Distinct buyers whose captured money is inside the cascade. */
    capturedBuyers: number;
    capturedAmountPaise: number;
  };
}

export interface ForceDeleteInput {
  orderStatuses: readonly { status: string; totalPaise: number; buyerEmail: string }[];
  eventCount: number;
  ticketCount: number;
  membershipCount: number;
  ticketTypeCount: number;
  checkoutFlowCount: number;
  brandingCount: number;
  checkoutSessionCount: number;
}

/**
 * Decide whether an organization can be force-deleted right now, and tally what
 * the cascade would remove.
 *
 * Refuses on two grounds, both about money rather than tidiness:
 *
 *   - a captured, unrefunded payment. Cascading the order out from under a
 *     captured payment destroys the only record of what Morbin owes the buyer,
 *     so the operator must refund first (which they do deliberately, and which
 *     leaves `status: REFUNDED` behind for the cascade to remove).
 *   - an order still in CREATED. It is either mid-checkout or holding
 *     inventory. Expiring it is safe and cheap, so this is a precondition the
 *     caller discharges rather than a wall — but it must happen before the
 *     delete, never after, or a payment can land on a deleted order.
 *
 * PAID orders that were refunded (status REFUNDED) are explicitly *not* a
 * block: the money already went back to the buyer, so removing the record is
 * pure cleanup.
 */
export function planForceDelete(input: ForceDeleteInput): ForceDeleteDecision {
  const blocks: ForceDeleteBlock[] = [];

  let capturedCount = 0;
  let capturedAmountPaise = 0;
  let inFlightCount = 0;
  const capturedBuyers = new Set<string>();

  for (const order of input.orderStatuses) {
    if (order.status === "PAID") {
      capturedCount++;
      capturedAmountPaise += order.totalPaise;
      if (order.buyerEmail) capturedBuyers.add(order.buyerEmail.toLowerCase());
    } else if (order.status === "CREATED") {
      inFlightCount++;
    }
  }

  if (capturedCount > 0)
    blocks.push({ kind: "captured-payments", count: capturedCount, amountPaise: capturedAmountPaise });
  if (inFlightCount > 0) blocks.push({ kind: "in-flight-orders", count: inFlightCount });

  return {
    proceed: blocks.length === 0,
    blocks,
    counts: {
      orders: input.orderStatuses.length,
      events: input.eventCount,
      tickets: input.ticketCount,
      memberships: input.membershipCount,
      ticketTypes: input.ticketTypeCount,
      checkoutFlows: input.checkoutFlowCount,
      eventBranding: input.brandingCount,
      checkoutSessions: input.checkoutSessionCount,
      ordersToExpire: inFlightCount,
      capturedBuyers: capturedBuyers.size,
      capturedAmountPaise,
    },
  };
}

/** The refusal sentence shown in the admin UI, built from the block list. */
export function describeBlocks(blocks: readonly ForceDeleteBlock[]): string {
  return blocks
    .map((b) => {
      if (b.kind === "captured-payments")
        return `${b.count} captured payment${b.count === 1 ? "" : "s"} worth ₹${(b.amountPaise / 100).toFixed(2)} are unrefunded. Refund them first — deleting the order would destroy Morbin's record of what it owes those buyers.`;
      return `${b.count} order${b.count === 1 ? " is" : "s are"} still inside the checkout hold. Wait for them to expire, or expire them from the event, then delete.`;
    })
    .join(" ");
}