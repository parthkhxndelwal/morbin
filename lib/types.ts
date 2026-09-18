import type { ObjectId } from "mongodb";

export type OnboardingStatus = "STARTED" | "PROFILE_DONE" | "PAYMENT_PENDING" | "ACTIVE";
export type PaymentAccountStatus =
  | "NOT_STARTED"
  | "PENDING"
  | "VERIFIED"
  | "REJECTED"
  | "RESTRICTED";
export type OrgRole = "OWNER" | "STAFF";

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
  onboardingStatus: OnboardingStatus;
  razorpayAccountId?: string | null;
  paymentAccountStatus: PaymentAccountStatus;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Membership {
  _id?: ObjectId;
  organizationId: string;
  userId: string;
  role: OrgRole;
  createdAt: Date;
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
}

export interface OrderItem {
  ticketTypeId: string;
  name: string;
  quantity: number;
  unitPricePaise: number;
}

export type OrderStatus = "CREATED" | "PAID" | "FAILED" | "REFUNDED" | "EXPIRED";

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
  transferId?: string | null;
  transferStatus?: string | null;
  status: OrderStatus;
  createdAt: Date;
  paidAt?: Date | null;
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
}

export interface WebhookRecord {
  _id?: ObjectId;
  providerEventId: string;
  eventType: string;
  status: "RECEIVED" | "PROCESSED" | "FAILED";
  processedAt?: Date | null;
}

export type EmailKind = "TICKET" | "REFUND" | "EVENT_UPDATE";

export interface EmailRecord {
  _id?: ObjectId;
  orderId?: string | null;
  ticketId?: string | null;
  recipient: string;
  kind: EmailKind;
  status: "QUEUED" | "SENT" | "FAILED";
  attempts: number;
  lastError?: string | null;
  providerMessageId?: string | null;
  sentAt?: Date | null;
  meta?: {
    eventTitle?: string;
    eventVenue?: string;
    eventStartsAt?: string;
    attendeeName?: string;
    ticketCode?: string;
    qrSvg?: string | null;
  } | null;
}
