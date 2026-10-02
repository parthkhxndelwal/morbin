/**
 * The KRMU scenario, exercised against the real evaluator.
 *
 * `resolveOffer` is the one place that decides what a buyer may do, and it is
 * pure — no database, no request. That makes the rules worth pinning down in
 * tests rather than only in the UI, because the dashboard builder, the drawer
 * and the order route all depend on getting this exactly right.
 *
 *   node --experimental-strip-types scripts/test-flow.ts
 */
import { strict as assert } from "node:assert";
import { emailMatchesIdentity, permissiveFlow, resolveOffer } from "../lib/flow-rules.ts";
import type { CheckoutFlow, TicketType } from "../lib/types.ts";

/** A ticket type with just enough shape for the evaluator. */
function type(
  id: string,
  pricePaise: number,
  extra: Partial<TicketType> = {},
): TicketType {
  return {
    _id: { toString: () => id } as never,
    eventId: "e1",
    name: id,
    description: "",
    pricePaise,
    capacity: 100,
    soldCount: 0,
    ...extra,
  } as TicketType;
}

// Restriction works in BOTH directions, and both directions are needed:
//
//   flow option → allowedTicketTypeIds   "a student may only see the student type"
//   ticket type → audienceOptionIds      "only the student audience may buy this"
//
// The student type below is closed on both sides, which is what an organizer
// setting up a student-only ticket actually wants. A type with no
// `audienceOptionIds` is open to every audience that can reach it, so the
// flow-side list alone would still let outsiders buy it.
const TYPES = [
  type("student", 0, { audienceOptionIds: ["o_student"] }),
  type("outsider", 50000),
  type("both", 30000, { audienceOptionIds: ["o_outsider"] }),
];

/** The flow from the plan: student → college link → 1 ticket; outsider → Google → any qty. */
const KRMU: CheckoutFlow = {
  ...permissiveFlow("e1"),
  steps: [
    {
      id: "s1_audience",
      kind: "SINGLE_CHOICE",
      required: true,
      title: "Are you a KRMU student?",
      options: [
        {
          id: "o_student",
          label: "Yes, I'm a KRMU student",
          value: "STUDENT",
          nextStepId: "s2_identity",
          identity: { method: "EMAIL_OTP", emailDomain: "krmu.edu.in" },
          allowedTicketTypeIds: ["student"],
          maxPerOrder: 1,
          quantityEditable: false,
          capacity: 300,
        },
        {
          id: "o_outsider",
          label: "No, I'm an outsider",
          value: "OUTSIDER",
          nextStepId: "s2_identity",
          identity: { method: "GOOGLE" },
          quantityEditable: true,
          capacity: 200,
        },
      ],
    },
    { id: "s2_identity", kind: "IDENTITY", required: true, title: "Verify your email" },
    { id: "s3_quantity", kind: "QUANTITY", required: true, title: "How many tickets?" },
  ],
};

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

console.log("\nKRMU flow\n");

test("nothing answered yet: the audience question is still missing", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: {},
    identity: { method: "NONE", email: null, verified: false },
    ticketTypes: TYPES,
  });
  assert.deepEqual(offer.missingRequiredSteps, ["s1_audience"]);
});

test("IDENTITY and QUANTITY are never reported as missing questions", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "STUDENT" },
    identity: { method: "EMAIL_OTP", email: null, verified: false },
    ticketTypes: TYPES,
  });
  assert.deepEqual(offer.missingRequiredSteps, []);
});

test("a student sees only the student ticket", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "STUDENT" },
    identity: { method: "EMAIL_OTP", email: "a@krmu.edu.in", verified: true },
    ticketTypes: TYPES,
  });
  assert.deepEqual(offer.ticketTypes.map((t) => t.id), ["student"]);
});

test("a student must confirm by email link, not Google", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "STUDENT" },
    identity: { method: "EMAIL_OTP", email: null, verified: false },
    ticketTypes: TYPES,
  });
  assert.equal(offer.identity.method, "EMAIL_OTP");
});

test("a student's quantity step is hidden and the order is forced to 1", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "STUDENT" },
    identity: { method: "EMAIL_OTP", email: "a@krmu.edu.in", verified: true },
    ticketTypes: TYPES,
  });
  assert.equal(offer.quantityRequired, false);
  assert.deepEqual(offer.forcedItems, [{ ticketTypeId: "student", quantity: 1 }]);
});

test("a student who already has one is sold out for that identity", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "STUDENT" },
    identity: { method: "EMAIL_OTP", email: "a@krmu.edu.in", verified: true },
    ticketTypes: TYPES,
    claimedUnits: 1,
  });
  assert.equal(offer.soldOutForIdentity, true);
  // Critical: no forced item, so an order cannot be manufactured past the cap.
  assert.equal(offer.forcedItems, null);
});

test("a student's cap counts only their own seats, not the branch total", () => {
  // 299 others have booked, but this student has none.
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "STUDENT" },
    identity: { method: "EMAIL_OTP", email: "a@krmu.edu.in", verified: true },
    ticketTypes: TYPES,
    claimedUnits: 0,
    branchClaimedUnits: 299,
  });
  assert.equal(offer.soldOutForIdentity, false);
  assert.deepEqual(offer.forcedItems, [{ ticketTypeId: "student", quantity: 1 }]);
});

test("the student branch's 300-seat allowance is enforced in aggregate", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "STUDENT" },
    identity: { method: "EMAIL_OTP", email: "a@krmu.edu.in", verified: true },
    ticketTypes: TYPES,
    claimedUnits: 0,
    branchClaimedUnits: 300,
  });
  assert.equal(offer.soldOutForIdentity, true);
  assert.equal(offer.forcedItems, null);
});

test("an outsider must confirm with Google", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "OUTSIDER" },
    identity: { method: "GOOGLE", email: null, verified: false },
    ticketTypes: TYPES,
  });
  assert.equal(offer.identity.method, "GOOGLE");
});

test("an outsider gets a quantity stepper", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "OUTSIDER" },
    identity: { method: "GOOGLE", email: "x@gmail.com", verified: true },
    ticketTypes: TYPES,
  });
  assert.equal(offer.quantityRequired, true);
  assert.equal(offer.forcedItems, null);
});

test("an outsider may not buy the student-only ticket", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "OUTSIDER" },
    identity: { method: "GOOGLE", email: "x@gmail.com", verified: true },
    ticketTypes: TYPES,
  });
  assert.ok(!offer.ticketTypes.some((t) => t.id === "student"));
  assert.ok(offer.ticketTypes.some((t) => t.id === "outsider"));
});

test("a ticket type restricted to outsiders is hidden from students", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "STUDENT" },
    identity: { method: "EMAIL_OTP", email: "a@krmu.edu.in", verified: true },
    ticketTypes: TYPES,
  });
  assert.ok(!offer.ticketTypes.some((t) => t.id === "both"));
});

test("quantity never exceeds remaining stock", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "OUTSIDER" },
    identity: { method: "GOOGLE", email: "x@gmail.com", verified: true },
    ticketTypes: [type("outsider", 50000, { capacity: 10, soldCount: 7 })],
  });
  assert.equal(offer.ticketTypes[0].maxSelectable, 3);
});

test("a sold-out type is offered at zero", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "OUTSIDER" },
    identity: { method: "GOOGLE", email: "x@gmail.com", verified: true },
    ticketTypes: [type("outsider", 50000, { capacity: 10, soldCount: 10 })],
  });
  assert.equal(offer.ticketTypes[0].maxSelectable, 0);
  assert.equal(offer.soldOutForIdentity, true);
});

test("a type outside its sale window is not offered", () => {
  const past = new Date(Date.now() - 86_400_000);
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "OUTSIDER" },
    identity: { method: "GOOGLE", email: "x@gmail.com", verified: true },
    ticketTypes: [type("outsider", 50000, { saleEndsAt: past })],
  });
  assert.deepEqual(offer.ticketTypes, []);
});

test("a type's own max-per-order beats the global ceiling", () => {
  const offer = resolveOffer({
    flow: KRMU,
    answers: { s1_audience: "OUTSIDER" },
    identity: { method: "GOOGLE", email: "x@gmail.com", verified: true },
    ticketTypes: [type("outsider", 50000, { defaultMaxPerOrder: 2 })],
  });
  assert.equal(offer.ticketTypes[0].maxSelectable, 2);
});

test("the tightest cap wins when two branches both apply", () => {
  const flow: CheckoutFlow = {
    ...KRMU,
    steps: [
      {
        id: "s1_audience",
        kind: "SINGLE_CHOICE",
        required: true,
        title: "Who are you?",
        options: [
          { id: "o_a", label: "A", value: "A", maxPerOrder: 5 },
          { id: "o_b", label: "B", value: "B", maxPerOrder: 2 },
        ],
      },
      {
        id: "s2_narrow",
        kind: "SINGLE_CHOICE",
        required: true,
        title: "Narrow it",
        options: [
          { id: "o_x", label: "X", value: "X", maxPerOrder: 8 },
          { id: "o_y", label: "Y", value: "Y", maxPerOrder: 1 },
        ],
      },
    ],
  };
  const offer = resolveOffer({
    flow,
    // A says 5, X says 8 → the minimum (5) must win, not the later answer.
    answers: { s1_audience: "A", s2_narrow: "X" },
    identity: { method: "NONE", email: null, verified: true },
    ticketTypes: [type("t", 100)],
  });
  assert.equal(offer.ticketTypes[0].maxSelectable, 5);
});

test("adding a question can only narrow, never widen", () => {
  const flow: CheckoutFlow = {
    ...KRMU,
    steps: [
      {
        id: "s1_audience",
        kind: "SINGLE_CHOICE",
        required: true,
        title: "Who?",
        options: [
          { id: "o_a", label: "A", value: "A", allowedTicketTypeIds: ["x", "y", "z"] },
          { id: "o_b", label: "B", value: "B", allowedTicketTypeIds: ["y", "z"] },
        ],
      },
    ],
  };
  // Audience-neutral types, so this test exercises the *intersection* rule rather
  // than being masked by the per-type audience lists used elsewhere above.
  const types = [type("x", 100), type("y", 100), type("z", 100)];
  const wide = resolveOffer({
    flow,
    answers: { s1_audience: "A" },
    identity: { method: "NONE", email: null, verified: true },
    ticketTypes: types,
  });
  const narrow = resolveOffer({
    flow,
    answers: { s1_audience: "B" },
    identity: { method: "NONE", email: null, verified: true },
    ticketTypes: types,
  });
  assert.deepEqual(wide.ticketTypes.map((t) => t.id).sort(), ["x", "y", "z"]);
  assert.deepEqual(narrow.ticketTypes.map((t) => t.id).sort(), ["y", "z"]);
});

test("two restrictive answers intersect rather than override", () => {
  const flow: CheckoutFlow = {
    ...KRMU,
    steps: [
      {
        id: "s1",
        kind: "SINGLE_CHOICE",
        required: true,
        title: "Who?",
        options: [
          { id: "o_a", label: "A", value: "A", allowedTicketTypeIds: ["x", "y", "z"] },
          { id: "o_b", label: "B", value: "B", allowedTicketTypeIds: ["y", "z"] },
        ],
      },
      {
        id: "s2",
        kind: "SINGLE_CHOICE",
        required: true,
        title: "Which?",
        options: [
          { id: "o_c", label: "C", value: "C", allowedTicketTypeIds: ["y", "z"] },
          { id: "o_d", label: "D", value: "D", allowedTicketTypeIds: ["x", "y"] },
        ],
      },
    ],
  };
  const types = [type("x", 100), type("y", 100), type("z", 100)];
  // A alone is x,y,z and C alone is y,z — together they must be y,z, not "C wins".
  const offer = resolveOffer({
    flow,
    answers: { s1: "A", s2: "C" },
    identity: { method: "NONE", email: null, verified: true },
    ticketTypes: types,
  });
  assert.deepEqual(offer.ticketTypes.map((t) => t.id).sort(), ["y", "z"]);
});

test("one no-stepper branch hides the stepper even with another question", () => {
  const flow: CheckoutFlow = {
    ...KRMU,
    steps: [
      {
        id: "s1",
        kind: "SINGLE_CHOICE",
        required: true,
        title: "Who?",
        options: [
          { id: "o_a", label: "A", value: "A", quantityEditable: true },
          { id: "o_b", label: "B", value: "B", quantityEditable: false },
        ],
      },
      {
        id: "s2",
        kind: "SINGLE_CHOICE",
        required: true,
        title: "More?",
        options: [
          { id: "o_c", label: "C", value: "C", quantityEditable: true },
          { id: "o_d", label: "D", value: "D", quantityEditable: true },
        ],
      },
    ],
  };
  const offer = resolveOffer({
    flow,
    answers: { s1: "B", s2: "D" },
    identity: { method: "NONE", email: null, verified: true },
    ticketTypes: [type("t", 100)],
  });
  assert.equal(offer.quantityRequired, false);
});

test("the permissive flow asks nothing and allows any quantity", () => {
  const offer = resolveOffer({
    flow: permissiveFlow("e1"),
    answers: {},
    identity: { method: "NONE", email: null, verified: false },
    ticketTypes: [type("t", 100)],
  });
  assert.deepEqual(offer.missingRequiredSteps, []);
  assert.equal(offer.quantityRequired, true);
  assert.equal(offer.ticketTypes[0].maxSelectable, 10);
});

test("domain matching is exact, not suffix-based", () => {
  const rule = { emailDomain: "krmu.edu.in" };
  assert.equal(emailMatchesIdentity(rule, "a@krmu.edu.in"), true);
  assert.equal(emailMatchesIdentity(rule, "A@KRMU.EDU.IN"), true);
  // The classic subdomain trap: notkrmu.edu.in must not pass.
  assert.equal(emailMatchesIdentity(rule, "a@notkrmu.edu.in"), false);
  assert.equal(emailMatchesIdentity(rule, "a@krmu.edu.in.evil.com"), false);
  assert.equal(emailMatchesIdentity(rule, "a@gmail.com"), false);
  assert.equal(emailMatchesIdentity(rule, "notanemail"), false);
});

test("an allow-list of Google domains works too", () => {
  const rule = { allowedEmailDomains: ["krmu.edu.in", "gmail.com"] };
  assert.equal(emailMatchesIdentity(rule, "a@gmail.com"), true);
  assert.equal(emailMatchesIdentity(rule, "a@KRMU.edu.in"), true);
  assert.equal(emailMatchesIdentity(rule, "a@outlook.com"), false);
});

test("with no domain rule, any address qualifies", () => {
  assert.equal(emailMatchesIdentity({ allowedEmailDomains: null }, "anyone@anywhere.com"), true);
  assert.equal(emailMatchesIdentity(null, "anyone@anywhere.com"), true);
});

console.log(`\n${passed} passed\n`);
