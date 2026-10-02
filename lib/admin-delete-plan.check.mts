/**
 * Safety tests for the forced-delete decision. Plain Node, no alias resolution:
 *
 *   node --experimental-strip-types lib/admin-delete-plan.check.mts
 *
 * These encode the money-safety rules. Each block below is a way a force delete
 * could quietly cost someone money or strand a buyer, so they are pinned
 * deliberately rather than derived from the implementation.
 */
import assert from "node:assert/strict";
import { describeBlocks, planForceDelete } from "./admin-delete-plan.ts";

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures++;
    console.log(`FAIL  ${name}`);
    console.log(`      ${(err as Error).message}`);
  }
}

const base = {
  eventCount: 1,
  ticketCount: 0,
  membershipCount: 1,
  ticketTypeCount: 1,
  checkoutFlowCount: 0,
  brandingCount: 0,
  checkoutSessionCount: 0,
};

const order = (status: string, totalPaise = 100_000, buyerEmail = "a@example.com") => ({
  status,
  totalPaise,
  buyerEmail,
});

console.log("planForceDelete");

test("an org with only terminal orders can be force-deleted", () => {
  const d = planForceDelete({
    ...base,
    orderStatuses: [order("EXPIRED"), order("FAILED"), order("REFUNDED")],
  });
  assert.equal(d.proceed, true);
  assert.deepEqual(d.blocks, []);
});

test("an org with no orders at all can be force-deleted", () => {
  assert.equal(planForceDelete({ ...base, orderStatuses: [] }).proceed, true);
});

test("a captured payment blocks the delete", () => {
  const d = planForceDelete({ ...base, orderStatuses: [order("PAID")] });
  assert.equal(d.proceed, false);
  assert.equal(d.blocks[0].kind, "captured-payments");
});

test("a captured payment reports the full amount held", () => {
  const d = planForceDelete({
    ...base,
    orderStatuses: [order("PAID", 250_000), order("PAID", 150_000)],
  });
  assert.equal(d.counts.capturedAmountPaise, 400_000);
  assert.equal(d.counts.orders, 2);
});

test("distinct captured buyers are counted, not orders", () => {
  // The same person buying twice is one person owed money, and the block text
  // must not imply two separate refunds are needed.
  const d = planForceDelete({
    ...base,
    orderStatuses: [order("PAID", 1000, "one@example.com"), order("PAID", 2000, "one@example.com")],
  });
  assert.equal(d.counts.orders, 2);
  assert.equal(d.counts.capturedBuyers, 1);
});

test("buyer email casing does not inflate the distinct-buyer count", () => {
  const d = planForceDelete({
    ...base,
    orderStatuses: [order("PAID", 1000, "One@Example.com"), order("PAID", 2000, "one@example.com")],
  });
  assert.equal(d.counts.capturedBuyers, 1);
});

test("a refunded order is not a block — the money already went back", () => {
  const d = planForceDelete({ ...base, orderStatuses: [order("REFUNDED")] });
  assert.equal(d.proceed, true);
});

test("an order inside the checkout hold blocks the delete", () => {
  // This is the case that would otherwise strand a buyer: a payment lands
  // after the delete, the webhook cannot find the order, and it 500s forever.
  const d = planForceDelete({ ...base, orderStatuses: [order("CREATED")] });
  assert.equal(d.proceed, false);
  assert.equal(d.blocks[0].kind, "in-flight-orders");
});

test("both blocks are reported together, not just the first", () => {
  const d = planForceDelete({ ...base, orderStatuses: [order("PAID"), order("CREATED")] });
  assert.equal(d.proceed, false);
  assert.deepEqual(
    d.blocks.map((b) => b.kind),
    ["captured-payments", "in-flight-orders"],
  );
});

test("in-flight orders are counted as needing expiry", () => {
  const d = planForceDelete({ ...base, orderStatuses: [order("CREATED"), order("CREATED"), order("PAID")] });
  assert.equal(d.counts.ordersToExpire, 2);
});

test("cascade counts are tallied for the confirmation text", () => {
  const d = planForceDelete({
    eventCount: 3,
    ticketCount: 40,
    membershipCount: 5,
    ticketTypeCount: 7,
    checkoutFlowCount: 2,
    brandingCount: 3,
    checkoutSessionCount: 9,
    orderStatuses: [order("EXPIRED"), order("FAILED")],
  });
  assert.deepEqual(d.counts, {
    orders: 2,
    events: 3,
    tickets: 40,
    memberships: 5,
    ticketTypes: 7,
    checkoutFlows: 2,
    eventBranding: 3,
    checkoutSessions: 9,
    ordersToExpire: 0,
    capturedBuyers: 0,
    capturedAmountPaise: 0,
  });
});

console.log("describeBlocks");

test("a captured-payment block names the amount and says refund first", () => {
  const msg = describeBlocks([{ kind: "captured-payments", count: 2, amountPaise: 400_000 }]);
  assert.match(msg, /₹4000\.00/);
  assert.match(msg, /Refund them first/);
});

test("a single captured payment reads in the singular", () => {
  const msg = describeBlocks([{ kind: "captured-payments", count: 1, amountPaise: 100_000 }]);
  assert.match(msg, /^1 captured payment /);
  assert.doesNotMatch(msg, /payments/);
});

test("an in-flight block explains the wait or the manual expire", () => {
  const msg = describeBlocks([{ kind: "in-flight-orders", count: 1 }]);
  assert.match(msg, /^1 order is still/);
  assert.match(msg, /expire/);
});

test("both blocks are joined into one sentence pair", () => {
  const msg = describeBlocks([
    { kind: "captured-payments", count: 1, amountPaise: 100_000 },
    { kind: "in-flight-orders", count: 3 },
  ]);
  assert.match(msg, /Refund them first/);
  assert.match(msg, /3 orders are still/);
});

console.log(failures === 0 ? "\nall delete-plan checks passed" : `\n${failures} check(s) FAILED`);
// `process.exitCode` rather than `process.exit()`: an explicit exit while the
// event loop still has handles open trips a libuv assertion on Windows and
// turns a passing run into a crash. This still yields a non-zero exit status.
process.exitCode = failures === 0 ? 0 : 1;