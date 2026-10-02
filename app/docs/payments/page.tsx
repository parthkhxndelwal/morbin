import { DocArticle, docsMetadata } from "../doc-article";

export const metadata = docsMetadata(
  "Payments & payouts",
  "Platform fees, scheduled bank payouts, and refunds.",
);

export default function PaymentsPage() {
  return (
    <DocArticle
      title="Payments & payouts"
      intro="Buyers pay through Razorpay. Morbin takes a small platform fee, holds your share as a balance, and pays it out to your bank account on a fixed schedule."
      sections={[
        {
          h: "The platform fee",
          p: "Morbin charges 5% of the order subtotal. The buyer pays the full face value of their tickets — the fee is deducted from your share, not added to the buyer's total. On a ₹1,000 order you receive ₹950.",
        },
        {
          h: "Free events",
          p: "If every ticket in an order is free, no payment processor is involved. The order is marked paid immediately, tickets are generated on the spot, and no fee applies.",
        },
        {
          h: "Settlement",
          p: "Morbin is the merchant of record for every sale. When a payment is captured, your share is credited to your Morbin balance and nothing is moved at that moment — tickets are issued and emailed immediately, and settlement happens separately afterwards in a scheduled payout. A payout problem therefore never delays a buyer getting their ticket.",
        },
        {
          h: "Verification",
          p: "You must be verified before publishing paid events. Verification is handled by the Morbin team, not self-service, and covers the bank details payouts are sent to. Your dashboard shows your current status, and paid publishing unlocks once it reads verified.",
        },
        {
          h: "Refunds",
          p: "An owner can issue a full refund from the event's order list. The refund returns the buyer's money, voids every ticket in the order, and returns the seats to capacity. Only paid orders are refundable, and the order is claimed atomically so a double-click cannot refund twice. If the money has already been paid out to your bank, the refund reduces your Morbin balance instead.",
        },
        {
          h: "What is verified before fulfilment",
          p: "Morbin never trusts the amount in a payment notification. The captured payment is re-fetched from Razorpay and checked against the stored order total and currency before any ticket is issued. A mismatch fails the order and releases the held seats instead of issuing tickets for the wrong amount.",
        },
      ]}
      prev={{ href: "/docs/ticket-types", title: "Ticket types" }}
      next={{ href: "/docs/check-in", title: "Check-in" }}
    />
  );
}
