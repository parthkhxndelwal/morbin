import { auth } from "@/lib/auth";
import { getOrgForUser } from "@/lib/organizations";
import { can, type Capability } from "@/lib/permissions";
import type { Organization, OrgRole } from "@/lib/types";
import type { ObjectId } from "mongodb";

export interface OrgActor {
  userId: string;
  org: Organization & { _id: ObjectId };
  orgId: string;
  role: OrgRole;
}

/**
 * Authorise a server action for the caller's organisation.
 *
 * Returns a message instead of redirecting or throwing, so the action can hand
 * it back as `err(...)` and the dialog shows it in place. Suspended
 * organisations can still read, but not change, anything that sells.
 */
export async function orgActor(
  capability: Capability,
  opts: { allowSuspended?: boolean } = {},
): Promise<{ actor: OrgActor } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Your session has ended. Sign in again." };
  const resolved = await getOrgForUser(session.user.id);
  if (!resolved?.org._id) return { error: "You're not part of an organisation." };
  if (!can(resolved.role, capability)) {
    return { error: "Only the organisation owner can do that." };
  }
  if (!opts.allowSuspended && resolved.org.status === "SUSPENDED") {
    return { error: "This organisation is suspended. Contact Morbin support." };
  }
  return {
    actor: {
      userId: session.user.id,
      org: { ...resolved.org, _id: resolved.org._id },
      orgId: resolved.org._id.toString(),
      role: resolved.role,
    },
  };
}

/**
 * Who may change an event: its organisation's OWNER, or a platform ADMIN acting
 * as support. Returns the actor in the shape `lib/event-service` takes, with
 * `capacity` recording which one it was so every change is attributed.
 */
export async function eventEditor(
  eventId: string,
): Promise<{ actor: import("@/lib/event-service").EventActor } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Your session has ended. Sign in again." };
  const { getDb, toObjectId } = await import("@/lib/db");
  const db = await getDb();
  const eventOid = toObjectId(eventId);
  if (!eventOid) return { error: "Event not found." };
  const event = await db
    .collection<{ organizationId: string }>("events")
    .findOne({ _id: eventOid }, { projection: { organizationId: 1 } });
  if (!event) return { error: "Event not found." };

  const user = await db
    .collection<{ role?: string }>("users")
    .findOne({ _id: toObjectId(session.user.id) as never }, { projection: { role: 1 } });
  if (user?.role === "ADMIN") {
    return { actor: { organizationId: event.organizationId, userId: session.user.id, capacity: "ADMIN" } };
  }
  const guard = await orgActor("manageEvents");
  if ("error" in guard) return guard;
  if (guard.actor.orgId !== event.organizationId) return { error: "Event not found." };
  return { actor: { organizationId: event.organizationId, userId: session.user.id, capacity: "OWNER" } };
}

/**
 * Who may manage an organisation's datasets: its OWNER, or a platform ADMIN as
 * support for the organisation named by `supportOrgId`. The id is only read
 * for admins; anyone else always acts on their own organisation.
 */
export async function datasetActor(
  supportOrgId: string | null,
): Promise<{ actor: import("@/lib/datasets").DatasetActor } | { error: string }> {
  const session = await auth();
  if (!session?.user?.id) return { error: "Your session has ended. Sign in again." };
  const { getDb, toObjectId } = await import("@/lib/db");
  const db = await getDb();
  const user = await db
    .collection<{ role?: string }>("users")
    .findOne({ _id: toObjectId(session.user.id) as never }, { projection: { role: 1 } });
  if (user?.role === "ADMIN") {
    const orgOid = supportOrgId ? toObjectId(supportOrgId) : null;
    const org = orgOid ? await db.collection("organizations").findOne({ _id: orgOid }, { projection: { _id: 1 } }) : null;
    if (!org) return { error: "Organisation not found." };
    return { actor: { userId: session.user.id, orgId: org._id.toString(), role: "SUPPORT" } };
  }
  const guard = await orgActor("manageDatasets");
  if ("error" in guard) return guard;
  return { actor: { userId: session.user.id, orgId: guard.actor.orgId, role: "OWNER" } };
}
