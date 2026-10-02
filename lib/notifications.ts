import type { Filter } from "mongodb";
import { auth } from "@/lib/auth";
import { getDb, toObjectId } from "@/lib/db";
import { getOrgForUser } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import type { Notification } from "@/lib/types";

/**
 * Reading and clearing in-dashboard notifications.
 *
 * Notifications are written by `lib/audit`'s `notify` and addressed by
 * *audience*, not by user: an `ORG_OWNER` notice carries the organisation id, an
 * `ADMIN` notice carries none. Org notices are about payouts, refunds and
 * support changes — the owner's finance desk — so only roles with the `finance`
 * capability read them; a MEMBER has no inbox, the same as they have no
 * Payouts or Refunds page.
 *
 * Every read and every write filters on the caller's scope *inside the query*.
 * A post-check would be too late on a write: the notification would already have
 * been marked read for somebody else's organisation.
 */

export interface NotificationScope {
  audience: Notification["audience"];
  /** Null for ADMIN; the organisation id for ORG_OWNER. */
  organizationId: string | null;
}

/**
 * The plain view model client components receive — never a Mongo document.
 * `_id` becomes a string and the dates ISO strings, so nothing internal or
 * unserialisable crosses to the browser.
 */
export interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** Site-relative path, or null when there is nowhere to go. */
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Every platform admin sees the same desk, so ADMIN notices carry no org id. */
export const ADMIN_NOTIFICATIONS: NotificationScope = { audience: "ADMIN", organizationId: null };

/** Owner-relevant notices for one organisation, or null for a role that reads none. */
export function orgNotifications(
  organizationId: string,
  role: Parameters<typeof can>[0],
): NotificationScope | null {
  return can(role, "finance") ? { audience: "ORG_OWNER", organizationId } : null;
}

function scopeFilter(scope: NotificationScope): Filter<Notification> {
  return { audience: scope.audience, organizationId: scope.organizationId };
}

/**
 * `link` is written by us, but it is still rendered into an anchor: anything
 * that is not a same-origin, site-relative path is dropped rather than trusted.
 */
function safeLink(link: string | null): string | null {
  if (!link) return null;
  return /^\/(?!\/)/.test(link) ? link : null;
}

function toItem(n: Notification): NotificationItem | null {
  if (!n._id || !n.createdAt) return null;
  return {
    id: n._id.toString(),
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: safeLink(n.link),
    readAt: n.readAt ? new Date(n.readAt).toISOString() : null,
    createdAt: new Date(n.createdAt).toISOString(),
  };
}

/** Most recent first. The bell asks for a handful; the page for a full page. */
export async function getNotifications(
  scope: NotificationScope,
  opts: { limit?: number } = {},
): Promise<NotificationItem[]> {
  const db = await getDb();
  const limit = Math.min(Math.max(opts.limit ?? 8, 1), 50);
  const docs = await db
    .collection<Notification>("notifications")
    .find(scopeFilter(scope), {
      projection: { kind: 1, title: 1, body: 1, link: 1, readAt: 1, createdAt: 1 },
    })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  // A document without an id or a date can't be rendered or linked to.
  return docs.flatMap((d) => {
    const item = toItem(d);
    return item ? [item] : [];
  });
}

/** Answers the badge in one indexed count — see the `{audience, organizationId}` index. */
export async function getUnreadCount(scope: NotificationScope): Promise<number> {
  const db = await getDb();
  return db
    .collection<Notification>("notifications")
    .countDocuments({ ...scopeFilter(scope), readAt: null });
}

/**
 * Mark one notification read. The scope is part of the filter, so an id outside
 * it updates nothing. Already-read notifications are skipped rather than
 * re-stamped, which makes a double click harmless.
 *
 * Returns true when a document actually changed.
 */
export async function markRead(id: string, scope: NotificationScope): Promise<boolean> {
  const _id = toObjectId(id);
  if (!_id) return false;
  const db = await getDb();
  const result = await db
    .collection<Notification>("notifications")
    .updateOne({ _id, ...scopeFilter(scope), readAt: null }, { $set: { readAt: new Date() } });
  return result.modifiedCount > 0;
}

/** Clear the whole inbox for one audience. Returns how many were unread. */
export async function markAllRead(scope: NotificationScope): Promise<number> {
  const db = await getDb();
  const result = await db
    .collection<Notification>("notifications")
    .updateMany({ ...scopeFilter(scope), readAt: null }, { $set: { readAt: new Date() } });
  return result.modifiedCount;
}

type Classification =
  | { kind: "admin" }
  | { kind: "org"; scope: NotificationScope }
  | { kind: "signedOut" }
  | { kind: "noOrg" }
  | { kind: "noInbox" };

/**
 * Which audience the signed-in person reads, from the same authority the
 * dashboard shell already uses: the platform role on the session, otherwise
 * organisation membership. Client-supplied scope is never accepted — a caller
 * cannot ask for an audience that isn't theirs.
 */
async function classify(): Promise<Classification> {
  const session = await auth();
  if (!session?.user?.id) return { kind: "signedOut" };
  if (session.user.role === "ADMIN") return { kind: "admin" };
  const resolved = await getOrgForUser(session.user.id);
  if (!resolved?.org._id) return { kind: "noOrg" };
  const scope = orgNotifications(resolved.org._id.toString(), resolved.role);
  return scope ? { kind: "org", scope } : { kind: "noInbox" };
}

/** The caller's scope, or null when they read no inbox at all. */
export async function getNotificationScope(): Promise<NotificationScope | null> {
  const who = await classify();
  if (who.kind === "admin") return ADMIN_NOTIFICATIONS;
  return who.kind === "org" ? who.scope : null;
}

/**
 * The action-friendly variant: a message instead of a redirect, so a server
 * action can hand it back as `err(...)` and show it where the button was.
 */
export async function resolveNotificationScope(): Promise<
  { scope: NotificationScope } | { error: string }
> {
  const who = await classify();
  if (who.kind === "admin") return { scope: ADMIN_NOTIFICATIONS };
  if (who.kind === "org") return { scope: who.scope };
  return {
    error:
      who.kind === "signedOut"
        ? "Your session has ended. Sign in again."
        : who.kind === "noInbox"
          ? "Notifications are for the organisation owner."
          : "You're not part of an organisation.",
  };
}
