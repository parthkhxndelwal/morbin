import "server-only";

import type { ClientSession, Db } from "mongodb";
import { getDb, toObjectId } from "@/lib/db";
import { normaliseKey } from "@/lib/dataset-rules";
import { deriveEmail, lookupValue, templateErrors } from "@/lib/template-rules";
import { TxAbort } from "@/lib/tx";
import type { Dataset, DatasetRow, FlowLookup, FlowStep, Order } from "@/lib/types";

/**
 * Lookup questions: "enter your roll number" checked against an
 * organisation's dataset. Everything here runs on the server; the buyer only
 * ever learns found / not found / already used — never any row content.
 *
 * One ticket per row is enforced by a unique claim document
 * `{ datasetId, key, eventId }` inserted in the same transaction as the seat
 * hold (`createHeldOrder`), so two buyers racing the same roll number can't
 * both win. A released (expired / failed) order gives its claim back.
 */

export interface DatasetClaim {
  datasetId: string;
  key: string;
  eventId: string;
  orderId: string;
  createdAt: Date;
}

export type LookupMatch =
  | { ok: true; key: string; derivedEmail: string | null }
  | { ok: false; reason: "not_found" | "taken" | "no_email" };

async function datasetFor(organizationId: string, datasetId: string): Promise<Dataset | null> {
  const _id = toObjectId(datasetId);
  if (!_id) return null;
  const db = await getDb();
  return db.collection<Dataset>("datasets").findOne({ _id, organizationId });
}

/** Is this row already used for a ticket to this event? */
export async function rowClaimed(datasetId: string, key: string, eventId: string): Promise<boolean> {
  const db = await getDb();
  return !!(await db.collection<DatasetClaim>("datasetClaims").findOne({ datasetId, key, eventId }, { projection: { _id: 1 } }));
}

/**
 * Check a buyer's answer against the step's dataset. The dataset must belong to
 * the event's organisation; a key matches case- and whitespace-insensitively.
 */
export async function matchLookup(
  organizationId: string,
  eventId: string,
  lookup: FlowLookup,
  rawValue: string,
): Promise<LookupMatch> {
  const value = rawValue.trim();
  const key = normaliseKey(value);
  const dataset = key ? await datasetFor(organizationId, lookup.datasetId) : null;
  // The dataset's key column is the only indexed one; matching any other column
  // must still be exact on the normalised form.
  if (!dataset) return { ok: false, reason: "not_found" };
  const db = await getDb();
  let row: DatasetRow | null;
  if (lookup.matchColumn === dataset.keyColumn) {
    row = await db.collection<DatasetRow>("datasetRows").findOne({ datasetId: lookup.datasetId, keyNormalised: key });
  } else {
    // Non-key columns: scan this dataset's rows for a normalised match. Rare in
    // practice (the key is what IDs are), and bounded by the dataset's size.
    row = null;
    const cursor = db
      .collection<DatasetRow>("datasetRows")
      .find({ datasetId: lookup.datasetId }, { projection: { values: 1, keyNormalised: 1 } });
    for await (const r of cursor) {
      if (normaliseKey(r.values[lookup.matchColumn] ?? "") === key) {
        row = r;
        break;
      }
    }
  }
  if (!row) return { ok: false, reason: "not_found" };
  if (lookup.oneTicketPerRow && (await rowClaimed(lookup.datasetId, row.keyNormalised, eventId))) {
    return { ok: false, reason: "taken" };
  }
  let derivedEmail: string | null = null;
  if (lookup.emailTemplate) {
    derivedEmail = deriveEmail(lookup.emailTemplate, lookupValue(row.values[lookup.matchColumn] ?? value), row.values);
    if (!derivedEmail) return { ok: false, reason: "no_email" };
  }
  return { ok: true, key: row.keyNormalised, derivedEmail };
}

/**
 * Save-time check of every LOOKUP step: the dataset belongs to the
 * organisation, the column exists, the template is valid. Returns a message
 * naming the step and the part that's wrong, or null.
 */
export async function lookupProblems(organizationId: string, steps: FlowStep[]): Promise<string | null> {
  for (const step of steps) {
    if (step.kind !== "LOOKUP") continue;
    const name = `“${step.title || "Lookup question"}”`;
    const l = step.lookup;
    if (!l?.datasetId) return `${name} needs a dataset to check against.`;
    const dataset = await datasetFor(organizationId, l.datasetId);
    if (!dataset) return `${name} uses a dataset that no longer exists.`;
    const keys = dataset.columns.map((c) => c.key);
    if (!keys.includes(l.matchColumn)) return `${name} checks a column the dataset doesn't have.`;
    if (l.emailTemplate) {
      const errors = templateErrors(l.emailTemplate, keys);
      if (errors.length) return `${name}: ${errors[0]}.`;
    } else if (l.identityMethod === "EMAIL_OTP") {
      return `${name} verifies an email but has no email template.`;
    }
  }
  return null;
}

/** For the builder's "Try it as a buyer": does a sample value match, and what address would it give? */
export async function lookupPreview(
  organizationId: string,
  eventId: string,
  lookup: FlowLookup,
  value: string,
): Promise<{ found: boolean; taken: boolean; email: string | null; templateError: string | null }> {
  const dataset = await datasetFor(organizationId, lookup.datasetId);
  const templateError =
    lookup.emailTemplate && dataset ? (templateErrors(lookup.emailTemplate, dataset.columns.map((c) => c.key))[0] ?? null) : null;
  if (templateError) return { found: false, taken: false, email: null, templateError };
  const m = await matchLookup(organizationId, eventId, lookup, value);
  if (m.ok) return { found: true, taken: false, email: m.derivedEmail, templateError: null };
  return { found: m.reason !== "not_found", taken: m.reason === "taken", email: null, templateError: null };
}

/**
 * Take the one-ticket claims an order carries, inside the order's
 * transaction. A duplicate key means someone else holds the row: the whole
 * transaction (seat hold included) aborts. A concurrent insert of the same key
 * surfaces as a write conflict first, which `withTransaction` retries and then
 * sees as the duplicate.
 */
export async function insertClaims(db: Db, session: ClientSession, order: Order): Promise<void> {
  const claims = (order.lookupKeys ?? []).filter((k) => k.claim);
  if (claims.length === 0) return;
  const now = new Date();
  try {
    await db.collection<DatasetClaim>("datasetClaims").insertMany(
      claims.map((k) => ({ datasetId: k.datasetId, key: k.key, eventId: order.eventId, orderId: order._id!.toString(), createdAt: now })),
      { session },
    );
  } catch (error) {
    if ((error as { code?: number }).code === 11000) throw new TxAbort("This ID already has a ticket.", 409);
    throw error;
  }
}

/** Give an order's claims back (the order expired or failed), inside its transaction. */
export async function releaseClaims(db: Db, session: ClientSession, orderId: string): Promise<void> {
  await db.collection<DatasetClaim>("datasetClaims").deleteMany({ orderId }, { session });
}
