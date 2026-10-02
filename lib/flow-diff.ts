import type { FlowOption, FlowStep } from "./types.ts";

/**
 * "What changed" between two versions of booking rules, in plain words, for
 * the History panel and the support-proposal callout. Pure; relative imports
 * so `lib/flow-diff.check.mts` runs it under plain Node.
 *
 *   Added answer “Alumni”; “I'm a student” now limited to 1 ticket
 */

const q = (s: string) => `“${s.trim() || "untitled"}”`;

function identityText(o: FlowOption): string {
  const m = o.identity?.method ?? "NONE";
  if (m === "EMAIL_OTP") return o.identity?.emailDomain ? `confirms an @${o.identity.emailDomain} email` : "confirms their email";
  if (m === "GOOGLE") return "signs in with Google";
  return "needs no sign-in";
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function answerChanges(prev: FlowOption, next: FlowOption, ticketName: (id: string) => string): string[] {
  const who = q(next.label);
  const out: string[] = [];
  if (prev.label.trim() !== next.label.trim()) out.push(`Renamed answer ${q(prev.label)} to ${who}`);
  if (!same(prev.identity?.method ?? "NONE", next.identity?.method ?? "NONE") || !same(prev.identity?.emailDomain, next.identity?.emailDomain)) {
    out.push(`${who} now ${identityText(next)}`);
  }
  if (prev.quantityEditable !== next.quantityEditable && next.quantityEditable === false) {
    out.push(`${who} now get exactly 1 ticket`);
  } else if (!same(prev.maxPerOrder, next.maxPerOrder) || (prev.quantityEditable === false && next.quantityEditable !== false)) {
    out.push(typeof next.maxPerOrder === "number" ? `${who} now limited to ${next.maxPerOrder} ticket${next.maxPerOrder === 1 ? "" : "s"}` : `${who} no longer limited per order`);
  }
  if (!same(prev.allowedTicketTypeIds, next.allowedTicketTypeIds)) {
    out.push(
      next.allowedTicketTypeIds
        ? `${who} can now buy ${next.allowedTicketTypeIds.map(ticketName).join(", ") || "nothing"}`
        : `${who} can now buy any ticket`,
    );
  }
  if (!same(prev.capacity, next.capacity)) {
    out.push(typeof next.capacity === "number" ? `${who} now has ${next.capacity} seats` : `${who} no longer has a seat limit`);
  }
  if (!same(prev.showFieldIds, next.showFieldIds)) out.push(`${who} is asked different details`);
  return out;
}

function lookupChanges(prev: FlowStep, next: FlowStep): string[] {
  const a = prev.lookup;
  const b = next.lookup;
  const out: string[] = [];
  if (prev.title.trim() !== next.title.trim()) out.push(`Reworded ${q(prev.title)} to ${q(next.title)}`);
  if (!a || !b) return out;
  if (a.datasetId !== b.datasetId || a.matchColumn !== b.matchColumn) out.push(`${q(next.title)} now checks a different list`);
  if (a.oneTicketPerRow !== b.oneTicketPerRow) out.push(`${q(next.title)} ${b.oneTicketPerRow ? "now allows one ticket per ID" : "no longer limits tickets per ID"}`);
  if ((a.emailTemplate ?? "") !== (b.emailTemplate ?? "") || (a.identityMethod ?? null) !== (b.identityMethod ?? null)) {
    out.push(b.identityMethod === "EMAIL_OTP" && b.emailTemplate ? `${q(next.title)} now confirms ${b.emailTemplate}` : `${q(next.title)} no longer confirms an email`);
  }
  return out;
}

/** Plain-language changes from `prev` to `next`, in step order. Empty = no changes. */
export function diffFlows(prev: FlowStep[], next: FlowStep[], ticketName: (id: string) => string = (id) => id): string[] {
  const out: string[] = [];
  const prevById = new Map(prev.map((s) => [s.id, s]));
  const nextIds = new Set(next.map((s) => s.id));
  for (const s of prev) {
    if (!nextIds.has(s.id)) out.push(s.kind === "LOOKUP" ? `Removed the ID check ${q(s.title)}` : `Removed the question ${q(s.title)}`);
  }
  for (const s of next) {
    const p = prevById.get(s.id);
    if (!p) {
      out.push(s.kind === "LOOKUP" ? `Added an ID check ${q(s.title)}` : `Added the question ${q(s.title)}`);
      continue;
    }
    if (s.kind === "LOOKUP") {
      out.push(...lookupChanges(p, s));
      continue;
    }
    if (p.title.trim() !== s.title.trim()) out.push(`Reworded ${q(p.title)} to ${q(s.title)}`);
    const before = new Map((p.options ?? []).map((o) => [o.id, o]));
    const after = new Set((s.options ?? []).map((o) => o.id));
    for (const o of p.options ?? []) if (!after.has(o.id)) out.push(`Removed answer ${q(o.label)}`);
    for (const o of s.options ?? []) {
      const was = before.get(o.id);
      if (!was) out.push(`Added answer ${q(o.label)}`);
      else out.push(...answerChanges(was, o, ticketName));
    }
  }
  const order = (steps: FlowStep[]) => steps.filter((x) => nextIds.has(x.id) && prevById.has(x.id)).map((x) => x.id).join();
  if (out.length === 0 && order(prev) !== order(next)) out.push("Reordered the questions");
  return out;
}

/** One line for a list: the first few changes, capitalised. */
export function summariseDiff(changes: string[], max = 3): string {
  if (changes.length === 0) return "No changes";
  const shown = changes.slice(0, max).join("; ");
  const rest = changes.length - max;
  return rest > 0 ? `${shown}; and ${rest} more` : shown;
}
