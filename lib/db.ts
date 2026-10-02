import { MongoClient, ObjectId, type Db } from "mongodb";

/**
 * Parse a stored id string into an ObjectId, or null when it is malformed.
 *
 * Collections store `_id` as an ObjectId but reference it from other documents
 * as a string, so this conversion sits on nearly every read path. Use
 * `toObjectId` where a bad id is data corruption to be tolerated; throw
 * `AdminError` at the boundary where a bad id is a client error.
 */
export function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

/** As `toObjectId`, but for a list — unusable ids are skipped, not fatal. */
export function safeObjectIds(ids: readonly string[]): ObjectId[] {
  const out: ObjectId[] = [];
  for (const id of ids) {
    const oid = toObjectId(id);
    if (oid) out.push(oid);
  }
  return out;
}

const uri = process.env.MONGODB_URI ?? "";
const dbName = process.env.MORBIN_DB ?? "morbin";

declare global {
  var __morbin_mongo: Promise<MongoClient> | undefined;
}

function createClient(): Promise<MongoClient> {
  if (!uri) return Promise.reject(new Error("MONGODB_URI is not set"));
  const client = new MongoClient(uri);
  return client.connect();
}

/** Shared client promise (Auth.js MongoDB adapter uses this too). */
export function getClientPromise(): Promise<MongoClient> {
  if (!globalThis.__morbin_mongo) {
    globalThis.__morbin_mongo = createClient();
  }
  return globalThis.__morbin_mongo;
}

export function getDbName(): string {
  return dbName;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(dbName);
}

/** Create unique indexes. Call explicitly (e.g. post-deploy script), never at import. */
export async function ensureIndexes(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    // Authorization reads every admin request by role; keep it indexed.
    db.collection("users").createIndex({ role: 1 }),
    db.collection("organizations").createIndex({ slug: 1 }, { unique: true }),
    db.collection("organizations").createIndex({ ownerId: 1 }),
    db.collection("memberships").createIndex(
      { organizationId: 1, userId: 1 },
      { unique: true },
    ),
    db.collection("events").createIndex({ organizationId: 1, slug: 1 }, { unique: true }),
    // Public event pages are looked up by slug alone, so the slug is globally
    // unique. This index does double duty: it enforces that, and it is the only
    // index that can serve the public event page's slug lookup — without it every event
    // page view is a collection scan.
    db.collection("events").createIndex({ slug: 1 }, { unique: true }),
    db.collection("ticketTypes").createIndex({ eventId: 1 }),
    db.collection("orders").createIndex({ razorpayOrderId: 1 }, { unique: true }),
    db.collection("orders").createIndex({ razorpayPaymentId: 1 }, { sparse: true }),
    db.collection("orders").createIndex({ eventId: 1 }),
    // Per-audience reporting (students vs outsiders) and per-branch cap counts.
    db.collection("orders").createIndex({ eventId: 1, flowBranch: 1, status: 1 }),
    db.collection("tickets").createIndex({ code: 1 }, { unique: true }),
    db.collection("tickets").createIndex({ orderId: 1 }),
    db.collection("tickets").createIndex({ attendeeEmail: 1 }),
    db.collection("tickets").createIndex({ eventId: 1, status: 1 }),
    // "How many seats has this verified email already taken under this audience?"
    // is answered entirely from `tickets` so it stays a single-collection count.
    db.collection("tickets").createIndex({
      eventId: 1,
      attendeeEmail: 1,
      flowBranch: 1,
      status: 1,
    }),
    db.collection("orders").createIndex({ status: 1, createdAt: 1 }),
    db.collection("razorpayWebhooks").createIndex({ providerEventId: 1 }, { unique: true }),
    db.collection("emailDeliveries").createIndex({ status: 1 }),
    db.collection("waitlist").createIndex({ email: 1 }, { unique: true }),

    // Checkout flow
    db.collection("checkoutFlows").createIndex({ eventId: 1, version: 1 }, { unique: true }),
    db.collection("checkoutFlows").createIndex({ eventId: 1, status: 1 }),
    db.collection("eventBranding").createIndex({ eventId: 1 }, { unique: true }),
    // publicId is the unguessable handle in checkout URLs; the hashed email
    // token is looked up on every magic-link click, and both are unique so a
    // collision fails loudly instead of resuming the wrong buyer.
    db.collection("checkoutSessions").createIndex({ publicId: 1 }, { unique: true }),
    // `partialFilterExpression` rather than `sparse`: a sparse index only skips
    // *absent* fields, and these are explicitly set to null on a fresh session.
    // Every open drawer would then collide on `{ otpTokenHash: null }`. This
    // filter indexes only real strings, so unset and null are both ignored.
    db.collection("checkoutSessions").createIndex(
      { otpTokenHash: 1 },
      { unique: true, partialFilterExpression: { otpTokenHash: { $type: "string" } } },
    ),
    db.collection("checkoutSessions").createIndex(
      { resumeTokenHash: 1 },
      { unique: true, partialFilterExpression: { resumeTokenHash: { $type: "string" } } },
    ),
    db.collection("checkoutSessions").createIndex({ eventId: 1, status: 1 }),
    db.collection("checkoutSessions").createIndex({ expiresAt: 1 }),

    // Money
    db.collection("ledgerEntries").createIndex({ key: 1 }, { unique: true }),
    db.collection("ledgerEntries").createIndex({ organizationId: 1, payoutId: 1, createdAt: 1 }),
    db.collection("ledgerEntries").createIndex({ payoutId: 1 }),
    db.collection("payouts").createIndex({ organizationId: 1, status: 1, createdAt: -1 }),
    db.collection("payouts").createIndex({ status: 1, createdAt: -1 }),
    db.collection("payoutMessages").createIndex({ payoutId: 1, createdAt: 1 }),
    // One bank account per organisation, enforced by the index so two
    // concurrent saves can't leave a second row behind.
    db.collection("payoutAccounts").createIndex({ organizationId: 1 }, { unique: true }),
    // Team invites: accepted by token hash; one live invite per address per org.
    db.collection("teamInvites").createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection("teamInvites").createIndex(
      { organizationId: 1, email: 1 },
      { unique: true, partialFilterExpression: { status: "PENDING" } },
    ),
    db.collection("teamInvites").createIndex({ organizationId: 1, status: 1, createdAt: -1 }),
    db.collection("accountSetupTokens").createIndex({ tokenHash: 1 }, { unique: true }),
    db.collection("accountSetupTokens").createIndex({ userId: 1 }, { unique: true }),
    db.collection("feeChanges").createIndex({ organizationId: 1, at: -1 }),
    db.collection("datasets").createIndex({ organizationId: 1, name: 1 }),
    db.collection("datasetRows").createIndex({ datasetId: 1, keyNormalised: 1 }, { unique: true }),
    db.collection("datasetRows").createIndex({ organizationId: 1 }),
    // One ticket per dataset row per event (lookup questions); see lib/lookups.
    db.collection("datasetClaims").createIndex({ datasetId: 1, key: 1, eventId: 1 }, { unique: true }),
    db.collection("datasetClaims").createIndex({ orderId: 1 }),
    // Data requests (DPDP): find everything held for one address, and the queue.
    db.collection("orders").createIndex({ buyerEmail: 1 }),
    db.collection("orders").createIndex({ "attendees.email": 1 }),
    db.collection("checkoutSessions").createIndex({ "identity.email": 1 }),
    db.collection("emailDeliveries").createIndex({ recipient: 1 }),
    db.collection("refundCases").createIndex({ "customer.email": 1 }),
    db.collection("dataRequests").createIndex({ status: 1, dueAt: 1 }),
    db.collection("dataRequests").createIndex({ tokenHash: 1 }, { unique: true, partialFilterExpression: { tokenHash: { $type: "string" } } }),
    db.collection("dataRequests").createIndex(
      { downloadTokenHash: 1 },
      { unique: true, partialFilterExpression: { downloadTokenHash: { $type: "string" } } },
    ),
    db.collection("rateLimits").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection("invoices").createIndex({ number: 1 }, { unique: true }),
    db.collection("invoices").createIndex({ orderId: 1, kind: 1 }, { unique: true }),
    db.collection("emailDeliveries").createIndex(
      { kind: 1, orderId: 1 },
      { unique: true, partialFilterExpression: { kind: "TICKET_PDF" } },
    ),
    db.collection("applications").createIndex({ status: 1, createdAt: -1 }),
    db.collection("applications").createIndex(
      { email: 1 },
      { unique: true, partialFilterExpression: { status: { $in: ["NEW", "INFO_REQUESTED"] } } },
    ),
    db.collection("refundCases").createIndex({ organizationId: 1, status: 1, createdAt: -1 }),
    db.collection("refundCases").createIndex({ status: 1, createdAt: -1 }),
    db.collection("refundCases").createIndex({ orderId: 1 }),
    db.collection("refundCases").createIndex({ razorpayRefundId: 1 }, { sparse: true }),
    db.collection("tickets").createIndex({ refundCaseId: 1 }, { sparse: true }),
    db.collection("orders").createIndex({ organizationId: 1, status: 1, createdAt: -1 }),
    db.collection("orders").createIndex({ organizationId: 1, paidAt: 1 }),

    // Platform
    db.collection("documents").createIndex({ organizationId: 1, kind: 1 }),
    db.collection("auditLogs").createIndex({ at: -1 }),
    db.collection("auditLogs").createIndex({ organizationId: 1, at: -1 }),
    db.collection("notifications").createIndex({ audience: 1, organizationId: 1, readAt: 1, createdAt: -1 }),
    db.collection("emailDeliveries").createIndex({ status: 1, nextAttemptAt: 1 }),
    db.collection("emailDeliveries").createIndex({ kind: 1, ticketId: 1 }),
  ]);
}
