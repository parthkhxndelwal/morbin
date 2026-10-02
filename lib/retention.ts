import "server-only";

import { ObjectId } from "mongodb";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { listMediaFiles, mediaBucket, removeMediaTemp } from "@/lib/media";
import { getPlatformSettings } from "@/lib/platform-settings";
import { anonymiseEvent } from "@/lib/privacy";
import {
  ABANDONED_SESSION_DAYS,
  AUDIT_RETENTION_YEARS,
  EMAIL_META_DAYS,
  INVOICE_RETENTION_YEARS,
  ORPHAN_MEDIA_HOURS,
  READ_NOTIFICATION_DAYS,
  daysAgo,
  isPastRetention,
  retentionCutoff,
  retentionDue,
  yearsAgo,
} from "@/lib/retention-rules";
import type { Event, EventBranding, Organization } from "@/lib/types";

/**
 * The daily DPDP retention job (scheduled from lib/scheduler.ts, or "Run now"
 * in Admin → Settings).
 *
 * - Events whose `endsAt + retentionMonths` has passed: buyers and attendees
 *   anonymised (lib/privacy.ts anonymiseEvent) and ticket PDFs deleted, once
 *   per event (`piiPurgedAt`).
 * - Checkouts that never became an order, after 30 days: deleted.
 * - Rendered email content after 90 days: stripped (the delivery row stays).
 * - Uploaded images no event uses, after 24 hours: deleted.
 * - Invoices and audit entries after 8 years: deleted. The ledger is never touched.
 *
 * Each step is idempotent and only touches data long past any live checkout,
 * so it is safe beside traffic. A lease in `jobRuns` keeps two runs (the
 * scheduler and an admin's "Run now") from overlapping. Logs counts only.
 */

export interface RetentionCounts {
  events: number;
  orders: number;
  tickets: number;
  ticketPdfs: number;
  checkoutSessions: number;
  emailMeta: number;
  orphanMedia: number;
  invoices: number;
  auditLogs: number;
  notifications: number;
}

export interface RetentionRun {
  _id: "retention";
  /** Held while a run is in progress; a crashed run's lease simply expires. */
  leaseUntil: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  trigger: "SCHEDULE" | "ADMIN" | null;
  counts: RetentionCounts | null;
  error: string | null;
}

const LEASE_MS = 30 * 60 * 1000;

function emptyCounts(): RetentionCounts {
  return {
    events: 0,
    orders: 0,
    tickets: 0,
    ticketPdfs: 0,
    checkoutSessions: 0,
    emailMeta: 0,
    orphanMedia: 0,
    invoices: 0,
    auditLogs: 0,
    notifications: 0,
  };
}

export async function getRetentionRun(): Promise<RetentionRun | null> {
  const db = await getDb();
  return db.collection<RetentionRun>("jobRuns").findOne({ _id: "retention" });
}

async function takeLease(now: Date): Promise<boolean> {
  const db = await getDb();
  const runs = db.collection<RetentionRun>("jobRuns");
  await runs.updateOne(
    { _id: "retention" },
    { $setOnInsert: { leaseUntil: null, startedAt: null, finishedAt: null, trigger: null, counts: null, error: null } },
    { upsert: true },
  );
  const res = await runs.updateOne(
    { _id: "retention", $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] },
    { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS) } },
  );
  return res.modifiedCount === 1;
}

/** Events past retention, per organisation's own period. */
async function dueEvents(now: Date): Promise<string[]> {
  const db = await getDb();
  const settings = await getPlatformSettings();
  const orgs = await db
    .collection<Organization>("organizations")
    .find({}, { projection: { retentionMonths: 1 } })
    .toArray();
  const monthsByOrg = new Map(orgs.map((o) => [o._id!.toString(), o.retentionMonths ?? settings.defaultRetentionMonths]));
  // The shortest period gives the widest net; each event is then checked against its own org.
  const shortest = Math.min(settings.defaultRetentionMonths, ...monthsByOrg.values());
  const candidates = await db
    .collection<Event>("events")
    .find({ endsAt: { $lt: retentionCutoff(now, shortest) }, piiPurgedAt: null }, { projection: { organizationId: 1, endsAt: 1 } })
    .toArray();
  return candidates
    .filter((e) => isPastRetention(e.endsAt, monthsByOrg.get(e.organizationId) ?? settings.defaultRetentionMonths, now))
    .map((e) => e._id!.toString());
}

/** Media no event's branding references, older than the grace period. */
async function sweepMedia(now: Date): Promise<number> {
  const db = await getDb();
  const graceStart = new Date(now.getTime() - ORPHAN_MEDIA_HOURS * 60 * 60 * 1000);
  const files = (await listMediaFiles()).filter((f) => f.modifiedAt < graceStart);
  if (!files.length) return 0;
  const branding = await db
    .collection<EventBranding>("eventBranding")
    .find({}, { projection: { bannerKey: 1, socialImageKey: 1 } })
    .toArray();
  const referenced = new Set(branding.flatMap((b) => [b.bannerKey, b.socialImageKey]).filter((k): k is string => !!k));
  let removed = 0;
  for (const f of files) {
    if (f.key && referenced.has(f.key)) continue;
    if (f.key) await mediaBucket().delete(f.key);
    else await removeMediaTemp(f.file);
    removed++;
  }
  return removed;
}

async function sweep(now: Date): Promise<RetentionCounts> {
  const db = await getDb();
  const counts = emptyCounts();

  for (const eventId of await dueEvents(now)) {
    const r = await anonymiseEvent(eventId);
    if (!r) continue;
    counts.events++;
    counts.orders += r.orders;
    counts.tickets += r.tickets;
    counts.ticketPdfs += r.documents;
  }

  counts.checkoutSessions = (
    await db
      .collection("checkoutSessions")
      .deleteMany({ status: { $ne: "COMPLETED" }, orderId: null, createdAt: { $lt: daysAgo(now, ABANDONED_SESSION_DAYS) } })
  ).deletedCount;

  // Delivery rows carry no creation date; the ObjectId's timestamp is it.
  counts.emailMeta = (
    await db
      .collection("emailDeliveries")
      .updateMany(
        { _id: { $lt: ObjectId.createFromTime(Math.floor(daysAgo(now, EMAIL_META_DAYS).getTime() / 1000)) }, status: { $in: ["SENT", "FAILED"] }, meta: { $ne: null } },
        { $set: { meta: null } },
      )
  ).modifiedCount;

  counts.orphanMedia = await sweepMedia(now);

  counts.invoices = (await db.collection("invoices").deleteMany({ issuedAt: { $lt: yearsAgo(now, INVOICE_RETENTION_YEARS) } })).deletedCount;
  counts.auditLogs = (await db.collection("auditLogs").deleteMany({ at: { $lt: yearsAgo(now, AUDIT_RETENTION_YEARS) } })).deletedCount;
  counts.notifications = (
    await db.collection("notifications").deleteMany({ readAt: { $ne: null, $lt: daysAgo(now, READ_NOTIFICATION_DAYS) } })
  ).deletedCount;

  return counts;
}

export type RetentionOutcome = { ran: true; counts: RetentionCounts } | { ran: false; reason: "busy" | "not_due" };

/**
 * Run the job. `force` (admin "Run now") skips the once-a-day check but never
 * the lease. Throws only if the sweep itself failed, after recording it.
 */
export async function runRetention(opts: { trigger: "SCHEDULE" | "ADMIN"; actorId?: string | null; now?: Date }): Promise<RetentionOutcome> {
  const now = opts.now ?? new Date();
  const db = await getDb();
  if (opts.trigger === "SCHEDULE") {
    const last = await getRetentionRun();
    if (!retentionDue(last?.finishedAt ?? null, now)) return { ran: false, reason: "not_due" };
  }
  if (!(await takeLease(now))) return { ran: false, reason: "busy" };
  const runs = db.collection<RetentionRun>("jobRuns");
  await runs.updateOne({ _id: "retention" }, { $set: { startedAt: new Date(), trigger: opts.trigger } });
  try {
    const counts = await sweep(now);
    await runs.updateOne({ _id: "retention" }, { $set: { finishedAt: new Date(), counts, error: null, leaseUntil: null } });
    console.info("[retention]", counts);
    await audit({
      actorId: opts.actorId ?? null,
      actorRole: opts.actorId ? "ADMIN" : "SYSTEM",
      action: "retention.run",
      targetType: "platform",
      targetId: null,
      organizationId: null,
      meta: { ...counts },
    });
    return { ran: true, counts };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    await runs.updateOne({ _id: "retention" }, { $set: { error: message.slice(0, 300), leaseUntil: null } });
    throw error;
  }
}
