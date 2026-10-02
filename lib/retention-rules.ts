/**
 * When data is due to go. Pure (no imports) so `retention-rules.check.mts`
 * runs under plain Node, and the job and the admin page agree on the dates.
 */

/** GST law: tax invoices are kept 8 years from issue. Change only on a CA's advice. */
export const INVOICE_RETENTION_YEARS = 8;
/** Audit entries (never PII) are kept as long as the financial records they explain. */
export const AUDIT_RETENTION_YEARS = 8;
/** Checkouts that never became an order. */
export const ABANDONED_SESSION_DAYS = 30;
/** Rendered email content (names, links, QR images); the delivery row itself stays. */
export const EMAIL_META_DAYS = 90;
/** Uploads never saved to an event's branding. */
export const ORPHAN_MEDIA_HOURS = 24;
/** Dashboard notifications, once read. */
export const READ_NOTIFICATION_DAYS = 365;
/** The job runs at most once in this window, however often the scheduler ticks. */
export const RETENTION_INTERVAL_HOURS = 24;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `date` moved by whole calendar months, clamped to the last day of the target
 * month (31 Jan + 1 month = 28/29 Feb), in UTC.
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** The moment an event's attendee data is due to be anonymised. */
export function piiDueAt(endsAt: Date, retentionMonths: number): Date {
  return addMonths(endsAt, retentionMonths);
}

export function isPastRetention(endsAt: Date, retentionMonths: number, now: Date): boolean {
  return piiDueAt(endsAt, retentionMonths).getTime() <= now.getTime();
}

/** The earliest `endsAt` still inside retention: events ending before it are due. */
export function retentionCutoff(now: Date, retentionMonths: number): Date {
  return addMonths(now, -retentionMonths);
}

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function yearsAgo(now: Date, years: number): Date {
  return addMonths(now, -12 * years);
}

/** Whether the daily job is due, given when it last finished. */
export function retentionDue(lastFinishedAt: Date | null, now: Date): boolean {
  return !lastFinishedAt || now.getTime() - lastFinishedAt.getTime() >= RETENTION_INTERVAL_HOURS * 60 * 60 * 1000;
}
