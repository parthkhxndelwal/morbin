import type { Metadata } from "next";
import { TicketLookup } from "./ticket-lookup";

export const metadata: Metadata = {
  title: "Your tickets",
  description: "The tickets on your Morbin account.",
  // A personal view; never worth indexing.
  robots: { index: false, follow: false },
};

export default function MyTicketsPage() {
  return <TicketLookup />;
}
