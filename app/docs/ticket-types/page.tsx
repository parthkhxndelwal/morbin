import { DocArticle, docsMetadata } from "../doc-article";

export const metadata = docsMetadata(
  "Ticket types",
  "Pricing, capacity, sale windows, and how inventory is held.",
);

export default function TicketTypesPage() {
  return (
    <DocArticle
      title="Ticket types"
      intro="A ticket type is a price point within an event — General, Early Bird, VIP. Buyers pick quantities from each."
      sections={[
        {
          h: "Fields",
          p: "Each type carries a name, optional description, price, and capacity.",
          list: [
            "Name — 2 to 80 characters.",
            "Price — in paise, so ₹250 is 25000. Zero makes the ticket free.",
            "Capacity — at least 1. This is the hard ceiling for the type.",
            "Sale window — optional start and end times.",
          ],
        },
        {
          h: "Editing window",
          p: "Ticket types can only be added or changed while the event is a draft. Once published, the type list is frozen so that live inventory and pricing cannot shift under buyers who already have the page open.",
        },
        {
          h: "How capacity is held",
          p: "Capacity is never handed out optimistically. When a buyer starts an order, Morbin increments the sold count immediately and holds those seats for 15 minutes. Only if payment clears does the hold become a real ticket.",
        },
        {
          h: "Released holds",
          p: "If a buyer abandons checkout, or the payment fails, the held seats are released and become sellable again. A background job reclaims stale holds, and the checkout flow reclaims them on its next request — so abandoned carts do not permanently sell out an event.",
        },
        {
          h: "Sold-out behaviour",
          p: "When a type reaches capacity it shows as sold out on the event page and cannot be added to an order. The decrement and capacity check happen in a single atomic database operation, so two buyers racing for the last seat cannot both win it.",
        },
        {
          h: "Per-order limits",
          p: "A single order is capped at 10 tickets per ticket type. This applies to the combined quantity for a type, not just one line, so splitting a request across duplicate lines does not bypass the cap.",
        },
      ]}
      prev={{ href: "/docs/creating-events", title: "Creating events" }}
      next={{ href: "/docs/payments", title: "Payments & payouts" }}
    />
  );
}
