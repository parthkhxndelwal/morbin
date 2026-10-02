import { getDb } from "@/lib/db";
import type { CheckoutFlow, FlowStep } from "@/lib/types";

/**
 * Reading and writing flow documents.
 *
 * The rules themselves live in `lib/flow-rules.ts`, which has no database
 * dependency; this module is only the persistence around them. Kept apart so the
 * rules can be imported and tested from a plain Node script.
 */

export {
  MAX_PER_TYPE_PER_ORDER,
  emailMatchesIdentity,
  findStep,
  permissiveFlow,
  resolveOffer,
  visibleFieldIds,
} from "@/lib/flow-rules";

/** The published flow for an event, or a permissive stand-in. Never null. */
export async function getActiveFlow(eventId: string): Promise<CheckoutFlow> {
  const db = await getDb();
  const flow = await db
    .collection<CheckoutFlow>("checkoutFlows")
    .findOne({ eventId, status: "PUBLISHED" }, { sort: { version: -1 } });
  const { permissiveFlow } = await import("@/lib/flow-rules");
  return flow ?? permissiveFlow(eventId);
}

/** The organizer's unpublished working copy, if one exists. */
export async function getFlowDraft(eventId: string): Promise<CheckoutFlow | null> {
  const db = await getDb();
  return db
    .collection<CheckoutFlow>("checkoutFlows")
    .findOne({ eventId, status: "DRAFT" }, { sort: { version: -1 } });
}

export async function createFlow(flow: CheckoutFlow): Promise<CheckoutFlow> {
  const db = await getDb();
  await db.collection<CheckoutFlow>("checkoutFlows").insertOne(flow);
  return flow;
}

/**
 * Publish a flow as a new version.
 *
 * Versioned rather than edited in place: a buyer sitting on an open drawer has
 * already agreed to a set of rules, and the order route refuses an order whose
 * pinned version is no longer live. Editing the live document would invalidate
 * exactly those buyers, mid-checkout.
 */
export async function publishFlow(eventId: string, steps: FlowStep[]): Promise<CheckoutFlow> {
  const db = await getDb();
  const latest = await db
    .collection<CheckoutFlow>("checkoutFlows")
    .find({ eventId })
    .sort({ version: -1 })
    .limit(1)
    .toArray();
  const version = (latest[0]?.version ?? 0) + 1;
  const now = new Date();
  const published: CheckoutFlow = {
    eventId,
    version,
    status: "PUBLISHED",
    steps,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<CheckoutFlow>("checkoutFlows").insertOne(published);
  // Retire the previous version (and any stale draft) so exactly one PUBLISHED
  // row exists per event.
  await db
    .collection<CheckoutFlow>("checkoutFlows")
    .updateMany(
      { eventId, version: { $ne: version } },
      { $set: { status: "DRAFT", updatedAt: now } },
    );
  return published;
}

/** Save the working copy without touching what buyers are sold against. */
export async function saveFlowDraft(eventId: string, steps: FlowStep[]): Promise<CheckoutFlow> {
  const db = await getDb();
  const existing = await db
    .collection<CheckoutFlow>("checkoutFlows")
    .findOne({ eventId, status: "DRAFT" }, { sort: { version: -1 } });
  const now = new Date();
  if (existing) {
    await db
      .collection<CheckoutFlow>("checkoutFlows")
      .updateOne({ _id: existing._id }, { $set: { steps, updatedAt: now } });
    return { ...existing, steps, updatedAt: now };
  }
  const draft: CheckoutFlow = {
    eventId,
    version: 0,
    status: "DRAFT",
    steps,
    createdAt: now,
    updatedAt: now,
  };
  await db.collection<CheckoutFlow>("checkoutFlows").insertOne(draft);
  return draft;
}
