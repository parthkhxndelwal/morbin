import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangleIcon, ArrowUpRightIcon, FlaskConicalIcon, MapPinIcon, TicketIcon } from "lucide-react";
import { BookingDock } from "@/components/features/event-page/booking-dock";
import { BrandMark } from "@/components/patterns/brand-mark";
import { Money } from "@/components/patterns/money";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { appUrl } from "@/lib/email";
import { formatDateTime, formatINR } from "@/lib/format";
import { initials } from "@/lib/nav";
import { getPublicEvent, type PublicEvent, type PublicTicket } from "@/lib/public-event";
import { verifyTestRun } from "@/lib/test-run";

/**
 * The public event page, in the spirit of lu.ma: a square cover and the host
 * on the left; the title, a calendar tile, the place, registration and the
 * story on the right; and a Book-now dock fixed to the bottom of the screen.
 *
 * A server component with no client-side data fetching. The only client code
 * shipped with the page is the dock button; the booking sheet loads on intent.
 * Cancelled, ended, sold-out and not-yet-on-sale events show their state and
 * no dock.
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

/** Parts of a date in the event's own timezone, for the calendar tile and lines. */
function dateParts(iso: string, timeZone: string) {
  const d = new Date(iso);
  const part = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone, ...opts }).format(d);
  return {
    month: part({ month: "short" }).toUpperCase(),
    day: part({ day: "numeric" }),
    long: part({ weekday: "long", day: "numeric", month: "long" }),
    time: part({ hour: "numeric", minute: "2-digit" }),
    sameDayAs: (other: string) =>
      new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(d) ===
      new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(new Date(other)),
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
  const start = dateParts(event.startsAt, event.timezone);
  const end = dateParts(event.endsAt, event.timezone);
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue)}`;
  const bookable = event.state === "ON_SALE";
  const price = event.fromPaise === null ? null : event.fromPaise === 0 ? "Free" : `From ${formatINR(event.fromPaise)}`;
  // A JSON-LD payload must not be able to close its own <script> tag.
  const ld = JSON.stringify(jsonLd(event)).replace(/</g, "\\u003c");
  const [venueName, ...venueRest] = event.venue.split(",");

  const host = event.organizerName && (
    <section className="space-y-3">
      <h2 className="border-b pb-2 text-sm font-medium text-muted-foreground">Hosted by</h2>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
          style={{ backgroundColor: b.accentColor }}
        >
          {initials(event.organizerName)}
        </span>
        <p className="font-medium">{event.organizerName}</p>
      </div>
    </section>
  );

  return (
    <div
      className="min-h-dvh bg-background text-foreground"
      style={{
        // A soft wash of the event's colour behind the top of the page.
        backgroundImage: `radial-gradient(70rem 32rem at 50% -8rem, color-mix(in oklch, ${b.accentColor} 22%, transparent), transparent 70%)`,
      }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld }} />
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <BrandMark />
        <Link href={`/event/${event.slug}/tickets`} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
          My tickets
        </Link>
      </header>

      <main className={`mx-auto w-full max-w-5xl px-4 pt-2 sm:px-6 ${bookable ? "pb-32" : "pb-16"}`}>
        {test && (
          <Alert className="mb-6">
            <FlaskConicalIcon />
            <AlertTitle>Test run</AlertTitle>
            <AlertDescription>
              Test run with your draft booking rules. Nothing is charged, no seats are held and no emails are sent.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-8 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-12">
          <aside className="space-y-8">
            <div className="relative aspect-square overflow-hidden rounded-2xl bg-muted shadow-xl ring-1 ring-foreground/10">
              {event.bannerUrl ? (
                <Image src={event.bannerUrl} alt="" fill priority sizes="(min-width: 768px) 320px, 100vw" className="object-cover" />
              ) : (
                <div
                  aria-hidden
                  className="absolute inset-0"
                  style={{ background: `linear-gradient(135deg, ${b.accentColor}, color-mix(in oklch, ${b.accentColor}, black 60%))` }}
                />
              )}
            </div>
            <div className="hidden md:block">{host}</div>
          </aside>

          <div className="min-w-0 space-y-8">
            <div className="space-y-5">
              <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl">{event.title}</h1>

              <div className="space-y-3">
                {b.showDate && (
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 shrink-0 flex-col overflow-hidden rounded-xl border bg-background/60 text-center" aria-hidden>
                      <span className="bg-muted text-[9px] leading-4 font-semibold text-muted-foreground">{start.month}</span>
                      <span className="text-base leading-6 font-semibold">{start.day}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">
                        <time dateTime={event.startsAt}>{start.long}</time>
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {start.time} – {start.sameDayAs(event.endsAt) ? end.time : `${end.long}, ${end.time}`}
                      </p>
                    </div>
                  </div>
                )}
                {b.showVenue && event.venue && (
                  <div className="flex items-center gap-3">
                    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-background/60" aria-hidden>
                      <MapPinIcon className="size-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0">
                      <a
                        href={mapUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-center gap-1 font-medium hover:underline hover:underline-offset-4"
                      >
                        {venueName}
                        <ArrowUpRightIcon className="size-3.5 text-muted-foreground" />
                      </a>
                      {venueRest.length > 0 && <p className="truncate text-sm text-muted-foreground">{venueRest.join(",").trim()}</p>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <RegistrationCard event={event} />

            {b.showDescription && event.description && (
              <section className="space-y-3">
                <h2 className="border-b pb-2 text-sm font-medium text-muted-foreground">About event</h2>
                {/* Plain text, rendered as text: nothing the organiser types is interpreted as markup. */}
                <p className="leading-relaxed whitespace-pre-line">{event.description}</p>
              </section>
            )}

            {b.showVenue && event.venue && (
              <section className="space-y-3">
                <h2 className="border-b pb-2 text-sm font-medium text-muted-foreground">Location</h2>
                <p className="font-medium">{venueName}</p>
                {venueRest.length > 0 && <p className="text-sm text-muted-foreground">{venueRest.join(",").trim()}</p>}
                <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm underline underline-offset-4">
                  Open in Google Maps <ArrowUpRightIcon className="size-3.5" />
                </a>
              </section>
            )}

            <div className="md:hidden">{host}</div>

            <footer className="border-t pt-6 text-xs text-muted-foreground">
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
          </div>
        </div>
      </main>

      {bookable && (
        <BookingDock
          eventId={event.id}
          slug={event.slug}
          title={event.title}
          accentColor={b.accentColor}
          ctaLabel={b.ctaLabel}
          detail={b.showTicketPreview ? (price && event.customerPaysFee && event.fromPaise ? `${price} + fee` : price) : null}
          utm={{ source: first(query.utm_source), medium: first(query.utm_medium), campaign: first(query.utm_campaign) }}
          autoOpen={query.resume === "1"}
          testToken={test ? testToken : null}
        />
      )}
    </div>
  );
}

/** Lu.ma's "Registration" box: the state of sales, and the ticket options. */
function RegistrationCard({ event }: { event: PublicEvent }) {
  const b = event.branding;
  const notice =
    event.state === "ON_SALE"
      ? null
      : {
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
  const showTickets = b.showTicketPreview && event.tickets.length > 0;
  if (!notice && !showTickets) return null;
  return (
    <section className="overflow-hidden rounded-2xl border bg-card/70 shadow-sm backdrop-blur-sm" aria-labelledby="registration-heading">
      <h2 id="registration-heading" className="border-b bg-muted/50 px-4 py-2 text-sm font-medium text-muted-foreground">
        {event.state === "ON_SALE" ? "Registration" : "Registration closed"}
      </h2>
      <div className="space-y-4 p-4">
        {notice ? (
          <div className="flex gap-3">
            {event.state === "CANCELLED" ? (
              <AlertTriangleIcon className="mt-0.5 size-5 shrink-0 text-destructive" />
            ) : (
              <TicketIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            )}
            <div>
              <p className={`font-medium ${event.state === "CANCELLED" ? "text-destructive" : ""}`}>{notice.title}</p>
              <p className="text-sm text-muted-foreground">{notice.body}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Welcome! Pick a ticket below — booking takes under a minute.</p>
        )}
        {showTickets && (
          <ul className="divide-y rounded-xl border bg-background/60">
            {event.tickets.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-4 px-3 py-2.5">
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${t.state !== "AVAILABLE" ? "text-muted-foreground" : ""}`}>{t.name}</p>
                  {t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                  {TICKET_STATE[t.state] && (
                    <p className="text-xs text-muted-foreground">
                      {t.state === "NOT_YET" && t.saleStartsAt
                        ? `On sale ${formatDateTime(t.saleStartsAt, event.timezone)}`
                        : TICKET_STATE[t.state]}
                    </p>
                  )}
                </div>
                <p className="shrink-0 text-right text-sm">
                  {t.pricePaise === 0 ? "Free" : <Money paise={t.pricePaise} className="font-medium" />}
                  {t.pricePaise > 0 && event.customerPaysFee && (
                    <span className="block text-[11px] text-muted-foreground">+ convenience fee</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
