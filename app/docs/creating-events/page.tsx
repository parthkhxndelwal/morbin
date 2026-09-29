import { DocArticle, docsMetadata } from "../doc-article";

export const metadata = docsMetadata(
  "Creating events",
  "Drafts, publishing rules, and what each event field controls.",
);

export default function CreatingEventsPage() {
  return (
    <DocArticle
      title="Creating events"
      intro="An event is the container for ticket types, orders, and tickets. Its fields control what buyers see and when it sells."
      sections={[
        {
          h: "Fields",
          p: "Title, description, and venue appear on the public event page. Start and end times drive both the public listing and when sales close.",
          list: [
            "Title — 3 to 120 characters.",
            "Description — 10 to 5,000 characters, shown as preformatted text.",
            "Venue — 2 to 200 characters.",
            "Starts / Ends — the end must be after the start.",
          ],
        },
        {
          h: "Your URL",
          p: "Each event gets a slug derived from its title, made unique within your organization. The public page lives at /event/your-slug. Renaming the event updates the slug.",
        },
        {
          h: "States",
          p: "An event is a draft, published, or cancelled. Only published events are reachable publicly and able to take orders. Cancelling stops new sales and hides the page; existing buyers keep their tickets.",
          list: [
            "Draft — fully editable, not reachable publicly.",
            "Published — live and selling.",
            "Cancelled — not selling, page hidden.",
          ],
        },
        {
          h: "Publishing a paid event",
          p: "An event with at least one non-zero-priced ticket type can only be published once your organization is verified. Events with entirely free tickets publish without that requirement.",
        },
        {
          h: "After the event",
          p: "Once an event's end time passes, the public page stops resolving and no new orders are accepted. This happens automatically — there is nothing to close by hand.",
        },
      ]}
      prev={{ href: "/docs/getting-started", title: "Getting started" }}
      next={{ href: "/docs/ticket-types", title: "Ticket types" }}
    />
  );
}
