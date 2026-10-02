import type { ClientSession } from "mongodb";
import { getDb } from "@/lib/db";
import type { AuditLog, Notification } from "@/lib/types";

/**
 * Record who did what. Every admin action, every support edit, every money
 * movement and every data export goes here (DPDP accountability). Never
 * includes personal data beyond ids — `meta` carries amounts, counts, filters.
 *
 * Failures are logged, not thrown: an audit write must not undo the action it
 * describes. Pass `session` to make the record part of the same transaction.
 */
export async function audit(entry: Omit<AuditLog, "_id" | "at">, session?: ClientSession): Promise<void> {
  try {
    const db = await getDb();
    await db.collection<AuditLog>("auditLogs").insertOne({ ...entry, at: new Date() }, { session });
  } catch (error) {
    if (session) throw error;
    console.error("[audit] failed to record", entry.action, error);
  }
}

/** In-dashboard notification for an organisation's owner or for platform admins. */
export async function notify(n: Omit<Notification, "_id" | "readAt" | "createdAt">): Promise<void> {
  try {
    const db = await getDb();
    await db.collection<Notification>("notifications").insertOne({ ...n, readAt: null, createdAt: new Date() });
  } catch (error) {
    console.error("[notify] failed", n.kind, error);
  }
}
