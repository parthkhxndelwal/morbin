import { DocArticle, docsMetadata } from "../doc-article";

export const metadata = docsMetadata(
  "Getting started",
  "How an event goes from a draft to tickets in buyers' inboxes.",
);

export default function GettingStartedPage() {
  return (
    <DocArticle
      title="Getting started"
      intro="An event on Morbin moves through three states. This guide walks the whole path."
      sections={[
        {
          h: "1. Your organization is set up",
          p: "Before you can publish anything, an administrator creates an organization for you and collects the bank details payouts are sent to. Once that organization is marked verified, you can accept money and publish paid events. Until then, draft events are fully available — you can build the whole event and publish later.",
        },
        {
          h: "2. Draft your event",
          p: "From your dashboard, create an event with a title, description, venue, and start and end times. Every event starts as a draft. Drafts are private: the public page does not resolve, and nobody can buy a ticket, until you publish.",
        },
        {
          h: "3. Add ticket types",
          p: "Add at least one ticket type to an event. Each type has its own price, capacity, and optional sale window. Ticket types can only be edited while the event is still a draft.",
        },
        {
          h: "4. Publish",
          p: "Publishing makes the event page live at /event/your-event-slug. Publishing a paid event requires a verified payment account — Morbin blocks the publish and tells you so, rather than failing silently at checkout.",
        },
        {
          h: "5. Sell and settle",
          p: "Buyers pay on the public event page. When payment clears, tickets are generated and emailed to each attendee automatically, and your share is credited to your Morbin balance. You do not need to do anything manually — see Payments & payouts for how and when that balance reaches your bank.",
        },
      ]}
      next={{ href: "/docs/creating-events", title: "Creating events" }}
    />
  );
}
