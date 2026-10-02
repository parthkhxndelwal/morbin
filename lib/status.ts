/**
 * Every status the UI shows, described once.
 *
 * `StatusBadge` reads these maps, so "PUBLISHED" or "REFUNDED" looks and reads
 * the same on every screen. Adding a status means adding one row here; a
 * missing row falls back to a neutral badge with the raw value rather than
 * crashing a page.
 */

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  /** One line shown as the badge's tooltip. */
  description?: string;
}

type StatusMap = Record<string, StatusMeta>;

export const STATUS = {
  event: {
    DRAFT: { label: "Draft", tone: "neutral", description: "Not visible to buyers yet." },
    PUBLISHED: { label: "Published", tone: "success", description: "Live and selling." },
    CANCELLED: { label: "Cancelled", tone: "danger", description: "Sales stopped; buyers notified." },
    ENDED: { label: "Ended", tone: "neutral", description: "The event has finished." },
  },
  order: {
    CREATED: { label: "Awaiting payment", tone: "warning", description: "Seats held while the buyer pays." },
    PAID: { label: "Paid", tone: "success" },
    FAILED: { label: "Failed", tone: "danger", description: "Payment did not go through." },
    EXPIRED: { label: "Expired", tone: "neutral", description: "The buyer did not pay in time; seats released." },
    REFUNDED: { label: "Refunded", tone: "info" },
    PARTIALLY_REFUNDED: { label: "Partly refunded", tone: "info" },
  },
  ticket: {
    VALID: { label: "Valid", tone: "success" },
    USED: { label: "Checked in", tone: "info" },
    REFUNDED: { label: "Refunded", tone: "neutral" },
    VOID: { label: "Void", tone: "danger" },
  },
  organization: {
    ACTIVE: { label: "Active", tone: "success" },
    SUSPENDED: { label: "Suspended", tone: "danger", description: "Cannot publish or sell." },
  },
  paymentAccount: {
    NOT_STARTED: { label: "Not started", tone: "neutral" },
    PENDING: { label: "Pending review", tone: "warning" },
    VERIFIED: { label: "Verified", tone: "success", description: "Can sell paid tickets." },
    REJECTED: { label: "Rejected", tone: "danger" },
    RESTRICTED: { label: "Restricted", tone: "danger" },
  },
  payout: {
    DRAFT: { label: "Draft", tone: "neutral" },
    PAID: { label: "Paid", tone: "success", description: "Transferred; awaiting acknowledgement." },
    ACKNOWLEDGED: { label: "Acknowledged", tone: "success" },
    DISPUTED: { label: "Query raised", tone: "warning" },
    RESOLVED: { label: "Resolved", tone: "info" },
    CANCELLED: { label: "Cancelled", tone: "neutral" },
  },
  refund: {
    REQUESTED: { label: "Awaiting approval", tone: "warning" },
    APPROVED: { label: "Approved", tone: "info" },
    PROCESSING: { label: "Processing", tone: "info", description: "Sent to Razorpay." },
    COMPLETED: { label: "Refunded", tone: "success" },
    FAILED: { label: "Failed", tone: "danger" },
    COMPLETED_MANUALLY: { label: "Refunded manually", tone: "success" },
    COMPLETED_BY_ORG: { label: "Settled by organisation", tone: "success" },
    REJECTED: { label: "Rejected", tone: "danger" },
    CANCELLED: { label: "Withdrawn", tone: "neutral" },
  },
  member: {
    OWNER: { label: "Owner", tone: "info" },
    MEMBER: { label: "Staff", tone: "neutral" },
  },
} satisfies Record<string, StatusMap>;

export type StatusKind = keyof typeof STATUS;

export function statusMeta(kind: StatusKind, value: string | null | undefined): StatusMeta {
  const map: StatusMap = STATUS[kind];
  if (value && map[value]) return map[value];
  return { label: value ? humanize(value) : "Unknown", tone: "neutral" };
}

function humanize(value: string): string {
  const s = value.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
