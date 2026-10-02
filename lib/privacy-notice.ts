/**
 * The DPDP notice a buyer accepts before giving personal data at checkout.
 * Pure (no imports), so the drawer, the API and checks share it. Bump
 * NOTICE_VERSION whenever the wording below changes: consent is recorded
 * against the version the buyer actually saw.
 */

export const NOTICE_VERSION = "checkout-2026-10-v1";

/** DPDP Rules 2025: data principal requests are answered within this many days. */
export const DATA_REQUEST_DEADLINE_DAYS = 90;

export interface CheckoutNoticeInput {
  organizerName: string;
  retentionMonths: number;
}

export interface NoticeSection {
  heading: string;
  body: string;
}

export function checkoutNotice({ organizerName, retentionMonths }: CheckoutNoticeInput): NoticeSection[] {
  const org = organizerName || "the organiser";
  return [
    {
      heading: "What we collect",
      body: "Your name and email address, any answers you give to the organiser's questions (such as an ID or roll number), and your phone number if asked.",
    },
    {
      heading: "Why",
      body: `To issue and deliver your tickets, check you in at the door, process payment and refunds, and send you updates about this booking. ${org} receives your booking details to run the event.`,
    },
    {
      heading: "Who processes it",
      body: "Morbin stores it on its own server in India. Amazon SES sends our emails and Razorpay processes payments; nobody else receives it.",
    },
    {
      heading: "How long",
      body: `Kept for ${retentionMonths} months after the event, then anonymised. Tax invoices are kept for 8 years, as the law requires.`,
    },
    {
      heading: "Your rights",
      body: "You can withdraw consent, or ask to access, correct or erase your data, at morbin.space/privacy/request. Withdrawing doesn't undo a booking already made.",
    },
  ];
}
