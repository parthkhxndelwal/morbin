/**
 * Email-from-template, pure.
 *
 * A lookup question can derive the address to verify from what the buyer
 * typed and the dataset row it matched:
 *
 *   {{value}}@krmu.edu.in                 →  23013@krmu.edu.in
 *   {{value|trim|lower}}@krmu.edu.in
 *   {{row.email}}                         →  the matched row's email column
 *   {{row.first_name|lower}}.{{value|digits}}@college.edu
 *
 * `value` is the matched row's own value in the matched column, with
 * whitespace removed — the organiser's spelling, not the buyer's typing, so
 * " 23 013 " and "23013" derive the same address.
 *
 * Variables: `value` and `row.<column key>`. Filters: lower, upper, trim,
 * digits; chainable left to right. Anything else is an error found when the
 * organiser saves (with the offending part named), never at checkout.
 *
 * No `@/` imports, so `lib/template-rules.check.mts` runs it under plain Node,
 * and the builder's live example, the save-time check and checkout all agree.
 */

export const TEMPLATE_FILTERS = ["lower", "upper", "trim", "digits"] as const;
export type TemplateFilter = (typeof TEMPLATE_FILTERS)[number];

const MAX_TEMPLATE_LENGTH = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Part = { text: string } | { variable: string; filters: string[]; source: string };

/** Split a template into literal text and `{{…}}` placeholders. */
function parse(template: string): { parts: Part[]; errors: string[] } {
  const parts: Part[] = [];
  const errors: string[] = [];
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("{{", i);
    if (open === -1) {
      parts.push({ text: template.slice(i) });
      break;
    }
    if (open > i) parts.push({ text: template.slice(i, open) });
    const close = template.indexOf("}}", open + 2);
    if (close === -1) {
      errors.push(`“${template.slice(open)}” is missing its closing }}`);
      break;
    }
    const source = template.slice(open, close + 2);
    const [variable, ...filters] = template
      .slice(open + 2, close)
      .split("|")
      .map((s) => s.trim());
    parts.push({ variable, filters, source });
    i = close + 2;
  }
  for (const p of parts) if ("text" in p && p.text.includes("}}")) errors.push(`A stray }} in “${p.text}”`);
  return { parts, errors };
}

/**
 * Problems with a template, each naming the part that's wrong. `columns` are
 * the dataset's column keys (for `row.<key>`). Empty array = valid.
 */
export function templateErrors(template: string, columns: readonly string[]): string[] {
  if (!template.trim()) return ["The email template is empty"];
  if (template.length > MAX_TEMPLATE_LENGTH) return [`The email template is longer than ${MAX_TEMPLATE_LENGTH} characters`];
  const { parts, errors } = parse(template);
  if (!parts.some((p) => "variable" in p)) errors.push("The template must use {{value}} or a {{row.…}} column");
  for (const p of parts) {
    if (!("variable" in p)) continue;
    if (p.variable === "value") {
      // ok
    } else if (p.variable.startsWith("row.")) {
      const col = p.variable.slice(4);
      if (!columns.includes(col)) errors.push(`Unknown column “${col}” in ${p.source}`);
    } else {
      errors.push(`Unknown variable “${p.variable || "(empty)"}” in ${p.source} — use value or row.<column>`);
    }
    for (const f of p.filters) {
      if (!(TEMPLATE_FILTERS as readonly string[]).includes(f)) {
        errors.push(`Unknown filter “${f || "(empty)"}” in ${p.source} — use ${TEMPLATE_FILTERS.join(", ")}`);
      }
    }
  }
  if (errors.length === 0) {
    // The shape must be able to produce an address at all.
    const sample = renderTemplate(template, { value: "sample1", row: Object.fromEntries(columns.map((c) => [c, "sample1"])) });
    if (!isEmailAddress(sample)) errors.push(`The template doesn't produce an email address (e.g. “${sample}”)`);
  }
  return errors;
}

function applyFilter(value: string, filter: string): string {
  switch (filter) {
    case "lower":
      return value.toLowerCase();
    case "upper":
      return value.toUpperCase();
    case "trim":
      return value.trim();
    case "digits":
      return value.replace(/\D+/g, "");
    default:
      return value;
  }
}

/** Fill a (valid) template. Unknown variables render empty; callers validate first. */
export function renderTemplate(template: string, input: { value: string; row: Record<string, string> }): string {
  const { parts } = parse(template);
  return parts
    .map((p) => {
      if ("text" in p) return p.text;
      const base = p.variable === "value" ? input.value : p.variable.startsWith("row.") ? (input.row[p.variable.slice(4)] ?? "") : "";
      return p.filters.reduce(applyFilter, base);
    })
    .join("")
    .trim();
}

export function isEmailAddress(value: string): boolean {
  return value.length <= 200 && EMAIL_RE.test(value);
}

/**
 * The derived address for a lookup, lower-cased, or null when the template
 * doesn't produce a usable address for this row (e.g. an empty email column).
 */
export function deriveEmail(template: string, value: string, row: Record<string, string>): string | null {
  const out = renderTemplate(template, { value, row }).toLowerCase();
  return isEmailAddress(out) ? out : null;
}

/** `23013@krmu.edu.in` → `2****@krmu.edu.in`: enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "****";
  return `${local.slice(0, 1)}****@${domain}`;
}

/** What `{{value}}` stands for: the matched cell, whitespace removed. */
export function lookupValue(cell: string): string {
  return cell.replace(/\s+/g, "");
}
