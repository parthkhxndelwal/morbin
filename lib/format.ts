/**
 * The one place money, dates and counts are turned into text.
 *
 * Pure and dependency-free so both server and client components (and plain
 * Node check scripts) can import it. Amounts are always integer paise.
 */

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const INR_COMPACT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** ₹1,234.50 */
export function formatINR(paise: number): string {
  return INR.format(paise / 100);
}

/** ₹1.2L — for KPI tiles where precision would be noise. */
export function formatINRCompact(paise: number): string {
  return INR_COMPACT.format(paise / 100);
}

/** The app's display timezone when an event does not specify one. */
export const DEFAULT_TIMEZONE = "Asia/Kolkata";

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** 2 Oct 2026 */
export function formatDate(value: Date | string | number, timeZone = DEFAULT_TIMEZONE): string {
  return toDate(value).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone,
  });
}

/** 2 Oct 2026, 7:30 pm */
export function formatDateTime(
  value: Date | string | number,
  timeZone = DEFAULT_TIMEZONE,
): string {
  return toDate(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
}

/** "3 days ago", "in 2 hours" — relative to `now`. */
export function formatRelative(value: Date | string | number, now = new Date()): string {
  const diffSeconds = Math.round((toDate(value).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en-IN", { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSeconds) >= seconds) return rtf.format(Math.round(diffSeconds / seconds), unit);
  }
  return rtf.format(diffSeconds, "second");
}

/** 1,234 */
export function formatCount(n: number): string {
  return n.toLocaleString("en-IN");
}

/** "1 ticket" / "3 tickets" */
export function pluralize(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(n)} ${n === 1 ? singular : plural}`;
}
