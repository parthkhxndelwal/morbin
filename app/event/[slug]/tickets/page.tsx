import { TicketLookup } from "./ticket-lookup";

export const metadata = {
  title: "Find my tickets",
  description: "Look up the tickets held under your email address.",
};

export default async function MyTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;
  return <TicketLookup initialEmail={typeof email === "string" ? email : ""} />;
}
