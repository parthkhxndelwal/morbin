import "server-only";

import { audit } from "@/lib/audit";
import { getDb, toObjectId } from "@/lib/db";
import { TxAbort } from "@/lib/tx";
import type { EmailRecord, Event, RefundCase, RefundMessage } from "@/lib/types";

/**
 * Morbin admins writing to a refund's customer, e.g. to confirm bank details
 * for a manual refund. Each message is queued as a REFUND_MESSAGE email
 * (Reply-To: SUPPORT_EMAIL, so replies reach Morbin's inbox) and kept on the
 * case as a thread. The audit entry records the length only, never the text.
 */

export const MAX_REFUND_MESSAGE = 2000;

export async function emailRefundCustomer(caseId: string, adminId: string, text: string): Promise<void> {
  const message = text.trim();
  if (message.length < 10) throw new TxAbort("Write a message of at least 10 characters.");
  if (message.length > MAX_REFUND_MESSAGE) throw new TxAbort(`Keep it under ${MAX_REFUND_MESSAGE} characters.`);
  const _id = toObjectId(caseId);
  if (!_id) throw new TxAbort("Refund not found", 404);
  const db = await getDb();
  const rc = await db.collection<RefundCase>("refundCases").findOne({ _id });
  if (!rc) throw new TxAbort("Refund not found", 404);
  const event = await db
    .collection<Event>("events")
    .findOne({ _id: toObjectId(rc.eventId) as never }, { projection: { title: 1, venue: 1 } });

  const email: EmailRecord = {
    orderId: rc.orderId,
    ticketId: null,
    recipient: rc.customer.email,
    kind: "REFUND_MESSAGE",
    status: "QUEUED",
    attempts: 0,
    lastError: null,
    meta: {
      eventTitle: event?.title ?? "your event",
      attendeeName: rc.customer.name,
      refundAmountPaise: rc.amountPaise,
      message,
    },
  };
  const { insertedId } = await db.collection<EmailRecord>("emailDeliveries").insertOne(email);
  await db.collection<RefundMessage>("refundMessages").insertOne({
    refundCaseId: caseId,
    organizationId: rc.organizationId,
    authorId: adminId,
    authorRole: "ADMIN",
    message,
    emailId: insertedId.toString(),
    createdAt: new Date(),
  });
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: "refund.customer_emailed",
    targetType: "refundCase",
    targetId: caseId,
    organizationId: rc.organizationId,
    meta: { length: message.length },
  });
  try {
    const { flushEmailQueue } = await import("@/lib/email");
    await flushEmailQueue(5);
  } catch {
    /* the scheduler retries */
  }
}

export interface RefundMessageView {
  id: string;
  message: string;
  createdAt: string;
  delivery: "QUEUED" | "SENDING" | "SENT" | "FAILED" | null;
}

/** Threads for many cases at once (the admin queue), oldest message first. */
export async function refundThreads(caseIds: string[]): Promise<Map<string, RefundMessageView[]>> {
  const out = new Map<string, RefundMessageView[]>();
  if (caseIds.length === 0) return out;
  const db = await getDb();
  const messages = await db
    .collection<RefundMessage>("refundMessages")
    .find({ refundCaseId: { $in: caseIds } })
    .sort({ createdAt: 1 })
    .toArray();
  const emailIds = messages.map((m) => toObjectId(m.emailId ?? "")).filter((x) => !!x);
  const emails = emailIds.length
    ? await db
        .collection<EmailRecord>("emailDeliveries")
        .find({ _id: { $in: emailIds as never[] } }, { projection: { status: 1 } })
        .toArray()
    : [];
  const status = new Map(emails.map((e) => [e._id!.toString(), e.status]));
  for (const m of messages) {
    const list = out.get(m.refundCaseId) ?? [];
    list.push({
      id: m._id!.toString(),
      message: m.message,
      createdAt: m.createdAt.toISOString(),
      delivery: m.emailId ? (status.get(m.emailId) ?? null) : null,
    });
    out.set(m.refundCaseId, list);
  }
  return out;
}
