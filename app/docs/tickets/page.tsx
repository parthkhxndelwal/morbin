import { DocArticle, docsMetadata } from "../doc-article";

export const metadata = docsMetadata(
  "Finding tickets",
  "How buyers retrieve their tickets without an account.",
);

export default function TicketsPage() {
  return (
    <DocArticle
      title="Finding tickets"
      intro="Ticket emails are the primary channel, but buyers can always self-serve."
      sections={[
        {
          h: "The email",
          p: "Every ticket is emailed to its attendee as soon as payment clears, with the event details, the ticket code, and a QR code for scanning at the door. Tickets are issued per attendee, so a group booking sends one email per person.",
        },
        {
          h: "Looking up without an account",
          p: "Buyers do not need to sign up to buy or to find their tickets. From an event page they can look up every ticket held under their email address, which is the fastest way to recover a lost email on the night.",
        },
        {
          h: "Attendee details",
          p: "Each ticket records the attendee's name and email, so one buyer can assign different people to different tickets on the same order. Anything not assigned explicitly falls back to the buyer's own details.",
        },
        {
          h: "Ticket status",
          p: "Lookup shows each ticket's current state, so a buyer can tell a valid ticket from one already used or one that was refunded.",
        },
        {
          h: "If something is wrong",
          p: "If a ticket is missing after a completed payment, contact the organizer first — they can see the order and its tickets. Payments are only marked paid once the amount is confirmed against the payment processor, so a ticket that never arrived usually means the payment did not complete.",
        },
      ]}
      prev={{ href: "/docs/check-in", title: "Check-in" }}
      next={undefined}
    />
  );
}
