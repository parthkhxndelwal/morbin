import type { Metadata } from "next";
import Link from "next/link";
import { CalendarIcon, MapPinIcon, TicketIcon } from "lucide-react";
import { DownloadPdfButton } from "@/components/features/tickets/download-pdf-button";
import { BrandMark } from "@/components/patterns/brand-mark";
import { DateTime } from "@/components/patterns/money";
import { EmptyState } from "@/components/patterns/states";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { auth } from "@/lib/auth";
import { getBuyerOrders } from "@/lib/buyer-tickets";

export const metadata: Metadata = {
  title: "Your tickets",
  description: "The tickets booked with your email.",
  // A personal view; never worth indexing.
  robots: { index: false, follow: false },
};

/**
 * The signed-in buyer's tickets, grouped by order, rendered on the server.
 *
 * The QR is shown here as well as in the email, so a buyer on another device —
 * or someone attending on their behalf — can still get in. It encodes the
 * signed payload the door scanner verifies.
 */
export default async function MyTicketsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await auth();
  const email = session?.user?.email?.toLowerCase() ?? null;
  const here = `/event/${slug}/tickets`;
  const orders = email ? await getBuyerOrders(email) : [];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:py-10">
        <header className="flex items-center justify-between gap-4">
          <BrandMark />
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={`/event/${slug}`} />}>
            Back to the event
          </Button>
        </header>
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Your tickets</h1>
          {email && (
            <p className="text-sm text-muted-foreground">
              Booked with <span className="font-medium text-foreground">{email}</span>
            </p>
          )}
        </div>

        {!email ? (
          <Card>
            <CardHeader>
              <CardTitle>Sign in to see your tickets</CardTitle>
              <CardDescription>
                Sign in with the same email you booked with — Google, or your Morbin account. Every booking is also
                emailed to that address as a PDF with your tickets.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button nativeButton={false} render={<Link href={`/auth?callbackUrl=${encodeURIComponent(here)}`} />}>
                Sign in
              </Button>
            </CardContent>
          </Card>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<TicketIcon />}
            title="No tickets for this email"
            description="If you booked with a different address, sign in with that one. Tickets are also in the email we sent after booking."
          />
        ) : (
          orders.map((o) => (
            <Card key={o.id}>
              <CardHeader>
                <CardTitle>{o.event.title}</CardTitle>
                <CardDescription className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarIcon className="size-3.5" />
                    <DateTime value={o.event.startsAt} timeZone={o.event.timezone} />
                  </span>
                  {o.event.venue && (
                    <span className="inline-flex items-center gap-1.5">
                      <MapPinIcon className="size-3.5" />
                      {o.event.venue}
                    </span>
                  )}
                </CardDescription>
                {o.canDownload && (
                  <CardAction>
                    <DownloadPdfButton orderId={o.id} />
                  </CardAction>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Order {o.id.slice(-8).toUpperCase()} · {o.tickets.length} ticket{o.tickets.length === 1 ? "" : "s"}
                </p>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {o.tickets.map((t) => (
                    <li key={t.id} className="space-y-3 rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{t.attendeeName}</p>
                          <p className="text-xs text-muted-foreground">{t.ticketTypeName}</p>
                        </div>
                        <StatusBadge kind="ticket" value={t.status} />
                      </div>
                      {t.qrSvg ? (
                        <div
                          className="mx-auto w-full max-w-48 rounded-md bg-white p-2 [&_svg]:h-auto [&_svg]:w-full"
                          role="img"
                          aria-label={`QR code for ticket ${t.code}`}
                          // Generated on the server by `qrcode` from our own signed payload.
                          dangerouslySetInnerHTML={{ __html: t.qrSvg }}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {t.status === "USED"
                            ? "Already checked in."
                            : t.status === "REFUND_PENDING"
                              ? "A refund is in progress, so this ticket can't be used."
                              : "Refunded — no longer valid for entry."}
                        </p>
                      )}
                      <p className="text-center font-mono text-sm tracking-widest">{t.code}</p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
