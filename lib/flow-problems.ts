import type { FlowOption, FlowStep } from "./types.ts";
import { templateErrors } from "./template-rules.ts";

/**
 * Pre-publish checks for booking rules, pure: the builder shows them live and
 * blocks Save/Publish on the blocking ones. Relative imports (not `@/`) so
 * `lib/flow-diff.check.mts` can run them under plain Node.
 *
 * Blocking problems would be refused on save or leave buyers stuck; the rest
 * are warnings worth a look before publishing.
 */

export type Problem = { blocking: boolean; text: string };

export interface ProblemTicket {
  id: string;
  name: string;
  status: string | null;
  capacity: number;
  soldCount: number;
  audienceOptionIds: string[] | null;
}

export interface ProblemDataset {
  id: string;
  name: string;
  columns: { key: string }[];
  /** First row, or null when the dataset is empty. */
  sample: Record<string, string> | null;
}

const label = (a: FlowOption, i: number) => `“${a.label || `answer ${i + 1}`}”`;

function onSale(t: ProblemTicket): boolean {
  return t.status !== "PAUSED" && t.status !== "HIDDEN" && t.soldCount < t.capacity;
}

/** Can a buyer who picked `answer` (on its question) see ticket `t` at all? */
function answerAllows(answer: FlowOption, t: ProblemTicket): boolean {
  if (answer.allowedTicketTypeIds && !answer.allowedTicketTypeIds.includes(t.id)) return false;
  if (t.audienceOptionIds?.length && !t.audienceOptionIds.includes(answer.id)) {
    // The type names other audiences; this answer qualifies only if it is one.
    return false;
  }
  return true;
}

function lookupProblems(q: FlowStep, name: string, datasets: ProblemDataset[]): Problem[] {
  const out: Problem[] = [];
  if (!q.title.trim()) out.push({ blocking: true, text: `${name} has no wording.` });
  const l = q.lookup;
  const dataset = datasets.find((d) => d.id === l?.datasetId);
  if (!l || !dataset) {
    out.push({ blocking: true, text: `${name}: choose the list to check against.` });
    return out;
  }
  if (!dataset.columns.some((c) => c.key === l.matchColumn)) {
    out.push({ blocking: true, text: `${name}: choose which column to match.` });
  }
  if (l.emailTemplate) {
    for (const e of templateErrors(l.emailTemplate, dataset.columns.map((c) => c.key))) {
      out.push({ blocking: true, text: `${name}: ${e}.` });
    }
  } else if (l.identityMethod === "EMAIL_OTP") {
    out.push({ blocking: true, text: `${name} confirms an email but has no email template.` });
  }
  if (dataset.columns.length && !dataset.sample) {
    out.push({ blocking: false, text: `${name}: “${dataset.name}” has no rows yet, so nobody can match.` });
  }
  return out;
}

export function findProblems(
  questions: FlowStep[],
  ctx: { datasets?: ProblemDataset[]; tickets?: ProblemTicket[] } = {},
): Problem[] {
  const datasets = ctx.datasets ?? [];
  const tickets = ctx.tickets ?? [];
  const out: Problem[] = [];
  if (questions.filter((q) => q.kind === "LOOKUP" && q.lookup?.identityMethod === "EMAIL_OTP").length > 1) {
    out.push({ blocking: true, text: "Only one ID question can decide which email is confirmed." });
  }
  questions.forEach((q, qi) => {
    const name = `Question ${qi + 1}`;
    if (q.kind === "LOOKUP") {
      out.push(...lookupProblems(q, name, datasets));
      return;
    }
    if (!q.title.trim()) out.push({ blocking: true, text: `${name} has no wording.` });
    const answers = q.options ?? [];
    if (answers.length < 2) out.push({ blocking: true, text: `${name} needs at least two answers to choose from.` });
    answers.forEach((a, ai) => {
      if (!a.label.trim()) out.push({ blocking: true, text: `${name}: answer ${ai + 1} is empty.` });
      if (a.identity?.method === "EMAIL_OTP" && !a.identity.emailDomain) {
        out.push({
          blocking: false,
          text: `${name}: ${label(a, ai)} confirms an email but doesn't limit the domain, so any address works.`,
        });
      }
      if (a.allowedTicketTypeIds && a.allowedTicketTypeIds.length === 0) {
        out.push({ blocking: true, text: `${name}: ${label(a, ai)} can't buy any ticket.` });
      } else if (tickets.length) {
        const theirs = tickets.filter((t) => t.status !== "HIDDEN" && answerAllows(a, t));
        if (theirs.length > 0 && !theirs.some(onSale)) {
          out.push({
            blocking: false,
            text: `${name}: every ticket ${label(a, ai)} can buy is paused or sold out, so they'd be stuck.`,
          });
        }
      }
    });
    const labels = answers.map((a) => a.label.trim().toLowerCase()).filter(Boolean);
    if (new Set(labels).size !== labels.length) out.push({ blocking: true, text: `${name} has two answers with the same wording.` });
  });

  if (tickets.length === 0 || !tickets.some(onSale)) {
    out.push({
      blocking: false,
      text: tickets.length === 0 ? "There are no tickets yet, so nobody can book." : "No ticket is on sale right now — they're all paused, hidden or sold out.",
    });
  } else {
    const choiceQuestions = questions.filter((q) => q.kind === "SINGLE_CHOICE" && q.options?.length);
    for (const t of tickets) {
      if (t.status === "HIDDEN") continue;
      // Buyable only if every question has at least one answer that allows it.
      const reachable = choiceQuestions.every((q) => q.options!.some((a) => answerAllows(a, t)));
      const namesAudience = !!t.audienceOptionIds?.length;
      const audienceExists = !namesAudience || choiceQuestions.some((q) => q.options!.some((a) => t.audienceOptionIds!.includes(a.id)));
      if (!reachable || !audienceExists) {
        out.push({ blocking: false, text: `No group can buy “${t.name}”.` });
      }
    }
  }
  return out;
}
