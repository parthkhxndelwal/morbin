import { NoAccessState } from "@/components/patterns/states";
import { getBranding } from "@/lib/branding";
import { datasetsForBuilder } from "@/lib/datasets";
import { getTicketTypes } from "@/lib/events";
import { getActiveFlow, getFlowDraft, MAX_PER_TYPE_PER_ORDER } from "@/lib/flows";
import { requireEventAccess } from "@/lib/event-access";
import { can } from "@/lib/permissions";
import { supportNeedsApproval } from "@/lib/support";
import type { TicketType } from "@/lib/types";
import { FlowBuilder } from "./builder";

export const metadata = { title: "Booking rules" };

/**
 * Booking rules: who can book this event and what each group may buy. The
 * preview beside the editor runs the same `resolveOffer` the checkout does, so
 * what the organiser sees is what a buyer is offered.
 */
export default async function FlowBuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { role, event, org, support } = await requireEventAccess(id);
  const eventId = event._id!.toString();

  if (!can(role, "manageEvents")) {
    return <NoAccessState description="Only the organisation owner can change who can book." />;
  }

  const [ticketTypes, branding, published, draft, datasets] = await Promise.all([
    getTicketTypes(eventId),
    getBranding(eventId),
    getActiveFlow(eventId),
    getFlowDraft(eventId),
    datasetsForBuilder(org._id.toString()),
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
      datasets={datasets.map((d) => ({ id: d.id, name: d.name, columns: d.columns, keyColumn: d.keyColumn, sample: d.sample }))}
      datasetsHref={support ? `/dashboard/admin/orgs/${org._id.toString()}/datasets` : "/dashboard/datasets"}
      maxPerType={MAX_PER_TYPE_PER_ORDER}
      proposeOnly={support && supportNeedsApproval(org)}
    />
  );
}
