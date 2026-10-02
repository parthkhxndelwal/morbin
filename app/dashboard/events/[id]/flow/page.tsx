import { notFound } from "next/navigation";
import { NoAccessState } from "@/components/patterns/states";
import { getBranding } from "@/lib/branding";
import { getEventById, getTicketTypes } from "@/lib/events";
import { getActiveFlow, getFlowDraft, MAX_PER_TYPE_PER_ORDER } from "@/lib/flows";
import { requireOrgSession } from "@/lib/guards";
import { can } from "@/lib/permissions";
import type { TicketType } from "@/lib/types";
import { FlowBuilder } from "./builder";

export const metadata = { title: "Booking rules" };

/**
 * Booking rules: who can book this event and what each group may buy. The
 * preview beside the editor runs the same `resolveOffer` the checkout does, so
 * what the organiser sees is what a buyer is offered.
 */
export default async function FlowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { org, role } = await requireOrgSession();
  const { id } = await params;
  const event = await getEventById(id);
  if (!event || event.organizationId !== org._id.toString()) notFound();
  const eventId = event._id!.toString();

  if (!can(role, "manageEvents")) {
    return <NoAccessState description="Only the organisation owner can change who can book." />;
  }

  const [ticketTypes, branding, published, draft] = await Promise.all([
    getTicketTypes(eventId),
    getBranding(eventId),
    getActiveFlow(eventId),
    getFlowDraft(eventId),
  ]);

  return (
    <FlowBuilder
      eventId={eventId}
      ticketTypes={(ticketTypes as TicketType[]).map((t) => ({
        id: t._id!.toString(),
        name: t.name,
        pricePaise: t.pricePaise,
        capacity: t.capacity,
        soldCount: t.soldCount,
        status: t.status ?? null,
        saleStartsAt: t.saleStartsAt ? new Date(t.saleStartsAt).toISOString() : null,
        saleEndsAt: t.saleEndsAt ? new Date(t.saleEndsAt).toISOString() : null,
        defaultMaxPerOrder: t.defaultMaxPerOrder ?? null,
        audienceOptionIds: t.audienceOptionIds ?? null,
      }))}
      customFields={branding.customFields.map((f) => ({
        id: f.id,
        label: f.label,
        required: f.required,
      }))}
      published={{ version: published.version, steps: published.steps }}
      draft={draft ? { steps: draft.steps } : null}
      eventStatus={event.status}
      maxPerType={MAX_PER_TYPE_PER_ORDER}
    />
  );
}
