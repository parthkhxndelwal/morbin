/**
 * Checks for email-from-template and the lookup rules in the flow evaluator.
 *
 *   npm run check:templates
 */
import assert from "node:assert/strict";
import { normaliseKey } from "./dataset-rules.ts";
import { lookupIdentityStep, resolveOffer } from "./flow-rules.ts";
import { deriveEmail, lookupValue, maskEmail, renderTemplate, templateErrors } from "./template-rules.ts";
import type { CheckoutFlow, FlowStep, TicketType } from "./types.ts";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const cols = ["roll_number", "email", "first_name"];

check("valid templates render, filters chain left to right", () => {
  assert.deepEqual(templateErrors("{{value}}@krmu.edu.in", cols), []);
  assert.equal(renderTemplate("{{value}}@krmu.edu.in", { value: "23013", row: {} }), "23013@krmu.edu.in");
  assert.equal(renderTemplate("{{ value | trim | lower }}@x.in", { value: "  AB12 ", row: {} }), "ab12@x.in");
  assert.equal(renderTemplate("{{value|digits}}@x.in", { value: "KR-23 013", row: {} }), "23013@x.in");
  assert.equal(renderTemplate("{{row.first_name|lower}}.{{value}}@x.in", { value: "7", row: { first_name: "Asha" } }), "asha.7@x.in");
  assert.equal(renderTemplate("{{row.email}}", { value: "7", row: { email: "a@b.in" } }), "a@b.in");
  assert.equal(renderTemplate("{{value|upper}}@x.in", { value: "ab", row: {} }), "AB@x.in");
});

check("typos are save-time errors naming the part that's wrong", () => {
  assert.match(templateErrors("{{value|lowr}}@x.in", cols)[0], /Unknown filter “lowr” in \{\{value\|lowr\}\}/);
  assert.match(templateErrors("{{vaule}}@x.in", cols)[0], /Unknown variable “vaule”/);
  assert.match(templateErrors("{{row.mail}}", cols)[0], /Unknown column “mail” in \{\{row\.mail\}\}/);
  assert.match(templateErrors("{{value@x.in", cols)[0], /missing its closing/);
  assert.match(templateErrors("23013@x.in", cols)[0], /must use \{\{value\}\}/);
  assert.match(templateErrors("{{value}}", cols)[0], /doesn't produce an email address/);
  assert.match(templateErrors("", cols)[0], /empty/);
  assert.match(templateErrors("{{value}}@x}}.in", cols)[0], /stray/);
});

check("derived emails are lower-cased and must be valid", () => {
  assert.equal(deriveEmail("{{value}}@KRMU.edu.in", "23013", {}), "23013@krmu.edu.in");
  assert.equal(deriveEmail("{{row.email}}", "1", { email: "" }), null);
  assert.equal(deriveEmail("{{row.email}}", "1", { email: "not an email" }), null);
});

check("{{value}} is the matched cell with whitespace removed", () => {
  assert.equal(lookupValue(" 23 013 "), "23013");
  assert.equal(deriveEmail("{{value}}@x.in", lookupValue("AB 12"), {}), "ab12@x.in");
});

check("masking shows the first character and the domain only", () => {
  assert.equal(maskEmail("23013@krmu.edu.in"), "2****@krmu.edu.in");
  assert.equal(maskEmail("weird"), "****");
});

check("lookup keys normalise like dataset keys", () => {
  assert.equal(normaliseKey(" 23 013 "), normaliseKey("23013"));
  assert.equal(normaliseKey("Ab 12"), "ab12");
});

const lookupStep: FlowStep = {
  id: "l1",
  kind: "LOOKUP",
  title: "Enter your roll number",
  required: true,
  lookup: { datasetId: "d", matchColumn: "roll_number", emailTemplate: "{{value}}@krmu.edu.in", identityMethod: "EMAIL_OTP", oneTicketPerRow: true },
};
const flow: CheckoutFlow = { eventId: "e", version: 1, status: "PUBLISHED", steps: [lookupStep], createdAt: new Date(0), updatedAt: new Date(0) };
const pass = { _id: { toString: () => "t1" }, eventId: "e", name: "Student Pass", description: "", pricePaise: 0, capacity: 100, soldCount: 0 } as unknown as TicketType;

check("evaluator: an unanswered lookup is a missing step; the derived email is verified; one ticket per row", () => {
  const before = resolveOffer({ flow, answers: {}, identity: { method: "NONE", email: null, verified: false }, ticketTypes: [pass] });
  assert.deepEqual(before.missingRequiredSteps, ["l1"]);
  assert.equal(before.identity.method, "EMAIL_OTP");
  const after = resolveOffer({ flow, answers: { l1: "23013" }, identity: { method: "NONE", email: null, verified: false }, ticketTypes: [pass] });
  assert.deepEqual(after.missingRequiredSteps, []);
  assert.equal(after.ticketTypes[0].maxSelectable, 1);
  // Someone holding a ticket under this identity is sold out (the row's claim is the hard stop).
  const again = resolveOffer({ flow, answers: { l1: "23013" }, identity: { method: "EMAIL_OTP", email: "23013@krmu.edu.in", verified: true }, ticketTypes: [pass], claimedUnits: 1 });
  assert.equal(again.soldOutForIdentity, true);
  assert.equal(lookupIdentityStep(flow)?.id, "l1");
  assert.equal(lookupIdentityStep({ steps: [{ ...lookupStep, lookup: { ...lookupStep.lookup!, identityMethod: null } }] }), null);
});

console.log(`\n${passed} template checks passed`);
