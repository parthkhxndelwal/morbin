import "server-only";

import { ObjectId, type ClientSession, type Db } from "mongodb";
import { audit, notify } from "@/lib/audit";
import { hashToken, randomToken } from "@/lib/checkout";
import { getDb, toObjectId } from "@/lib/db";
import { deleteDocument, getDocument, readDocumentBody, storeDocument } from "@/lib/documents";
import { appUrl } from "@/lib/email";
import { DATA_REQUEST_DEADLINE_DAYS } from "@/lib/privacy-notice";
import { withTransaction } from "@/lib/tx";
import type {
  CheckoutSession,
  DataRequest,
  DataRequestStatus,
  DataRequestType,
  EmailRecord,
  Invoice,
  Order,
  RefundCase,
  Ticket,
  User,
} from "@/lib/types";

/**
 * DPDP data-principal rights: what Morbin holds for one email address, how a
 * person asks for it (access, correction, erasure), and the anonymisation
 * routine that erasure — and the retention job — share.
 *
 * Financial records survive erasure by design: amounts, invoice numbers and the
 * ledger are untouched, and tax invoices keep their recipient for the 8 years
 * the GST law requires. Audit entries never carry the address itself.
 */

/** Verification links for a new request. */
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
/** The export download link. */
export const DOWNLOAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** What erased personal fields become. Never a deliverable address. */
export const ERASED_NAME = "Erased";
export const ERASED_EMAIL = "erased@erased.invalid";

const DAY_MS = 24 * 60 * 60 * 1000;

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Matches the address whatever case it was stored in (older rows weren't lower-cased). */
function emailEq(email: string) {
  return { $regex: `^${normaliseEmail(email).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" };
}

async function queueEmail(
  db: Db,
  to: string,
  kind: "DATA_REQUEST_VERIFY" | "DATA_REQUEST_RESULT",
  meta: NonNullable<EmailRecord["meta"]>,
): Promise<void> {
  await db.collection<EmailRecord>("emailDeliveries").insertOne({
    orderId: null,
    ticketId: null,
    recipient: to,
    kind,
    status: "QUEUED",
    attempts: 0,
    lastError: null,
    meta,
  });
  try {
    const { flushEmailQueue } = await import("@/lib/email");
    await flushEmailQueue(5);
  } catch (error) {
    // Queued; the scheduler retries.
    console.error("[privacy] email flush failed", error);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Requests
 * ──────────────────────────────────────────────────────────────────────────── */

export const REQUEST_TYPES: Record<DataRequestType, string> = {
  ACCESS: "A copy of my data",
  CORRECTION: "Correct my data",
  ERASURE: "Erase my data",
};

/**
 * Start a request. Nothing reaches the admin queue until the emailed link is
 * opened, so a request can only ever be made by whoever reads that inbox.
 * Callers rate-limit; the response is the same whether or not Morbin holds
 * anything for the address.
 */
export async function createDataRequest(input: { type: DataRequestType; email: string; details: string }): Promise<void> {
  const db = await getDb();
  const token = randomToken();
  const now = new Date();
  const email = normaliseEmail(input.email);
  await db.collection<DataRequest>("dataRequests").insertOne({
    type: input.type,
    email,
    details: input.details.trim().slice(0, 2000),
    status: "UNVERIFIED",
    tokenHash: hashToken(token),
    tokenExpiresAt: new Date(now.getTime() + VERIFY_TTL_MS),
    verifiedAt: null,
    dueAt: null,
    outcome: null,
    handledBy: null,
    handledAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await queueEmail(db, email, "DATA_REQUEST_VERIFY", {
    dataRequestType: input.type,
    link: appUrl(`/privacy/request/verify?token=${encodeURIComponent(token)}`),
  });
}

export type VerifyResult = { ok: true; type: DataRequestType; dueAt: Date } | { ok: false; reason: "invalid" | "expired" };

/** Confirm a request from its emailed link. Single use: the token is cleared. */
export async function verifyDataRequest(raw: string): Promise<VerifyResult> {
  if (!raw || raw.length > 200) return { ok: false, reason: "invalid" };
  const db = await getDb();
  const now = new Date();
  const dueAt = new Date(now.getTime() + DATA_REQUEST_DEADLINE_DAYS * DAY_MS);
  const req = await db.collection<DataRequest>("dataRequests").findOneAndUpdate(
    { tokenHash: hashToken(raw), status: "UNVERIFIED" },
    { $set: { tokenHash: null } },
    { returnDocument: "before" },
  );
  if (!req) return { ok: false, reason: "invalid" };
  if (!req.tokenExpiresAt || req.tokenExpiresAt < now) return { ok: false, reason: "expired" };
  await db
    .collection<DataRequest>("dataRequests")
    .updateOne({ _id: req._id }, { $set: { status: "OPEN", verifiedAt: now, dueAt, tokenExpiresAt: null, updatedAt: now } });
  await audit({
    actorId: null,
    actorRole: "SYSTEM",
    action: "data_request.verified",
    targetType: "dataRequest",
    targetId: req._id!.toString(),
    organizationId: null,
    meta: { type: req.type },
  });
  await notify({
    organizationId: null,
    audience: "ADMIN",
    kind: "DATA_REQUEST_NEW",
    title: `New data request: ${REQUEST_TYPES[req.type].toLowerCase()}`,
    body: `Answer by ${dueAt.toISOString().slice(0, 10)}.`,
    link: "/dashboard/admin/privacy",
  });
  return { ok: true, type: req.type, dueAt };
}

export interface DataRequestRow {
  id: string;
  type: DataRequestType;
  email: string;
  details: string;
  status: DataRequestStatus;
  verifiedAt: string | null;
  dueAt: string | null;
  daysLeft: number | null;
  outcome: string | null;
  handledAt: string | null;
  downloadExpiresAt: string | null;
  downloadedAt: string | null;
  createdAt: string;
}

/** The admin queue: verified requests, open ones first by deadline. */
export async function listDataRequests(): Promise<DataRequestRow[]> {
  const db = await getDb();
  const rows = await db
    .collection<DataRequest>("dataRequests")
    .find({ status: { $ne: "UNVERIFIED" } })
    .sort({ verifiedAt: -1 })
    .limit(500)
    .toArray();
  const now = Date.now();
  return rows
    .map((r) => ({
      id: r._id!.toString(),
      type: r.type,
      email: r.email,
      details: r.details,
      status: r.status,
      verifiedAt: r.verifiedAt?.toISOString() ?? null,
      dueAt: r.dueAt?.toISOString() ?? null,
      daysLeft: r.status === "OPEN" && r.dueAt ? Math.ceil((r.dueAt.getTime() - now) / DAY_MS) : null,
      outcome: r.outcome,
      handledAt: r.handledAt?.toISOString() ?? null,
      downloadExpiresAt: r.downloadExpiresAt?.toISOString() ?? null,
      downloadedAt: r.downloadedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }))
    .sort((a, b) => Number(b.status === "OPEN") - Number(a.status === "OPEN") || (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
}

export async function countOpenDataRequests(): Promise<number> {
  const db = await getDb();
  return db.collection<DataRequest>("dataRequests").countDocuments({ status: "OPEN" });
}

export class PrivacyError extends Error {}

async function openRequest(id: string): Promise<DataRequest> {
  const _id = toObjectId(id);
  const db = await getDb();
  const req = _id ? await db.collection<DataRequest>("dataRequests").findOne({ _id }) : null;
  if (!req) throw new PrivacyError("Request not found");
  if (req.status !== "OPEN") throw new PrivacyError("This request has already been handled");
  return req;
}

/** Close a request: record the outcome, tell the requester, audit (no PII). */
async function close(
  req: DataRequest,
  status: "DONE" | "REJECTED",
  outcome: string,
  adminId: string,
  extra: Partial<DataRequest> = {},
  auditMeta: Record<string, unknown> = {},
): Promise<void> {
  const db = await getDb();
  const now = new Date();
  const res = await db
    .collection<DataRequest>("dataRequests")
    .updateOne(
      { _id: req._id, status: "OPEN" },
      { $set: { ...extra, status, outcome, handledBy: adminId, handledAt: now, updatedAt: now } },
    );
  if (res.modifiedCount === 0) throw new PrivacyError("This request has already been handled");
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: `data_request.${status === "REJECTED" ? "rejected" : req.type.toLowerCase()}`,
    targetType: "dataRequest",
    targetId: req._id!.toString(),
    organizationId: null,
    meta: auditMeta,
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Access
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Everything Morbin holds that is tied to this address. Secrets (token hashes,
 * signed QR payloads, password hashes) are left out: they're credentials, not
 * information about the person, and an export must not become a way in.
 */
export async function collectPersonalData(email: string) {
  const db = await getDb();
  const match = emailEq(email);
  const [orders, tickets, sessions, emails, refunds, invoices, user, waitlist, applications] = await Promise.all([
    db.collection<Order>("orders").find({ $or: [{ buyerEmail: match }, { "attendees.email": match }] }).toArray(),
    db.collection<Ticket>("tickets").find({ attendeeEmail: match }).toArray(),
    db.collection<CheckoutSession>("checkoutSessions").find({ "identity.email": match }).toArray(),
    db.collection<EmailRecord>("emailDeliveries").find({ recipient: match }).toArray(),
    db.collection<RefundCase>("refundCases").find({ "customer.email": match }).toArray(),
    db.collection<Invoice>("invoices").find({ "recipient.email": match }).toArray(),
    db.collection<User>("users").findOne({ email: match }),
    db.collection("waitlist").find({ email: match }).toArray(),
    db.collection("applications").find({ email: match }).toArray(),
  ]);
  const eventIds = [...new Set([...orders, ...tickets].map((o) => o.eventId))];
  const events = await db
    .collection("events")
    .find({ _id: { $in: eventIds.map((id) => toObjectId(id)).filter((x): x is ObjectId => !!x) } }, { projection: { title: 1, startsAt: 1, venue: 1 } })
    .toArray();
  const eventTitle = new Map(events.map((e) => [e._id.toString(), e.title as string]));

  return {
    email: normaliseEmail(email),
    generatedAt: new Date().toISOString(),
    account: user
      ? { name: user.name ?? null, email: user.email, signedUpAt: user.createdAt?.toISOString() ?? null, role: user.role ?? "USER" }
      : null,
    orders: orders.map((o) => ({
      id: o._id!.toString(),
      event: eventTitle.get(o.eventId) ?? o.eventId,
      status: o.status,
      buyer: o.buyerEmail.toLowerCase() === normaliseEmail(email) ? { name: o.buyerName, email: o.buyerEmail, phone: o.buyerPhone || null } : null,
      attendees: (o.attendees ?? []).filter((a) => a.email.toLowerCase() === normaliseEmail(email)),
      answers: (o.customFields ?? []).map((f) => ({ question: f.label, answer: f.value })),
      idsChecked: (o.lookupKeys ?? []).map((k) => k.key),
      items: o.items.map((i) => ({ ticket: i.name, quantity: i.quantity, pricePaise: i.unitPricePaise })),
      totalPaise: o.totalPaise,
      consentAt: o.consentAt?.toISOString() ?? null,
      noticeVersion: o.noticeVersion ?? null,
      createdAt: o.createdAt.toISOString(),
      paidAt: o.paidAt?.toISOString() ?? null,
    })),
    tickets: tickets.map((t) => ({
      code: t.code,
      event: eventTitle.get(t.eventId) ?? t.eventId,
      attendeeName: t.attendeeName,
      attendeeEmail: t.attendeeEmail,
      status: t.status,
      checkedInAt: t.checkedInAt?.toISOString() ?? null,
    })),
    checkoutSessions: sessions.map((s) => ({
      started: s.createdAt.toISOString(),
      status: s.status,
      answers: s.answers,
      details: s.customFields,
      verifiedVia: s.identity.via,
      consentAt: s.consentAt?.toISOString() ?? null,
    })),
    emailsSent: emails.map((e) => ({
      kind: e.kind,
      status: e.status,
      sentAt: e.sentAt?.toISOString() ?? null,
      event: e.meta?.eventTitle ?? null,
    })),
    refunds: refunds.map((r) => ({
      status: r.status,
      amountPaise: r.amountPaise,
      reason: r.reason,
      customer: r.customer,
      createdAt: r.createdAt.toISOString(),
    })),
    invoices: invoices.map((i) => ({ number: i.number, recipient: i.recipient, totalPaise: i.totalPaise, issuedAt: i.issuedAt.toISOString() })),
    waitlist: waitlist.map((w) => ({ email: w.email as string, joinedAt: (w.createdAt as Date | undefined)?.toISOString() ?? null })),
    organiserApplications: applications.map((a) => ({
      organisation: a.organizationName as string,
      contactName: a.contactName as string,
      phone: (a.phone as string | undefined) ?? null,
      status: a.status as string,
      submittedAt: (a.createdAt as Date).toISOString(),
    })),
  };
}

/** Access: build the export, store it privately, email a one-time 7-day link. */
export async function fulfilAccessRequest(id: string, adminId: string, note: string): Promise<void> {
  const req = await openRequest(id);
  if (req.type !== "ACCESS") throw new PrivacyError("Not an access request");
  const data = await collectPersonalData(req.email);
  const doc = await storeDocument({
    organizationId: null,
    kind: "DATA_EXPORT",
    fileName: `morbin-data-${req._id!.toString()}.json`,
    contentType: "application/json",
    body: Buffer.from(JSON.stringify(data, null, 2), "utf8"),
    uploadedBy: adminId,
  });
  const token = randomToken();
  const expires = new Date(Date.now() + DOWNLOAD_TTL_MS);
  await close(
    req,
    "DONE",
    note || "Your data export is ready.",
    adminId,
    { exportDocId: doc._id!.toString(), downloadTokenHash: hashToken(token), downloadExpiresAt: expires, downloadedAt: null },
    { orders: data.orders.length, tickets: data.tickets.length },
  );
  const db = await getDb();
  await queueEmail(db, req.email, "DATA_REQUEST_RESULT", {
    dataRequestType: "ACCESS",
    message: note || null,
    link: appUrl(`/privacy/request/download?token=${encodeURIComponent(token)}`),
  });
}

export type DownloadResult = { ok: true; fileName: string; body: Buffer } | { ok: false; reason: "invalid" | "expired" };

/**
 * The export, once. The token is the authentication (only the requester's
 * inbox has it); it is spent on first use and the file is deleted after it is
 * read, so nothing lingers.
 */
export async function downloadExport(raw: string): Promise<DownloadResult> {
  if (!raw || raw.length > 200) return { ok: false, reason: "invalid" };
  const db = await getDb();
  const req = await db
    .collection<DataRequest>("dataRequests")
    .findOneAndUpdate({ downloadTokenHash: hashToken(raw) }, { $set: { downloadTokenHash: null, downloadedAt: new Date() } }, { returnDocument: "before" });
  // An unknown token and a spent one look the same: the hash is cleared on use.
  if (!req) return { ok: false, reason: "invalid" };
  if (!req.downloadExpiresAt || req.downloadExpiresAt < new Date() || !req.exportDocId) {
    if (req.exportDocId) await deleteDocument(req.exportDocId);
    return { ok: false, reason: "expired" };
  }
  const doc = await getDocument(req.exportDocId);
  if (!doc) return { ok: false, reason: "expired" };
  const body = await readDocumentBody(doc);
  await deleteDocument(req.exportDocId);
  return { ok: true, fileName: doc.fileName, body };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Erasure
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AnonymiseResult {
  orders: number;
  tickets: number;
  checkoutSessions: number;
  emails: number;
  refundCases: number;
  waitlist: number;
  /** Ticket PDFs (they print the attendee's name) removed from the document store. */
  documents: number;
  /** Kept by law; the requester is told. */
  invoicesRetained: number;
  /** A user account that also runs an organisation or is an admin is not deleted here. */
  account: "none" | "deleted" | "kept_has_role";
}

/**
 * Anonymise everything personal held for `email`, in one transaction.
 *
 * Replaced: names, emails and phone numbers on orders, attendees, tickets,
 * refund cases and email deliveries; booking answers, checkout answers and the
 * dataset IDs checked. Kept: every amount, status and id, the ledger, payouts
 * and invoices (GST law, 8 years). Reused by the retention job.
 */
export async function anonymisePerson(email: string, opts: { session?: ClientSession } = {}): Promise<AnonymiseResult> {
  const run = async (session: ClientSession, db: Db): Promise<{ result: AnonymiseResult; pdfIds: string[] }> => {
    const match = emailEq(email);
    const now = new Date();
    const o = db.collection<Order>("orders");

    const buyerOrders = await o.find({ buyerEmail: match }, { session, projection: { ticketPdfDocId: 1 } }).toArray();
    const pdfIds = buyerOrders.map((x) => x.ticketPdfDocId).filter((x): x is string => !!x);
    const asBuyer = await o.updateMany(
      { buyerEmail: match },
      // A pipeline, so orders without lookup keys (null or absent) are left as they are.
      [
        {
          $set: {
            buyerName: ERASED_NAME,
            buyerEmail: ERASED_EMAIL,
            buyerPhone: "",
            customFields: { $literal: [] },
            lookupKeys: {
              $cond: [
                { $isArray: "$lookupKeys" },
                { $map: { input: "$lookupKeys", as: "k", in: { $mergeObjects: ["$$k", { key: "erased" }] } } },
                "$lookupKeys",
              ],
            },
            ticketPdfDocId: null,
            piiErasedAt: now,
          },
        },
      ],
      { session },
    );
    const asAttendee = await o.updateMany(
      { "attendees.email": match },
      { $set: { "attendees.$[a].name": ERASED_NAME, "attendees.$[a].email": ERASED_EMAIL, piiErasedAt: now } },
      { session, arrayFilters: [{ "a.email": match }] },
    );
    const tickets = await db
      .collection<Ticket>("tickets")
      .updateMany({ attendeeEmail: match }, { $set: { attendeeName: ERASED_NAME, attendeeEmail: ERASED_EMAIL, lookupKey: null } }, { session });
    const sessions = await db.collection<CheckoutSession>("checkoutSessions").updateMany(
      { "identity.email": match },
      {
        $set: {
          "identity.email": null,
          "identity.userId": null,
          answers: {},
          customFields: {},
          lookups: null,
          branch: null,
          updatedAt: now,
        },
      },
      { session },
    );
    const emails = await db
      .collection<EmailRecord>("emailDeliveries")
      .updateMany({ recipient: match }, { $set: { recipient: ERASED_EMAIL, meta: null } }, { session });
    const refunds = await db
      .collection<RefundCase>("refundCases")
      .updateMany({ "customer.email": match }, { $set: { customer: { name: ERASED_NAME, email: ERASED_EMAIL }, updatedAt: now } }, { session });
    const waitlist = await db.collection("waitlist").deleteMany({ email: match }, { session });
    const invoicesRetained = await db.collection<Invoice>("invoices").countDocuments({ "recipient.email": match }, { session });

    let account: AnonymiseResult["account"] = "none";
    const user = await db.collection<User>("users").findOne({ email: match }, { session });
    if (user) {
      const memberships = await db.collection("memberships").countDocuments({ userId: user._id!.toString() }, { session });
      if (user.role === "ADMIN" || memberships > 0) {
        account = "kept_has_role";
      } else {
        const uid = user._id!;
        await db.collection("accounts").deleteMany({ userId: { $in: [uid, uid.toString()] } } as never, { session });
        await db.collection("sessions").deleteMany({ userId: { $in: [uid, uid.toString()] } } as never, { session });
        await db.collection<User>("users").deleteOne({ _id: uid }, { session });
        account = "deleted";
      }
    }

    return {
      pdfIds,
      result: {
        orders: asBuyer.modifiedCount + asAttendee.modifiedCount,
        tickets: tickets.modifiedCount,
        checkoutSessions: sessions.modifiedCount,
        emails: emails.modifiedCount,
        refundCases: refunds.modifiedCount,
        waitlist: waitlist.deletedCount,
        documents: pdfIds.length,
        invoicesRetained,
        account,
      },
    };
  };

  const { result, pdfIds } = opts.session ? await run(opts.session, await getDb()) : await withTransaction(run);
  // Files live outside the database; removed once the transaction has committed.
  for (const id of pdfIds) await deleteDocument(id);
  return result;
}

export const INVOICE_RETENTION_NOTE =
  "Tax invoices issued to you are kept with your name and email for 8 years, as India's GST law requires; they are used for nothing else.";

/** Erasure: anonymise, then tell the requester what was kept and why. */
export async function fulfilErasureRequest(id: string, adminId: string, note: string): Promise<AnonymiseResult> {
  const req = await openRequest(id);
  if (req.type !== "ERASURE") throw new PrivacyError("Not an erasure request");
  const result = await anonymisePerson(req.email);
  const kept = result.invoicesRetained > 0 ? ` ${INVOICE_RETENTION_NOTE}` : "";
  const account =
    result.account === "kept_has_role"
      ? " Your Morbin sign-in account is kept because it is linked to an organisation; ask its owner to remove you, then write to us again."
      : "";
  const outcome = `${note ? `${note.trim()} ` : ""}We've erased your personal data from your bookings, tickets and emails.${kept}${account}`;
  // `close` records the outcome against the request, which keeps the address:
  // proof the request was answered, and the only place it remains.
  await close(req, "DONE", outcome, adminId, {}, { ...result });
  const db = await getDb();
  await queueEmail(db, req.email, "DATA_REQUEST_RESULT", { dataRequestType: "ERASURE", message: outcome, link: null });
  return result;
}

/** Correction (done by hand, e.g. a name typo) or any request that is answered with a message. */
export async function completeDataRequest(id: string, adminId: string, outcome: string): Promise<void> {
  const req = await openRequest(id);
  if (req.type === "ACCESS" || req.type === "ERASURE") {
    throw new PrivacyError("Use the export or erase action for this request");
  }
  if (outcome.trim().length < 5) throw new PrivacyError("Tell the requester what was changed.");
  await close(req, "DONE", outcome.trim(), adminId);
  const db = await getDb();
  await queueEmail(db, req.email, "DATA_REQUEST_RESULT", { dataRequestType: req.type, message: outcome.trim(), link: null });
}

export async function rejectDataRequest(id: string, adminId: string, reason: string): Promise<void> {
  const req = await openRequest(id);
  if (reason.trim().length < 5) throw new PrivacyError("Give the requester a reason.");
  await close(req, "REJECTED", reason.trim(), adminId);
  const db = await getDb();
  await queueEmail(db, req.email, "DATA_REQUEST_RESULT", { dataRequestType: req.type, message: reason.trim(), link: null, dataRequestRejected: true });
}

export const DATA_REQUEST_STATUSES: DataRequestStatus[] = ["OPEN", "DONE", "REJECTED"];
