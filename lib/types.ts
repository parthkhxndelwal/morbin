import type { ObjectId } from "mongodb";
import type { FeeBearer, OrderPricing, RefundSpeed } from "@/lib/pricing";

export type OnboardingStatus = "STARTED" | "PROFILE_DONE" | "PAYMENT_PENDING" | "ACTIVE";
export type PaymentAccountStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "VERIFIED"
  | "REJECTED"
  | "RESTRICTED";

/**
 * What an organization does. This drives how its non-owner members are
 * labelled, and nothing else — a member's role is always OWNER or MEMBER, so
 * changing an organization's type can never leave a stale role behind.
 */
export type OrganizationType = "EVENT" | "INSTITUTION" | "CORPORATE";

export const ORGANIZATION_TYPES: OrganizationType[] = [
  "EVENT",
  "INSTITUTION",
  "CORPORATE",
];

/** Soft deletion: a suspended org keeps its data but can no longer act. */
export type OrganizationStatus = "ACTIVE" | "SUSPENDED";

/**
 * OWNER may create and publish events, and issue refunds. MEMBER may view the
 * dashboard and run check-in only.
 */
export type OrgRole = "OWNER" | "MEMBER";

/**
 * Platform-wide role. Held on the user document, not on any organization —
 * an admin operates Morbin itself and belongs to no org in particular.
 *
 * `USER` is written explicitly when someone is demoted so that the bootstrap
 * cannot silently re-promote them on the next cold start.
 */
export type UserRole = "ADMIN" | "USER";

export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
}

export interface AppSession {
  user: SessionUser & {
    organizationId: string | null;
    organizationRole: OrgRole | null;
    onboardingStatus: OnboardingStatus | null;
    paymentAccountStatus: PaymentAccountStatus | null;
  };
}

export interface Organization {
  _id?: ObjectId;
  name: string;
  slug: string;
  ownerId: string;
  type: OrganizationType;
  status: OrganizationStatus;
  onboardingStatus: OnboardingStatus;
  paymentAccountStatus: PaymentAccountStatus;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  /** Platform fee, GST-inclusive, set by the admin. Absent = platform default. */
  feeBps?: number | null;
  /** Who pays the fee by default; events may override. Absent = ORGANISER. */
  feeBearer?: FeeBearer | null;
  /** Months after an event ends before attendee PII is anonymised. */
  retentionMonths?: number | null;
  /** Support (admin) publishes become proposals the owner must approve. */
  requireApprovalForSupportChanges?: boolean | null;
  /** Where Morbin sends this organisation's paperwork. Owner-editable. */
  contactEmail?: string | null;
  contactPhone?: string | null;
  /** GSTIN, when the organisation is registered. Printed on payout invoices. */
  gstin?: string | null;
  address?: string | null;
  /** GST state of the registered address, for place of supply on fee invoices. */
  state?: string | null;
  stateCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The user document shape this codebase relies on. */
export interface User {
  _id?: ObjectId;
  name?: string | null;
  email: string;
  passwordHash?: string;
  emailVerified?: Date | null;
  image?: string | null;
  /** Absent on accounts predating roles; treated as a non-admin. */
  role?: UserRole;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Membership {
  _id?: ObjectId;
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: Date;
}

/**
 * An invitation for someone with no Morbin account to join an organisation as
 * a MEMBER. Only the sha256 of the emailed token is stored, so the database
 * alone can never be used to accept an invite.
 */
export interface TeamInvite {
  _id?: ObjectId;
  organizationId: string;
  email: string;
  name: string | null;
  tokenHash: string;
  status: "PENDING" | "ACCEPTED" | "REVOKED";
  invitedBy: string;
  expiresAt: Date;
  lastSentAt: Date;
  sendCount: number;
  acceptedUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** "List your event": an organisation asking to sell tickets on Morbin. */
export interface OrgApplication {
  _id?: ObjectId;
  status: "NEW" | "INFO_REQUESTED" | "APPROVED" | "REJECTED";
  organizationName: string;
  type: OrganizationType;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  eventsPerYear: string;
  ticketsPerEvent: string;
  gstin: string | null;
  about: string;
  /** Consent to be contacted about this application (DPDP). */
  consentAt: Date;
  decisionNote: string | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  organizationId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type EventStatus = "DRAFT" | "PUBLISHED" | "CANCELLED";

export interface Event {
  _id?: ObjectId;
  organizationId: string;
  title: string;
  slug: string;
  description: string;
  venue: string;
  timezone: string;
  startsAt: Date;
  endsAt: Date;
  status: EventStatus;
  /** Version of the checkout flow this event is currently selling against. */
  flowVersion?: number | null;
  /** Overrides the organisation's fee bearer for this event. Null = org default. */
  feeBearer?: FeeBearer | null;
  cancelledAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TicketType {
  _id?: ObjectId;
  eventId: string;
  name: string;
  description: string;
  pricePaise: number;
  capacity: number;
  soldCount: number;
  saleStartsAt?: Date | null;
  saleEndsAt?: Date | null;
  /** Ceiling the organizer sets per order for this type. Null = no opinion. */
  defaultMaxPerOrder?: number | null;
  /** Flow option ids permitted to buy this type. Null = any audience. */
  audienceOptionIds?: string[] | null;
  /**
   * ACTIVE sells; PAUSED is shown as unavailable; HIDDEN is not shown at all.
   * Absent on older documents = ACTIVE.
   */
  status?: TicketTypeStatus;
  sortOrder?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export type TicketTypeStatus = "ACTIVE" | "PAUSED" | "HIDDEN";

export interface OrderItem {
  ticketTypeId: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
}

export type OrderStatus =
  | "CREATED"
  | "PAID"
  | "FAILED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED"
  | "EXPIRED";

export interface OrderAttendee {
  ticketTypeId: string;
  name: string;
  email: string;
}

export interface Order {
  _id?: ObjectId;
  eventId: string;
  organizationId: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  items: OrderItem[];
  attendees?: OrderAttendee[];
  subtotalPaise: number;
  platformFeePaise: number;
  organizerAmountPaise: number;
  totalPaise: number;
  currency: "INR";
  razorpayOrderId: string;
  razorpayPaymentId?: string | null;
  razorpayRefundId?: string | null;
  status: OrderStatus;
  /** Provenance of the buyer, for per-audience reporting. */
  checkoutSessionId?: string | null;
  flowVersion?: number | null;
  flowBranch?: string | null;
  identityMethod?: CheckoutIdentityMethod | null;
  customFields?: OrderCustomField[] | null;
  /** Captured at the top of the funnel, so a QR-code poster is attributable. */
  utm?: { source: string | null; medium: string | null; campaign: string | null } | null;
  /**
   * Frozen at creation by `lib/pricing.ts`. Orders created before pricing
   * existed lack it; readers fall back to subtotalPaise/totalPaise.
   */
  pricing?: OrderPricing | null;
  /** Read from the Razorpay payment at capture; `feePaise` includes tax. */
  gateway?: { feePaise: number; taxPaise: number; method: string | null } | null;
  /** Ticket value refunded so far (never includes the convenience fee). */
  refundedPaise?: number;
  /** The tax invoice for the convenience fee, when the buyer paid one. */
  invoiceId?: string | null;
  /** The ticket PDF (tickets + invoice page) in the document store. */
  ticketPdfDocId?: string | null;
  createdAt: Date;
  paidAt?: Date | null;
}

/**
 * A GST tax invoice Morbin issued. Numbers are gapless per financial year, and
 * the supplier's details are copied in so later settings changes never alter
 * an issued invoice. Kept 8 years (GST record-keeping).
 */
export type InvoiceKind =
  /** The buyer paid the convenience fee: Morbin invoices the buyer, per order. */
  | "CUSTOMER_FEE"
  /** The organisation absorbed the fee: Morbin invoices the organisation, per payout. */
  | "ORG_FEE";

export interface Invoice {
  _id?: ObjectId;
  number: string;
  financialYear: string;
  kind: InvoiceKind;
  /** Set for CUSTOMER_FEE invoices. */
  orderId?: string | null;
  /** Set for ORG_FEE invoices. */
  payoutId?: string | null;
  organizationId: string;
  /** For ORG_FEE the organisation, with its GST details as they were at issue. */
  recipient: {
    name: string;
    email: string;
    gstin?: string | null;
    address?: string | null;
    state?: string | null;
    stateCode?: string | null;
  };
  placeOfSupply: string;
  sac: string;
  description: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  rateBps: number;
  supplier: GstSettings;
  issuedAt: Date;
}

export interface OrderCustomField {
  fieldId: string;
  label: string;
  value: string;
}

export type TicketStatus = "VALID" | "USED" | "REFUNDED";

export interface Ticket {
  _id?: ObjectId;
  orderId: string;
  eventId: string;
  ticketTypeId: string;
  attendeeName: string;
  attendeeEmail: string;
  code: string;
  qrPayload: string;
  status: TicketStatus;
  checkedInAt?: Date | null;
  /** Price paid for this seat (ticket value only), for per-ticket refunds. */
  unitPricePaise?: number;
  /** Set while a refund case covers this ticket, so it can't be requested twice. */
  refundCaseId?: string | null;
  /**
   * Denormalised from the order so "how many has this person already claimed
   * under this audience" is a single-collection count against the index
   * `{ eventId, attendeeEmail, flowBranch, status }` — the per-audience cap
   * cannot be computed correctly from `orders` alone.
   */
  flowBranch?: string | null;
  flowVersion?: number | null;
}

export interface WebhookRecord {
  _id?: ObjectId;
  providerEventId: string;
  eventType: string;
  status: "RECEIVED" | "PROCESSED" | "FAILED";
  processedAt?: Date | null;
}

export type EmailKind =
  /** Legacy: one email per ticket with an inline QR. */
  | "TICKET"
  /** One email per order with the ticket PDF (tickets + tax invoice) attached. */
  | "TICKET_PDF"
  | "REFUND"
  | "EVENT_UPDATE"
  | "FLOW_MAGIC_LINK"
  | "EMAIL_VERIFY"
  /** A new person invited to an organisation: carries a one-time join link. */
  | "TEAM_INVITE"
  /** An existing Morbin user added to an organisation. */
  | "TEAM_ADDED"
  /** An account Morbin created for someone (e.g. a new organisation owner): choose a password. */
  | "ACCOUNT_SETUP"
  /** Organisation applications: received, more info needed, approved, rejected. */
  | "APPLICATION";

export interface EmailRecord {
  _id?: ObjectId;
  orderId?: string | null;
  ticketId?: string | null;
  recipient: string;
  kind: EmailKind;
  /** SENDING = claimed by one flusher, so two can never send the same email. */
  status: "QUEUED" | "SENDING" | "SENT" | "FAILED";
  claimedAt?: Date | null;
  attempts: number;
  lastError?: string | null;
  providerMessageId?: string | null;
  sentAt?: Date | null;
  /** Earliest time the next attempt may run (exponential backoff). */
  nextAttemptAt?: Date | null;
  meta?: {
    eventTitle?: string;
    eventVenue?: string;
    eventStartsAt?: string;
    attendeeName?: string;
    ticketCode?: string;
    qrSvg?: string | null;
    refundAmountPaise?: number;
    refundStage?: "SENT" | "COMPLETED" | "APPROVED_ORG";
    refundArn?: string | null;
    refundSpeed?: "NORMAL" | "INSTANT";
    /** TEAM_INVITE / TEAM_ADDED. */
    organizationName?: string;
    inviterName?: string;
    /** A link carrying a secret (join token). Cleared once the email is sent. */
    link?: string | null;
    /** APPLICATION: which update this is, and Morbin's message if any. */
    applicationStage?: "RECEIVED" | "INFO_REQUESTED" | "APPROVED" | "REJECTED";
    message?: string | null;
  } | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Checkout flow
 *
 * An organizer's questions are *data*, not code. The customer-facing evaluator
 * (`lib/flows.ts`) reads these documents and will not change when the dashboard
 * gains a visual builder — the builder only edits this shape.
 * ──────────────────────────────────────────────────────────────────────────── */

/** How a branch proves the buyer is who they say they are. */
export type CheckoutIdentityMethod = "NONE" | "GOOGLE" | "EMAIL_OTP";

export interface FlowIdentity {
  method: CheckoutIdentityMethod;
  /**
   * Domain the entered address must end in, without the `@`
   * (e.g. `krmu.edu.in`). This is the insider check, and it is enforced
   * server-side when the link is requested — never in the browser.
   */
  emailDomain?: string | null;
  /** For GOOGLE: which domains may sign in. Null/absent = any. */
  allowedEmailDomains?: string[] | null;
}

/** A question that branches: picking one option decides what happens next. */
export interface FlowOption {
  id: string;
  label: string;
  /** Stored in `checkoutSessions.answers`; also the value on `ticket.flowBranch`. */
  value: string;
  /** Explicit branch target. Null = continue to the following step. */
  nextStepId?: string | null;
  identity?: FlowIdentity | null;
  /** Restricts which ticket types this audience may buy. Undefined = all. */
  allowedTicketTypeIds?: string[] | null;
  /** Ceiling for this audience. Undefined = the ticket type's own default. */
  maxPerOrder?: number | null;
  /** false ⇒ the quantity step never renders and the order is exactly 1 ticket. */
  quantityEditable?: boolean | null;
  /** Seats this audience may claim across the whole event. Null = unbounded. */
  capacity?: number | null;
  /** Custom fields shown only on this branch. Undefined = all of them. */
  showFieldIds?: string[] | null;
}

export type FlowStepKind =
  /** Ask a question; the answer picks a branch. */
  | "SINGLE_CHOICE"
  /**
   * A no-op container. The drawer reads `identity.method` from the branch chosen
   * at the branching step and renders either a college-email form or a Google
   * button. Having no step of its own keeps identity a property of the *answer*
   * rather than a second place an organizer has to configure.
   */
  | "IDENTITY"
  /** Seat count, skipped when the branch sets `quantityEditable: false`. */
  | "QUANTITY"
  /** Static copy. Never gates anything. */
  | "INFO";

export interface FlowStep {
  id: string;
  kind: FlowStepKind;
  title: string;
  description?: string | null;
  required?: boolean;
  options?: FlowOption[] | null;
}

export interface CheckoutFlow {
  _id?: ObjectId;
  eventId: string;
  /**
   * Bumped on publish. A checkout session pins the version it started against,
   * so republishing mid-funnel cannot change the rules underneath a buyer who
   * is already holding an open drawer.
   */
  version: number;
  /** DRAFT is the single working copy (version 0); RETIRED is a superseded publish, kept for history. */
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  steps: FlowStep[];
  createdAt: Date;
  updatedAt: Date;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Event appearance — what the public page looks like
 * ──────────────────────────────────────────────────────────────────────────── */

export type CustomFieldType =
  | "TEXT"
  | "TEL"
  | "EMAIL"
  | "TEXTAREA"
  | "SELECT"
  | "MULTI_SELECT";

export interface CustomField {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options?: string[] | null;
  placeholder?: string | null;
  maxLength?: number | null;
  /**
   * CHECKOUT_FORM collects one value for the whole order. PER_TICKET asks once
   * per seat and is not yet supported by the public flow, so the dashboard must
   * not offer it.
   */
  collectOn: "CHECKOUT_FORM";
}

export interface EventBranding {
  _id?: ObjectId;
  eventId: string;
  /** R2 object key. The public URL is derived at render, never stored. */
  bannerKey?: string | null;
  socialImageKey?: string | null;
  accentColor: string;
  ctaLabel: string;
  showDescription: boolean;
  showVenue: boolean;
  showDate: boolean;
  /** false hides prices on the landing page until the drawer opens. */
  showTicketPreview: boolean;
  theme: "dark" | "light";
  customFields: CustomField[];
  createdAt: Date;
  updatedAt: Date;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Checkout session — the durable funnel state
 *
 * A drawer-based flow with a magic-link hand-off cannot live in component
 * state: the buyer leaves the page to read their email and must resume in the
 * same browser. This document is that memory.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface CheckoutSession {
  _id?: ObjectId;
  /** Unguessable handle used in URLs and as the cookie value. */
  publicId: string;
  eventId: string;
  flowVersion: number;
  status: "IN_PROGRESS" | "IDENTITY_VERIFIED" | "COMPLETED" | "EXPIRED";
  /** stepId -> chosen option value. */
  answers: Record<string, string>;
  branch: { stepId: string; optionId: string; value: string } | null;
  identity: {
    method: CheckoutIdentityMethod;
    email: string | null;
    verifiedAt: Date | null;
    via: "GOOGLE" | "EMAIL_OTP" | null;
    userId: string | null;
  };
  /** sha256 of the emailed link. Cleared the moment it is consumed. */
  otpTokenHash?: string | null;
  otpExpiresAt?: Date | null;
  otpAttempts: number;
  resendAfter?: Date | null;
  /** sha256 of the cookie token minted on successful verification. */
  resumeTokenHash?: string | null;
  resumeTokenExpiresAt?: Date | null;
  customFields: Record<string, string>;
  /** ticketTypeId -> quantity. Stored so the order route never trusts the client. */
  quantity: Record<string, number>;
  orderId: string | null;
  /** UTM captured on arrival, so a QR-code campaign is finally attributable. */
  utm: { source: string | null; medium: string | null; campaign: string | null };
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The offer — resolved server-side, recomputed on every read
 * ──────────────────────────────────────────────────────────────────────────── */

export interface OfferTicketType {
  id: string;
  name: string;
  description: string;
  pricePaise: number;
  left: number;
  /** Hard ceiling for this buyer, this branch, this type. */
  maxSelectable: number;
  quantityEditable: boolean;
}

export interface Offer {
  branch: { stepId: string; optionId: string; value: string; label: string } | null;
  identity: {
    method: CheckoutIdentityMethod;
    email: string | null;
    verified: boolean;
  };
  ticketTypes: OfferTicketType[];
  /** false ⇒ the quantity step is hidden and the order is forced to 1 ticket. */
  quantityRequired: boolean;
  /** Present when quantity is not editable — the order contents are already decided. */
  forcedItems: { ticketTypeId: string; quantity: number }[] | null;
  /** True once the buyer has spent their per-identity allowance for this branch. */
  soldOutForIdentity: boolean;
  missingRequiredSteps: string[];
}

/* ────────────────────────────────────────────────────────────────────────────
 * Money: ledger, payouts, refunds
 * ──────────────────────────────────────────────────────────────────────────── */

export type LedgerEntryType =
  /** + ticket value of a paid order */
  | "SALE"
  /** − convenience fee, when the organisation absorbs it */
  | "PLATFORM_FEE"
  /** − ticket value refunded to a customer (on request; reversed if rejected) */
  | "REFUND"
  /** − Razorpay costs of a refund borne by the organisation */
  | "REFUND_COST"
  /** + reverses REFUND/REFUND_COST when a request is rejected or withdrawn */
  | "REFUND_REVERSAL"
  /** ± admin correction, e.g. resolving a payout query */
  | "ADJUSTMENT";

/**
 * An immutable money movement, from the organisation's point of view.
 * Balances are always derived by summing these; nothing stores a balance.
 */
export interface LedgerEntry {
  _id?: ObjectId;
  organizationId: string;
  eventId: string | null;
  orderId: string | null;
  refundCaseId: string | null;
  type: LedgerEntryType;
  /** Signed: positive is owed to the organisation. */
  amountPaise: number;
  memo: string;
  /** Unique idempotency key, e.g. `sale:<orderId>`. */
  key: string;
  /** Set when the entry is included in a payout; null = unsettled. */
  payoutId: string | null;
  createdAt: Date;
  createdBy: string | null;
}

export type PayoutStatus =
  | "DRAFT"
  | "PAID"
  | "ACKNOWLEDGED"
  | "DISPUTED"
  | "RESOLVED"
  | "CANCELLED";

export interface PayoutTotals {
  salesPaise: number;
  feesPaise: number;
  refundsPaise: number;
  refundCostsPaise: number;
  adjustmentsPaise: number;
  netPaise: number;
}

export interface Payout {
  _id?: ObjectId;
  organizationId: string;
  status: PayoutStatus;
  cutoffAt: Date;
  /** Sums of the included ledger entries, by kind. */
  totals: PayoutTotals;
  entryCount: number;
  bankReference: string | null;
  transferredAt: Date | null;
  statementDocId: string | null;
  breakdownDocId: string | null;
  /** ORG_FEE invoice PDF, when the organisation absorbed fees in this payout. */
  invoiceDocId?: string | null;
  note: string | null;
  createdBy: string;
  paidBy: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PayoutMessage {
  _id?: ObjectId;
  payoutId: string;
  organizationId: string;
  authorId: string;
  authorRole: "OWNER" | "ADMIN";
  message: string;
  createdAt: Date;
}

export type RefundCaseStatus =
  | "REQUESTED"
  | "APPROVED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "COMPLETED_MANUALLY"
  | "COMPLETED_BY_ORG"
  | "REJECTED"
  | "CANCELLED";

export interface RefundCase {
  _id?: ObjectId;
  organizationId: string;
  eventId: string;
  orderId: string;
  ticketIds: string[];
  /** Ticket value to return to the customer. */
  amountPaise: number;
  settledBy: "MORBIN" | "ORGANISATION";
  speed: RefundSpeed;
  cost: {
    gatewayFeeSharePaise: number;
    instantFeePaise: number;
    instantFeeGstPaise: number;
    totalPaise: number;
  };
  status: RefundCaseStatus;
  reason: string;
  /** Raised automatically by an event cancellation. */
  fromCancellation: boolean;
  requestedBy: string;
  decidedBy: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  customer: { name: string; email: string };
  razorpayRefundId: string | null;
  /** Bank reference customers use to trace the refund. */
  arn: string | null;
  failureReason: string | null;
  /** Bank/UPI reference for manual or self-settled completions. */
  manualReference: string | null;
  completedBy: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Platform
 * ──────────────────────────────────────────────────────────────────────────── */

export interface GstSettings {
  legalName: string;
  tradeName: string;
  gstin: string;
  pan: string;
  address: string;
  state: string;
  stateCode: string;
  sac: string;
  rateBps: number;
  splitRule: "SUPPLIER_STATE" | "ALWAYS_IGST";
  invoicePrefix: string;
  footerText: string;
}

export interface PlatformSettings {
  _id: "platform";
  defaultFeeBps: number;
  defaultRetentionMonths: number;
  gst: GstSettings;
  updatedBy: string | null;
  updatedAt: Date;
}

export interface AuditLog {
  _id?: ObjectId;
  actorId: string | null;
  actorRole: "ADMIN" | "OWNER" | "MEMBER" | "SYSTEM";
  action: string;
  targetType: string;
  targetId: string | null;
  organizationId: string | null;
  meta: Record<string, unknown>;
  at: Date;
}

export type StoredDocumentKind =
  | "PAYOUT_STATEMENT"
  | "PAYOUT_BREAKDOWN"
  | "TICKET_PDF"
  | "REFUND_PROOF"
  | "ORG_FEE_INVOICE";

/**
 * The bank account a payout is transferred to.
 *
 * The account number is never stored in the clear: `accountNumberEnc` is
 * AES-256-GCM under `DATA_ENCRYPTION_KEY` (see `lib/payout-accounts`), and
 * `last4` is kept beside it purely so the dashboard can show which account is
 * on file without decrypting anything. One account per organisation.
 */
export interface PayoutAccount {
  _id?: ObjectId;
  organizationId: string;
  /** Name on the account, as the bank records it. */
  accountName: string;
  ifsc: string;
  accountNumberEnc: string;
  last4: string;
  /** Set when an admin confirms the account; null until then. */
  verifiedAt?: Date | null;
  createdAt?: Date;
  updatedAt: Date;
}

export interface StoredDocument {
  _id?: ObjectId;
  organizationId: string | null;
  kind: StoredDocumentKind;
  storageKey: string;
  fileName: string;
  contentType: string;
  bytes: number;
  sha256: string;
  uploadedBy: string | null;
  createdAt: Date;
}

export interface Notification {
  _id?: ObjectId;
  /** null with audience ADMIN = every platform admin. */
  organizationId: string | null;
  audience: "ORG_OWNER" | "ADMIN";
  kind: string;
  title: string;
  body: string;
  link: string | null;
  readAt: Date | null;
  createdAt: Date;
}
