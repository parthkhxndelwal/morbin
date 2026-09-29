import { DocArticle, docsMetadata } from "../doc-article";

export const metadata = docsMetadata(
  "Payments & payouts",
  "Platform fees, Razorpay settlement, and refunds.",
);

export default function PaymentsPage() {
  return (
    <DocArticle
      title="Payments & payouts"
      intro="Buyers pay through Razorpay. Morbin takes a small platform fee and transfers the remainder to your linked account."
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
          p: "Once a payment is captured, your share is transferred to your Razorpay linked account automatically. The transfer runs after ticket fulfilment and never blocks it — a failed transfer leaves your tickets delivered and the failure recorded against the order, so it can be retried without re-charging the buyer.",
        },
        {
          h: "Verification",
          p: "You must be verified before publishing paid events. Verification is handled by the Morbin team against your Razorpay linked account, not self-service. Your dashboard shows your current status, and paid publishing unlocks once it reads verified.",
        },
        {
          h: "Refunds",
          p: "An owner can issue a full refund from the event's order list. The refund reverses the organizer transfer, returns the money to the buyer, voids every ticket in the order, and returns the seats to capacity. Only paid orders are refundable, and the order is claimed atomically so a double-click cannot refund twice.",
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
