"use server";

import { revalidatePath } from "next/cache";
import { audit, notify } from "@/lib/audit";
import { eventEditor, orgActor } from "@/lib/action-guards";
import { getDb, toObjectId } from "@/lib/db";
import {
  cancelEvent,
  createTicketTypeFor,
  deleteTicketType,
  previewCancellation,
  setEventStatus,
  setTicketTypeStatus,
  updateTicketTypeFor,
  type CancellationPreview,
  type EventActor,
} from "@/lib/event-service";
import { createEventWithDefaults, updateEventSlug } from "@/lib/events";
import { err, ok, zodFieldErrors, type Result } from "@/lib/result";
import { TxAbort } from "@/lib/tx";
import type { Event, TicketTypeStatus } from "@/lib/types";
import { eventDetailsSchema, ticketTypeSchema } from "@/lib/validations";

/**
 * Server actions for events. Each one authorises through `eventEditor` (owner,
 * or Morbin support), delegates every rule to `lib/event-service`, and returns
 * a Result — never throws to the client.
 */

async function run<T>(fn: () => Promise<T>, message?: string): Promise<Result<T>> {
  try {
    return ok(await fn(), message);
  } catch (error) {
    if (error instanceof TxAbort) return err(error.message);
    console.error("[events:action]", error);
    return err("Something went wrong. Please try again.");
  }
}

/** Support edits are visible to the organisation: tell the owner. */
async function noteSupportChange(actor: EventActor, eventId: string, what: string) {
  if (actor.capacity !== "ADMIN") return;
  await notify({
    organizationId: actor.organizationId,
    audience: "ORG_OWNER",
    kind: "SUPPORT_CHANGE",
    title: "Morbin support updated your event",
    body: what,
    link: `/dashboard/events/${eventId}`,
  });
}

function refresh(eventId: string) {
  revalidatePath(`/dashboard/events/${eventId}`, "layout");
  revalidatePath("/dashboard/events");
}

/** Create a draft event in the caller's organisation. Owner only. */
export async function createEventAction(formData: FormData): Promise<Result<{ id: string }>> {
  const guard = await orgActor("manageEvents");
  if ("error" in guard) return err(guard.error);
  const parsed = eventDetailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const event = await createEventWithDefaults(guard.actor.orgId, { ...parsed.data, timezone: "Asia/Kolkata" });
  return ok({ id: event._id!.toString() }, "Draft event created");
}

export async function updateEventDetailsAction(eventId: string, formData: FormData): Promise<Result> {
  const guard = await eventEditor(eventId);
  if ("error" in guard) return err(guard.error);
  const parsed = eventDetailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  const slugInput = String(formData.get("slug") ?? "").trim();
  const feeBearer = String(formData.get("feeBearer") ?? "");

  return run(async () => {
    const db = await getDb();
    const _id = toObjectId(eventId)!;
    const current = await db
      .collection<Event>("events")
      .findOne({ _id, organizationId: guard.actor.organizationId });
    if (!current) throw new TxAbort("Event not found", 404);
    if (current.status === "CANCELLED") throw new TxAbort("A cancelled event can't be edited.");

    // The slug is checked (shape + uniqueness) first, so a bad one saves nothing.
    if (slugInput && slugInput !== current.slug) {
      const r = await updateEventSlug(eventId, guard.actor.organizationId, slugInput);
      if (!r.ok) throw new TxAbort(r.error);
    }
    const set: Partial<Event> = { ...parsed.data, updatedAt: new Date() };
    if (feeBearer === "CUSTOMER" || feeBearer === "ORGANISER") set.feeBearer = feeBearer;
    else if (feeBearer === "DEFAULT") set.feeBearer = null;
    await db.collection<Event>("events").updateOne({ _id, organizationId: guard.actor.organizationId }, { $set: set });
    await audit({
      actorId: guard.actor.userId,
      actorRole: guard.actor.capacity,
      action: "event.updated",
      targetType: "event",
      targetId: eventId,
      organizationId: guard.actor.organizationId,
      meta: { support: guard.actor.capacity === "ADMIN" },
    });
    await noteSupportChange(guard.actor, eventId, `Event details for "${parsed.data.title}" were edited.`);
    refresh(eventId);
  }, "Event details saved");
}

export async function setEventStatusAction(eventId: string, next: "PUBLISHED" | "DRAFT"): Promise<Result> {
  const guard = await eventEditor(eventId);
  if ("error" in guard) return err(guard.error);
  return run(async () => {
    await setEventStatus(guard.actor, eventId, next);
    await noteSupportChange(guard.actor, eventId, next === "PUBLISHED" ? "Your event was published." : "Your event was unpublished.");
    refresh(eventId);
  }, next === "PUBLISHED" ? "Event published — it's live" : "Event moved back to draft");
}

export async function previewCancellationAction(eventId: string): Promise<Result<CancellationPreview>> {
  const guard = await eventEditor(eventId);
  if ("error" in guard) return err(guard.error);
  return run(() => previewCancellation(guard.actor.organizationId, eventId));
}

export async function cancelEventAction(eventId: string, reason: string): Promise<Result<{ requested: number; failed: number }>> {
  const guard = await eventEditor(eventId);
  if ("error" in guard) return err(guard.error);
  if (reason.trim().length < 5) return err("Tell buyers why (at least 5 characters).");
  return run(async () => {
    const r = await cancelEvent(guard.actor, eventId, reason.trim());
    await noteSupportChange(guard.actor, eventId, "Your event was cancelled and refunds were requested.");
    refresh(eventId);
    return { requested: r.requested, failed: r.failed.length };
  }, "Event cancelled. Buyers have been emailed.");
}

function ticketInput(formData: FormData) {
  const parsed = ticketTypeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: zodFieldErrors(parsed.error.issues) } as const;
  const v = parsed.data;
  return {
    input: {
      name: v.name,
      description: v.description,
      pricePaise: v.price,
      capacity: v.capacity,
      saleStartsAt: v.saleStartsAt,
      saleEndsAt: v.saleEndsAt,
      defaultMaxPerOrder: v.maxPerOrder,
    },
  } as const;
}

export async function createTicketTypeAction(eventId: string, formData: FormData): Promise<Result> {
  const guard = await eventEditor(eventId);
  if ("error" in guard) return err(guard.error);
  const parsed = ticketInput(formData);
  if ("error" in parsed) return err("Check the highlighted fields.", parsed.error);
  return run(async () => {
    await createTicketTypeFor(guard.actor, eventId, parsed.input);
    await noteSupportChange(guard.actor, eventId, `Ticket type "${parsed.input.name}" was added.`);
    refresh(eventId);
  }, "Ticket type added");
}

export async function updateTicketTypeAction(eventId: string, ticketTypeId: string, formData: FormData): Promise<Result> {
  const guard = await eventEditor(eventId);
  if ("error" in guard) return err(guard.error);
  const parsed = ticketInput(formData);
  if ("error" in parsed) return err("Check the highlighted fields.", parsed.error);
  return run(async () => {
    await updateTicketTypeFor(guard.actor, eventId, ticketTypeId, parsed.input);
    await noteSupportChange(guard.actor, eventId, `Ticket type "${parsed.input.name}" was edited.`);
    refresh(eventId);
  }, "Ticket type saved");
}

export async function setTicketTypeStatusAction(
  eventId: string,
  ticketTypeId: string,
  status: TicketTypeStatus,
): Promise<Result> {
  const guard = await eventEditor(eventId);
  if ("error" in guard) return err(guard.error);
  const label = status === "ACTIVE" ? "Sales resumed" : status === "PAUSED" ? "Sales paused" : "Ticket type hidden";
  return run(async () => {
    await setTicketTypeStatus(guard.actor, eventId, ticketTypeId, status);
    refresh(eventId);
  }, label);
}

export async function deleteTicketTypeAction(eventId: string, ticketTypeId: string): Promise<Result> {
  const guard = await eventEditor(eventId);
  if ("error" in guard) return err(guard.error);
  return run(async () => {
    await deleteTicketType(guard.actor, eventId, ticketTypeId);
    refresh(eventId);
  }, "Ticket type deleted");
}
