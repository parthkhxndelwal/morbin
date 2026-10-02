/**
 * Every rupee Morbin computes, in one pure module.
 *
 * No database, no request, no `@/` imports — so `lib/pricing.check.mts` can run
 * it under plain Node, and the checkout API, the drawer's price breakdown,
 * refunds and payouts all agree because they all call this.
 *
 * All amounts are integer paise. Rates are basis points (1% = 100 bps).
 *
 * The convenience fee is **GST-inclusive**: GST is carved out of the fee, never
 * added on top. ₹500 at 7% → fee ₹35.00 = ₹29.66 base + ₹5.34 GST, and the
 * customer pays ₹535.00, never more.
 */

export type FeeBearer = "CUSTOMER" | "ORGANISER";

/** Default GST on Morbin's fee (18%). The live value comes from platform settings. */
export const DEFAULT_GST_BPS = 1800;
/** Default platform fee for a new organisation (admin-editable per org). */
export const DEFAULT_FEE_BPS = 500;
/** Upper bound the admin UI and validation accept for a fee. */
export const MAX_FEE_BPS = 3000;

export interface PricingPolicy {
  feeBps: number;
  gstBps: number;
  bearer: FeeBearer;
}

export interface LineItem {
  unitPricePaise: number;
  quantity: number;
}

/** Frozen onto every order at creation. */
export interface OrderPricing extends PricingPolicy {
  ticketTotalPaise: number;
  /** Convenience fee, GST included. */
  feePaise: number;
  /** Fee excluding GST — Morbin's revenue. */
  feeBasePaise: number;
  /** GST portion of the fee. */
  feeGstPaise: number;
  /** What the customer is charged (and what Razorpay must capture). */
  orderTotalPaise: number;
  /** What the order contributes to the organisation's balance. */
  organiserNetPaise: number;
}

function assertInt(name: string, n: number, min = 0): void {
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer ≥ ${min}`);
}

/** GST inside a GST-inclusive amount: round(amount × r / (1 + r)). */
export function gstPortion(inclusivePaise: number, gstBps: number): number {
  return Math.round((inclusivePaise * gstBps) / (10_000 + gstBps));
}

export function computePricing(items: readonly LineItem[], policy: PricingPolicy): OrderPricing {
  assertInt("feeBps", policy.feeBps);
  assertInt("gstBps", policy.gstBps);
  if (policy.feeBps > MAX_FEE_BPS) throw new Error("feeBps exceeds the maximum");
  let ticketTotalPaise = 0;
  for (const item of items) {
    assertInt("unitPricePaise", item.unitPricePaise);
    assertInt("quantity", item.quantity, 1);
    ticketTotalPaise += item.unitPricePaise * item.quantity;
  }
  // Rounded down, so rounding can never push the customer above the advertised
  // "price + fee%" figure.
  const feePaise = ticketTotalPaise === 0 ? 0 : Math.floor((ticketTotalPaise * policy.feeBps) / 10_000);
  const feeGstPaise = gstPortion(feePaise, policy.gstBps);
  const feeBasePaise = feePaise - feeGstPaise;
  const customerPays = policy.bearer === "CUSTOMER";
  return {
    ...policy,
    ticketTotalPaise,
    feePaise,
    feeBasePaise,
    feeGstPaise,
    orderTotalPaise: customerPays ? ticketTotalPaise + feePaise : ticketTotalPaise,
    organiserNetPaise: customerPays ? ticketTotalPaise : ticketTotalPaise - feePaise,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Refund costs
 *
 * Razorpay pricing as published 2026-10-02 (razorpay.com/pricing): normal
 * refunds are free; the gateway fee charged at capture is not returned;
 * instant refunds cost a flat fee per refund, plus GST.
 * ──────────────────────────────────────────────────────────────────────────── */

export type RefundSpeed = "NORMAL" | "INSTANT";

/** Razorpay instant-refund fee tiers, excluding GST. */
export const INSTANT_REFUND_TIERS: { upToPaise: number; feePaise: number }[] = [
  { upToPaise: 100_000, feePaise: 799 }, // up to ₹1,000 → ₹7.99
  { upToPaise: 2_500_000, feePaise: 1199 }, // up to ₹25,000 → ₹11.99
  { upToPaise: Number.POSITIVE_INFINITY, feePaise: 1499 }, // above → ₹14.99
];

export function instantRefundFee(refundPaise: number, gstBps = DEFAULT_GST_BPS) {
  const tier = INSTANT_REFUND_TIERS.find((t) => refundPaise <= t.upToPaise)!;
  const gst = Math.round((tier.feePaise * gstBps) / 10_000);
  return { feePaise: tier.feePaise, gstPaise: gst, totalPaise: tier.feePaise + gst };
}

export interface RefundCost {
  /** Share of Razorpay's unreturned fee + tax charged to the organisation. */
  gatewayFeeSharePaise: number;
  instantFeePaise: number;
  instantFeeGstPaise: number;
  totalPaise: number;
}

/**
 * What refunding `refundPaise` of ticket value costs the organisation.
 *
 * The gateway share is charged only when the organisation absorbed the
 * convenience fee on that order; when the customer paid it, Morbin's fee
 * already covered the gateway cost. The share is pro-rata on what was captured.
 */
export function refundCost(input: {
  refundPaise: number;
  orderTotalPaise: number;
  bearer: FeeBearer;
  /** Razorpay `fee` (which already includes `tax`) captured on the payment. */
  gatewayFeePaise: number;
  speed: RefundSpeed;
  gstBps?: number;
}): RefundCost {
  const { refundPaise, orderTotalPaise, bearer, gatewayFeePaise, speed } = input;
  assertInt("refundPaise", refundPaise);
  const gatewayFeeSharePaise =
    bearer === "ORGANISER" && orderTotalPaise > 0
      ? Math.round((gatewayFeePaise * refundPaise) / orderTotalPaise)
      : 0;
  const instant = speed === "INSTANT" ? instantRefundFee(refundPaise, input.gstBps) : null;
  const instantFeePaise = instant?.feePaise ?? 0;
  const instantFeeGstPaise = instant?.gstPaise ?? 0;
  return {
    gatewayFeeSharePaise,
    instantFeePaise,
    instantFeeGstPaise,
    totalPaise: gatewayFeeSharePaise + instantFeePaise + instantFeeGstPaise,
  };
}
