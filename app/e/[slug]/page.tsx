import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublishedEventBySlug } from "@/lib/events";
import { BuyBox } from "./buy-box";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const data = await getPublishedEventBySlug(slug);
  if (!data) return { title: "Event not found — Morbin" };
  return {
    title: `${data.event.title} — Morbin`,
    description: data.event.description.slice(0, 150),
  };
}

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await getPublishedEventBySlug(slug);
  if (!data) notFound();
  const { event, ticketTypes } = data;
  const when = new Date(event.startsAt).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="min-h-dvh bg-[#060614] px-6 py-10 font-sans text-white antialiased">
      <div className="mx-auto w-full max-w-2xl">
        <Link href="/" className="text-lg font-extrabold lowercase tracking-tight">
          morbin
        </Link>
        <p className="mt-8 text-xs font-bold uppercase tracking-widest text-violet-300">
          {event.venue} · {when}
        </p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{event.title}</h1>
        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-neutral-300">
          {event.description}
        </p>
        <div className="mt-8">
          <BuyBox
            eventId={event._id!.toString()}
            types={ticketTypes.map((t) => ({
              id: t._id!.toString(),
              name: t.name,
              description: t.description,
              pricePaise: t.pricePaise,
              capacity: t.capacity,
              soldCount: t.soldCount,
            }))}
          />
        </div>
      </div>
    </div>
  );
}
