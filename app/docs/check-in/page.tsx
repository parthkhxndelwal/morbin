import { DocArticle, docsMetadata } from "../doc-article";

export const metadata = docsMetadata(
  "Check-in",
  "Scanning tickets at the door and resolving duplicate scans.",
);

export default function CheckInPage() {
  return (
    <DocArticle
      title={"Check-in"}
      intro="The check-in desk is at /dashboard/scan. Only members of the event's organization can use it, and only for their own events."
      sections={[
        {
          h: "Running the desk",
          p: "Type or paste a ticket code, or scan the QR code from the attendee's email. Both formats work. The result shows the attendee's name and the event immediately.",
          list: [
            "MRB-XXXXXXXX — the human-readable code.",
            "A QR scan — the same code with a signature attached.",
          ],
        },
        {
          h: "What a valid scan shows",
          p: "A green confirmation with the attendee's name and the event title. The ticket is marked used at that moment and the time is recorded, so you have an accurate arrival log.",
        },
        {
          h: "Duplicate scans",
          p: "A ticket admits exactly one person. A second scan reports that the ticket was already checked in, along with the time of the first scan, so you can settle disputes quickly. Two staff members scanning the same ticket at the same instant cannot both succeed — the burn is atomic, so exactly one is admitted.",
        },
        {
          h: "Statuses",
          p: "Valid tickets can be burned. Used tickets report the original check-in time. Refunded tickets are refused — if a buyer was refunded, the ticket is void and should not admit them.",
        },
        {
          h: "Scope",
          p: "Check-in is restricted to members of the organization that owns the event. Staff cannot scan tickets for another organizer's events, and every verification is checked server-side rather than trusting the page.",
        },
        {
          h: "Lost email",
          p: "A buyer who cannot find their email can look their ticket up themselves from the event page — see Finding tickets.",
        },
      ]}
      prev={{ href: "/docs/payments", title: "Payments & payouts" }}
      next={{ href: "/docs/tickets", title: "Finding tickets" }}
    />
  );
}
