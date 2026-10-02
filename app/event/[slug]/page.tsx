import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/components/logo";
import type { Metadata } from "next";
import { getBranding } from "@/lib/branding";
import { getDb } from "@/lib/db";
import { getPublishedEventBySlug } from "@/lib/events";
import { verifyTestRun } from "@/lib/test-run";
import type { Event, TicketType } from "@/lib/types";
import { getActiveFlow } from "@/lib/flows";
import { mediaUrl } from "@/lib/media";
import { BuyDrawer } from "./buy-drawer";

/**
 * The public event page.
 *
 * A landing page plus one call to action. The buyer's answers, identity and cart
 * all live in the checkout session behind the drawer, which is why this route
 * reads UTM parameters (to attribute the QR code) but nothing else about the
 * buyer.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublishedEventBySlug(slug);
  if (!data) return { title: "Event not found — Morbin" };
  const { event } = data;
  const branding = await getBranding(event._id!.toString());
  // The banner doubles as the share image, so a link pasted into a chat shows
  // the poster rather than a generic card.
  const images = branding.bannerKey
    ? [{ url: bannerUrl(branding.bannerKey), width: 1200, height: 630, alt: event.title }]
    : undefined;
  return {
    title: `${event.title} — Morbin`,
    description: event.description.slice(0, 150),
    alternates: { canonical: `/event/${event.slug}` },
    openGraph: {
      title: event.title,
      description: event.description.slice(0, 200),
      url: `/event/${event.slug}`,
      images,
    },
    twitter: {
      card: images ? "summary_large_image" : "summary",
      title: event.title,
      description: event.description.slice(0, 200),
      images: images?.map((i) => i.url),
    },
  };
}

export default async function EventPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  // A builder test run may open a draft event; anyone else sees published ones.
  const testToken = first(query.test) ?? null;
  const test = verifyTestRun(testToken);
  const data = (await getPublishedEventBySlug(slug)) ?? (test ? await draftForTest(slug, test.eventId) : null);
  if (!data) notFound();
  if (test && test.eventId !== data.event._id!.toString()) notFound();
  const { event, ticketTypes } = data;
  const eventId = event._id!.toString();

  const when = new Date(event.startsAt).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const [branding, flow] = await Promise.all([getBranding(eventId), getActiveFlow(eventId)]);

  // The flow decides whether the landing page previews prices, so the two can
  // never disagree — a "don't show prices" setting is a property of the flow.
  const showPrices = branding.showTicketPreview && flow.version > 0;
  const cheapest = ticketTypes.reduce<number | null>(
    (min, t) => (min === null ? t.pricePaise : Math.min(min, t.pricePaise)),
    null,
  );

  return (
    <div className="min-h-dvh bg-[#060614] px-6 py-10 font-sans text-white antialiased">
      <div className="mx-auto w-full max-w-2xl">
        <Logo height={24} />

        {branding.bannerKey && (
          // A plain <img>: the source is an R2 object we control, and going
          // through the image optimizer would add a transform this app does not
          // need for a single hero image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bannerUrl(branding.bannerKey)}
            alt=""
            className="mt-6 w-full rounded-2xl border border-white/10 object-cover"
          />
        )}

        {(branding.showVenue || branding.showDate) && (
          <p className="mt-8 text-xs font-bold uppercase tracking-widest text-violet-300">
            {[branding.showVenue ? event.venue : null, branding.showDate ? when : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        )}
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{event.title}</h1>
        {branding.showDescription && (
          <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-neutral-300">
            {event.description}
          </p>
        )}

        {showPrices && cheapest !== null && (
          <p className="mt-4 text-sm text-neutral-400">
            From ₹{(cheapest / 100).toFixed(0)}
          </p>
        )}

        {test && (
          <p className="mt-8 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Test run with your draft booking rules. Nothing is charged, no seats are held and no emails are sent.
          </p>
        )}

        <div className="mt-8">
          <BuyDrawer
            testToken={test ? testToken : null}
            eventId={eventId}
            slug={event.slug}
            title={event.title}
            accentColor={branding.accentColor}
            ctaLabel={branding.ctaLabel}
            utm={{
              source: first(query.utm_source),
              medium: first(query.utm_medium),
              campaign: first(query.utm_campaign),
            }}
            autoOpen={query.resume === "1"}
          />
        </div>

        <div className="mt-10 border-t border-white/10 pt-5 text-sm text-neutral-400">
          <Link href={`/event/${event.slug}/tickets`} className="hover:text-white">
            Already bought? Find your tickets
          </Link>
          <p className="mt-1 text-xs text-neutral-600">
            Sign in with the email you booked with.
          </p>
        </div>
      </div>
    </div>
  );
}

function first(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}

/** R2 objects are served from the public media domain. */
function bannerUrl(key: string): string {
  return mediaUrl(key);
}

/** For a valid test run only: the event by slug even while it's a draft. */
async function draftForTest(slug: string, eventId: string): Promise<{ event: Event; ticketTypes: TicketType[] } | null> {
  const db = await getDb();
  const event = await db.collection<Event>("events").findOne({ slug, status: "DRAFT" });
  if (!event?._id || event._id.toString() !== eventId) return null;
  const ticketTypes = await db.collection<TicketType>("ticketTypes").find({ eventId }).sort({ pricePaise: 1 }).toArray();
  return { event, ticketTypes };
}
