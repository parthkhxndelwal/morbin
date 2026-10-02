import assert from "node:assert/strict";
import { addMonths, isPastRetention, piiDueAt, retentionCutoff, retentionDue, yearsAgo } from "./retention-rules.ts";

const d = (s: string) => new Date(s);
let n = 0;
function t(name: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
}

t("adds months and clamps to month end", () => {
  assert.equal(addMonths(d("2026-01-31T10:00:00Z"), 1).toISOString(), "2026-02-28T10:00:00.000Z");
  assert.equal(addMonths(d("2028-01-31T00:00:00Z"), 1).toISOString(), "2028-02-29T00:00:00.000Z");
  assert.equal(addMonths(d("2026-03-31T00:00:00Z"), -1).toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(addMonths(d("2026-05-15T00:00:00Z"), 24).toISOString(), "2028-05-15T00:00:00.000Z");
});

t("25 months after the event is past a 24-month retention; 23 is not", () => {
  const now = d("2026-10-02T12:00:00Z");
  assert.equal(isPastRetention(addMonths(now, -25), 24, now), true);
  assert.equal(isPastRetention(addMonths(now, -23), 24, now), false);
  assert.equal(isPastRetention(addMonths(now, -24), 24, now), true, "due exactly at the boundary");
});

t("the cutoff agrees with the per-event check", () => {
  const now = d("2026-03-31T00:00:00Z");
  for (const months of [1, 6, 12, 24, 36]) {
    const cutoff = retentionCutoff(now, months);
    assert.equal(isPastRetention(new Date(cutoff.getTime() - 1), months, now), true);
    assert.ok(piiDueAt(cutoff, months).getTime() <= now.getTime() + 3 * 864e5, "within a month-end clamp");
  }
});

t("eight years back", () => {
  assert.equal(yearsAgo(d("2034-04-01T00:00:00Z"), 8).toISOString(), "2026-04-01T00:00:00.000Z");
});

t("runs at most daily", () => {
  const now = d("2026-10-02T12:00:00Z");
  assert.equal(retentionDue(null, now), true);
  assert.equal(retentionDue(d("2026-10-02T00:00:00Z"), now), false);
  assert.equal(retentionDue(d("2026-10-01T11:59:00Z"), now), true);
});

console.log(`check:retention — ${n} passed`);
