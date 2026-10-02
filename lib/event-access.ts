import "server-only";

import type { ObjectId } from "mongodb";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { getDb, toObjectId } from "@/lib/db";
import { getOrgForUser } from "@/lib/organizations";
import type { AccessRole } from "@/lib/permissions";
import type { Event, Organization, User } from "@/lib/types";

/**
 * Who may open one event's pages, and as what.
 *
 * Members of the event's organisation get their own role. A platform admin gets
 * SUPPORT: the same screens the owner uses, for fixing the event's setup on the
 * organisation's behalf — never impersonation, and never the buyers' data
 * (see `can()`). Everyone else gets a 404, so an id reveals nothing.
 *
 * The admin check reads the user document, not the session token, matching
 * `requireAdmin`: a demoted admin loses support access immediately.
 */

type Doc<T> = T & { _id: ObjectId };

export interface EventAccess {
  userId: string;
  role: AccessRole;
  support: boolean;
  event: Doc<Event>;
  org: Doc<Organization>;
}

const isPlatformAdmin = cache(async (userId: string): Promise<boolean> => {
  const db = await getDb();
  const user = await db.collection<User>("users").findOne({ _id: toObjectId(userId)! }, { projection: { role: 1 } });
  return user?.role === "ADMIN";
});

/** Resolve access without redirecting; null means "not found" to this caller. */
export const resolveEventAccess = cache(async (eventId: string): Promise<EventAccess | "signed-out" | null> => {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return "signed-out";
  const _id = toObjectId(eventId);
  if (!_id) return null;
  const db = await getDb();
  const event = await db.collection<Event>("events").findOne({ _id });
  if (!event?._id) return null;

  if (await isPlatformAdmin(userId)) {
    const org = await db.collection<Organization>("organizations").findOne({ _id: toObjectId(event.organizationId)! });
    if (!org?._id) return null;
    return { userId, role: "SUPPORT", support: true, event: event as Doc<Event>, org: org as Doc<Organization> };
  }
  const resolved = await getOrgForUser(userId);
  if (!resolved?.org._id || resolved.org._id.toString() !== event.organizationId) return null;
  return {
    userId,
    role: resolved.role,
    support: false,
    event: event as Doc<Event>,
    org: { ...resolved.org, _id: resolved.org._id },
  };
});

/** For pages and layouts: settled, or redirect/404. */
export async function requireEventAccess(eventId: string): Promise<EventAccess> {
  const access = await resolveEventAccess(eventId);
  if (access === "signed-out") redirect("/auth");
  if (!access) notFound();
  return access;
}

/** For API routes: a status to return instead of throwing. */
export async function eventApiAccess(
  eventId: string,
): Promise<{ access: EventAccess } | { error: string; status: number }> {
  const access = await resolveEventAccess(eventId);
  if (access === "signed-out") return { error: "Unauthorized", status: 401 };
  if (!access) return { error: "Not found", status: 404 };
  return { access };
}
