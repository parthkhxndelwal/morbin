import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangleIcon, CalendarIcon, FlaskConicalIcon, MapPinIcon, TicketIcon, UsersIcon } from "lucide-react";
import { EventCta } from "@/components/features/event-page/event-cta";
import { BrandMark } from "@/components/patterns/brand-mark";
import { Money } from "@/components/patterns/money";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { appUrl } from "@/lib/email";
import { formatDateTime } from "@/lib/format";
import { getPublicEvent, type PublicEvent, type PublicTicket } from "@/lib/public-event";
import { verifyTestRun } from "@/lib/test-run";

/**
 * The public event page: a server component — no client-side data fetching
 * for the page itself; only the booking drawer is client-side.
 *
 * It reads UTM parameters (to attribute a QR-code poster) and nothing else
 * about the visitor. Cancelled, ended, sold-out and not-yet-on-sale events
 * render their state instead of a Book-now button.
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

async function load(slug: string, testToken: string | null) {
  const test = verifyTestRun(testToken);
  const event = await getPublicEvent(slug, { draftEventId: test?.eventId ?? null });
  if (event && test && test.eventId !== event.id) return { event: null, test: null };
  return { event, test };
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const { event } = await load(slug, first(query.test) ?? null);
  if (!event) return { title: "Event not found — Morbin", robots: { index: false } };
  const description = event.description.replace(/\s+/g, " ").slice(0, 160);
  const images = event.bannerUrl ? [{ url: event.bannerUrl, width: 1200, height: 630, alt: event.title }] : undefined;
  return {
    title: `${event.title} — Morbin`,
    description,
    alternates: { canonical: `/event/${event.slug}` },
    // Drafts (test runs) and cancelled events are never worth indexing.
    robots: event.status === "PUBLISHED" ? undefined : { index: false, follow: false },
    openGraph: { type: "website", title: event.title, description, url: `/event/${event.slug}`, images },
    twitter: { card: images ? "summary_large_image" : "summary", title: event.title, description, images: images?.map((i) => i.url) },
  };
}

/** schema.org Event, for search results. */
function jsonLd(e: PublicEvent) {
  const available = e.tickets.filter((t) => t.state === "AVAILABLE");
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    description: e.description.slice(0, 500),
    startDate: e.startsAt,
    endDate: e.endsAt,
    eventStatus: e.state === "CANCELLED" ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: e.venue, address: e.venue },
    image: e.bannerUrl ? [appUrl(e.bannerUrl)] : undefined,
    organizer: e.organizerName ? { "@type": "Organization", name: e.organizerName } : undefined,
    offers: (available.length ? available : e.tickets).map((t) => ({
      "@type": "Offer",
      name: t.name,
      price: (t.pricePaise / 100).toFixed(2),
      priceCurrency: "INR",
      availability: t.state === "AVAILABLE" ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
      url: appUrl(`/event/${e.slug}`),
    })),
  };
}

const TICKET_STATE: Record<PublicTicket["state"], string | null> = {
  AVAILABLE: null,
  SOLD_OUT: "Sold out",
  PAUSED: "Paused",
  NOT_YET: "Not on sale yet",
  CLOSED: "Sales closed",
};

export default async function EventPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const testToken = first(query.test) ?? null;
  const { event, test } = await load(slug, testToken);
  if (!event) notFound();

  const b = event.branding;
  const when = formatDateTime(event.startsAt, event.timezone);
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue)}`;
  const bookable = event.state === "ON_SALE";
  // A JSON-LD payload must not be able to close its own <script> tag.
  const ld = JSON.stringify(jsonLd(event)).replace(/</g, "\\u003c");

  return (
    <div className="min-h-dvh bg-background pb-24 text-foreground md:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <BrandMark />
        <Link href={`/event/${event.slug}/tickets`} className="text-sm text-muted-foreground hover:text-foreground">
          My tickets
        </Link>
      </header>

      <main className="mx-auto w-full max-w-5xl space-y-8 px-4 sm:px-6">
        {test && (
          <Alert>
            <FlaskConicalIcon />
            <AlertTitle>Test run</AlertTitle>
            <AlertDescription>
              Test run with your draft booking rules. Nothing is charged, no seats are held and no emails are sent.
            </AlertDescription>
          </Alert>
        )}

        <section className="grid gap-6 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] md:items-start">
          <div className="relative aspect-[16/9] overflow-hidden rounded-2xl border bg-muted">
            {event.bannerUrl ? (
              <Image
                src={event.bannerUrl}
                alt=""
                fill
                priority
                sizes="(min-width: 1024px) 600px, 100vw"
                className="object-cover"
              />
            ) : (
              <div
                aria-hidden
                className="absolute inset-0"
                style={{ background: `linear-gradient(135deg, ${b.accentColor}, color-mix(in oklch, ${b.accentColor}, black 55%))` }}
              />
            )}
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              {event.organizerName && (
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <UsersIcon className="size-4" />
                  {event.organizerName}
                </p>
              )}
              <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{event.title}</h1>
            </div>
            <dl className="space-y-2 text-sm">
              {b.showDate && (
                <div className="flex items-start gap-2">
                  <dt className="sr-only">When</dt>
                  <CalendarIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <dd>
                    <time dateTime={event.startsAt}>{when}</time>
                  </dd>
                </div>
              )}
              {b.showVenue && event.venue && (
                <div className="flex items-start gap-2">
                  <dt className="sr-only">Where</dt>
                  <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <dd>
                    {event.venue}{" "}
                    <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline underline-offset-4 hover:text-foreground">
                      Map
                    </a>
                  </dd>
                </div>
              )}
            </dl>

            <StateBanner event={event} />

            {bookable && (
              <div className="space-y-2">
                {b.showTicketPreview && event.fromPaise !== null && (
                  <p className="text-sm text-muted-foreground">
                    {event.fromPaise === 0 ? (
                      "Free tickets available"
                    ) : (
                      <>
                        From <Money paise={event.fromPaise} className="font-medium text-foreground" />
                        {event.customerPaysFee ? " + convenience fee" : ""}
                      </>
                    )}
                  </p>
                )}
                <EventCta
                  eventId={event.id}
                  slug={event.slug}
                  title={event.title}
                  accentColor={b.accentColor}
                  ctaLabel={b.ctaLabel}
                  utm={{ source: first(query.utm_source), medium: first(query.utm_medium), campaign: first(query.utm_campaign) }}
                  autoOpen={query.resume === "1"}
                  testToken={test ? testToken : null}
                />
              </div>
            )}
          </div>
        </section>

        <div className="grid gap-8 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          {b.showDescription && event.description && (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">About</h2>
              {/* Plain text, rendered as text: nothing the organiser types is interpreted as markup. */}
              <p className="text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{event.description}</p>
            </section>
          )}
          {b.showTicketPreview && event.tickets.length > 0 && (
            <section className="space-y-3" aria-labelledby="tickets-heading">
              <h2 id="tickets-heading" className="text-lg font-semibold">
                Tickets
              </h2>
              <ul className="divide-y rounded-xl border">
                {event.tickets.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">{t.name}</p>
                      {t.description && <p className="text-sm text-muted-foreground">{t.description}</p>}
                      {TICKET_STATE[t.state] && (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t.state === "NOT_YET" && t.saleStartsAt
                            ? `On sale ${formatDateTime(t.saleStartsAt, event.timezone)}`
                            : TICKET_STATE[t.state]}
                        </Badge>
                      )}
                    </div>
                    <p className="shrink-0 text-right text-sm">
                      {t.pricePaise === 0 ? "Free" : <Money paise={t.pricePaise} className="font-medium" />}
                      {t.pricePaise > 0 && event.customerPaysFee && (
                        <span className="block text-xs text-muted-foreground">+ convenience fee</span>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <footer className="border-t py-6 text-xs text-muted-foreground">
          <Link href={`/event/${event.slug}/tickets`} className="hover:text-foreground">
            Already booked? Find your tickets
          </Link>
          <span className="mx-2">·</span>
          <Link href="/legal/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <span className="mx-2">·</span>
          Sold through Morbin
        </footer>
      </main>
    </div>
  );
}

function StateBanner({ event }: { event: PublicEvent }) {
  if (event.state === "ON_SALE") return null;
  const copy = {
    CANCELLED: {
      title: "This event has been cancelled",
      body: "Ticket holders are being refunded to their original payment method and will get an email.",
    },
    ENDED: { title: "This event has ended", body: "Thanks to everyone who came." },
    SOLD_OUT: { title: "Sold out", body: "Every ticket has been booked." },
    NOT_ON_SALE: {
      title: "Not on sale yet",
      body: event.salesOpenAt ? `Tickets go on sale ${formatDateTime(event.salesOpenAt, event.timezone)}.` : "Check back soon.",
    },
  }[event.state];
  return (
    <Alert variant={event.state === "CANCELLED" ? "destructive" : "default"}>
      {event.state === "CANCELLED" ? <AlertTriangleIcon /> : <TicketIcon />}
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>{copy.body}</AlertDescription>
    </Alert>
  );
}
