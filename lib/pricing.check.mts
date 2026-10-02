/**
 * Checks for lib/pricing.ts. Run: npm run check:pricing
 */
import assert from "node:assert/strict";
import {
  computePricing,
  gstPortion,
  instantRefundFee,
  refundCost,
} from "./pricing.ts";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("₹500 at 7%, customer pays → ₹535.00 (₹29.66 + ₹5.34 GST)", () => {
  const p = computePricing([{ unitPricePaise: 50_000, quantity: 1 }], {
    feeBps: 700,
    gstBps: 1800,
    bearer: "CUSTOMER",
  });
  assert.equal(p.feePaise, 3500);
  assert.equal(p.feeGstPaise, 534);
  assert.equal(p.feeBasePaise, 2966);
  assert.equal(p.orderTotalPaise, 53_500);
  assert.equal(p.organiserNetPaise, 50_000);
});

check("₹500 at 7%, organisation absorbs → customer ₹500, organiser ₹465", () => {
  const p = computePricing([{ unitPricePaise: 50_000, quantity: 1 }], {
    feeBps: 700,
    gstBps: 1800,
    bearer: "ORGANISER",
  });
  assert.equal(p.orderTotalPaise, 50_000);
  assert.equal(p.organiserNetPaise, 46_500);
});

check("free orders carry no fee", () => {
  const p = computePricing([{ unitPricePaise: 0, quantity: 3 }], {
    feeBps: 700,
    gstBps: 1800,
    bearer: "CUSTOMER",
  });
  assert.equal(p.feePaise, 0);
  assert.equal(p.orderTotalPaise, 0);
});

check("rounding never exceeds the advertised maximum, and base + GST = fee", () => {
  for (let price = 1; price <= 250_000; price += 997) {
    for (const feeBps of [0, 100, 250, 500, 700, 999, 1250]) {
      for (const qty of [1, 2, 3, 7]) {
        const p = computePricing([{ unitPricePaise: price, quantity: qty }], {
          feeBps,
          gstBps: 1800,
          bearer: "CUSTOMER",
        });
        const max = (price * qty * (10_000 + feeBps)) / 10_000;
        assert.ok(p.orderTotalPaise <= max, `price ${price} × ${qty} at ${feeBps}`);
        assert.equal(p.feeBasePaise + p.feeGstPaise, p.feePaise);
        assert.ok(p.feeBasePaise >= 0 && p.feeGstPaise >= 0);
      }
    }
  }
});

check("multiple line items are summed before the fee", () => {
  const p = computePricing(
    [
      { unitPricePaise: 39_900, quantity: 2 },
      { unitPricePaise: 10_000, quantity: 1 },
    ],
    { feeBps: 500, gstBps: 1800, bearer: "CUSTOMER" },
  );
  assert.equal(p.ticketTotalPaise, 89_800);
  assert.equal(p.feePaise, 4490);
});

check("invalid input is rejected", () => {
  const policy = { feeBps: 500, gstBps: 1800, bearer: "CUSTOMER" as const };
  assert.throws(() => computePricing([{ unitPricePaise: -1, quantity: 1 }], policy));
  assert.throws(() => computePricing([{ unitPricePaise: 100, quantity: 0 }], policy));
  assert.throws(() => computePricing([{ unitPricePaise: 1.5, quantity: 1 }], policy));
  assert.throws(() => computePricing([], { ...policy, feeBps: 99_999 }));
});

check("GST portion of a GST-inclusive amount", () => {
  assert.equal(gstPortion(11_800, 1800), 1800);
  assert.equal(gstPortion(0, 1800), 0);
});

check("instant refund fee tiers (+18% GST)", () => {
  assert.deepEqual(instantRefundFee(50_000), { feePaise: 799, gstPaise: 144, totalPaise: 943 });
  assert.equal(instantRefundFee(100_000).feePaise, 799);
  assert.equal(instantRefundFee(100_001).feePaise, 1199);
  assert.equal(instantRefundFee(2_500_001).feePaise, 1499);
});

check("refund cost: gateway share only when the organisation absorbed the fee", () => {
  // Organisation absorbed: ₹500 paid, Razorpay kept 2.36% = ₹11.80.
  const absorbed = refundCost({
    refundPaise: 50_000,
    orderTotalPaise: 50_000,
    bearer: "ORGANISER",
    gatewayFeePaise: 1180,
    speed: "INSTANT",
  });
  assert.equal(absorbed.gatewayFeeSharePaise, 1180);
  assert.equal(absorbed.totalPaise, 1180 + 943);
  // Customer paid ₹535 incl. fee: no gateway share; normal speed costs nothing.
  const customer = refundCost({
    refundPaise: 50_000,
    orderTotalPaise: 53_500,
    bearer: "CUSTOMER",
    gatewayFeePaise: 1263,
    speed: "NORMAL",
  });
  assert.equal(customer.totalPaise, 0);
});

check("refund cost: gateway share is pro-rata for a partial refund", () => {
  const c = refundCost({
    refundPaise: 25_000,
    orderTotalPaise: 100_000,
    bearer: "ORGANISER",
    gatewayFeePaise: 2360,
    speed: "NORMAL",
  });
  assert.equal(c.gatewayFeeSharePaise, 590);
});

console.log(`\n${passed} pricing checks passed`);
