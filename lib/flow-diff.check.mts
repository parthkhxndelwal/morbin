/**
 * Checks for the booking-rules diff ("what changed") and pre-publish problems.
 *
 *   npm run check:flow
 */
import assert from "node:assert/strict";
import { diffFlows, summariseDiff } from "./flow-diff.ts";
import { findProblems, type ProblemTicket } from "./flow-problems.ts";
import type { FlowStep } from "./types.ts";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const student = { id: "a1", label: "I'm a student", value: "S" };
const guest = { id: "a2", label: "I'm a guest", value: "G" };
const v1: FlowStep[] = [{ id: "q1", kind: "SINGLE_CHOICE", title: "Who's booking?", required: true, options: [student, guest] }];

check("added answer and a new per-order limit read like the issue's example", () => {
  const v2: FlowStep[] = [
    { ...v1[0], options: [{ ...student, maxPerOrder: 1 }, guest, { id: "a3", label: "Alumni", value: "A" }] },
  ];
  const changes = diffFlows(v1, v2);
  assert.deepEqual(changes, ["“I'm a student” now limited to 1 ticket", "Added answer “Alumni”"]);
  assert.equal(summariseDiff(changes), "“I'm a student” now limited to 1 ticket; Added answer “Alumni”");
});

check("identity, tickets, seats, removal, rewording", () => {
  const v2: FlowStep[] = [
    {
      ...v1[0],
      title: "Who are you?",
      options: [{ ...student, identity: { method: "EMAIL_OTP", emailDomain: "krmu.edu.in" }, allowedTicketTypeIds: ["t1"], capacity: 300 }],
    },
  ];
  const changes = diffFlows(v1, v2, (id) => (id === "t1" ? "Student Pass" : id));
  assert.deepEqual(changes, [
    "Reworded “Who's booking?” to “Who are you?”",
    "Removed answer “I'm a guest”",
    "“I'm a student” now confirms an @krmu.edu.in email",
    "“I'm a student” can now buy Student Pass",
    "“I'm a student” now has 300 seats",
  ]);
  assert.equal(summariseDiff(changes), "Reworded “Who's booking?” to “Who are you?”; Removed answer “I'm a guest”; “I'm a student” now confirms an @krmu.edu.in email; and 2 more");
});

check("questions and ID checks added or removed; no changes; reorder", () => {
  const lookup: FlowStep = {
    id: "l1",
    kind: "LOOKUP",
    title: "Roll number",
    lookup: { datasetId: "d", matchColumn: "roll", oneTicketPerRow: true, emailTemplate: null, identityMethod: null },
  };
  assert.deepEqual(diffFlows(v1, [...v1, lookup]), ["Added an ID check “Roll number”"]);
  assert.deepEqual(diffFlows([...v1, lookup], v1), ["Removed the ID check “Roll number”"]);
  assert.deepEqual(diffFlows([], v1), ["Added the question “Who's booking?”"]);
  assert.deepEqual(
    diffFlows([lookup], [{ ...lookup, lookup: { ...lookup.lookup!, emailTemplate: "{{value}}@x.in", identityMethod: "EMAIL_OTP" } }]),
    ["“Roll number” now confirms {{value}}@x.in"],
  );
  assert.deepEqual(diffFlows(v1, v1), []);
  assert.equal(summariseDiff([]), "No changes");
  assert.deepEqual(diffFlows([...v1, lookup], [lookup, ...v1]), ["Reordered the questions"]);
});

const t = (id: string, extra: Partial<ProblemTicket> = {}): ProblemTicket => ({
  id,
  name: id,
  status: "ACTIVE",
  capacity: 10,
  soldCount: 0,
  audienceOptionIds: null,
  ...extra,
});

check("pre-publish: tickets no group can buy", () => {
  const steps: FlowStep[] = [{ ...v1[0], options: [{ ...student, allowedTicketTypeIds: ["Pass"] }, { ...guest, allowedTicketTypeIds: ["Pass"] }] }];
  const texts = findProblems(steps, { tickets: [t("Pass"), t("VIP")] }).map((p) => p.text);
  assert.ok(texts.includes("No group can buy “VIP”."));
  assert.ok(!texts.includes("No group can buy “Pass”."));
  // A type that names an audience nobody can pick.
  const texts2 = findProblems(v1, { tickets: [t("Pass", { audienceOptionIds: ["gone"] })] }).map((p) => p.text);
  assert.ok(texts2.includes("No group can buy “Pass”."));
});

check("pre-publish: a group whose tickets are all paused or sold out; no sellable tickets", () => {
  const steps: FlowStep[] = [{ ...v1[0], options: [{ ...student, allowedTicketTypeIds: ["Free"] }, guest] }];
  const p = findProblems(steps, { tickets: [t("Free", { soldCount: 10 }), t("Paid")] });
  assert.ok(p.some((x) => !x.blocking && x.text.includes("“I'm a student” can buy is paused or sold out")));
  const none = findProblems(v1, { tickets: [t("A", { status: "PAUSED" })] });
  assert.ok(none.some((x) => x.text.startsWith("No ticket is on sale right now")));
  assert.ok(findProblems(v1, { tickets: [] }).some((x) => x.text === "There are no tickets yet, so nobody can book."));
});

check("pre-publish: existing blocking rules still apply", () => {
  const bad: FlowStep[] = [{ id: "q", kind: "SINGLE_CHOICE", title: "", options: [{ ...student, allowedTicketTypeIds: [] }] }];
  const p = findProblems(bad, { tickets: [t("A")] });
  assert.ok(p.some((x) => x.blocking && x.text === "Question 1 has no wording."));
  assert.ok(p.some((x) => x.blocking && x.text.includes("needs at least two answers")));
  assert.ok(p.some((x) => x.blocking && x.text.includes("can't buy any ticket")));
});

console.log(`\n${passed} flow checks passed`);
