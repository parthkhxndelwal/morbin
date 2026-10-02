import { createHash, randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import type { CheckoutSession, Order, Ticket } from "@/lib/types";

/**
 * Durable state for the checkout funnel.
 *
 * The funnel cannot live in component state: a buyer on the college-email branch
 * leaves the page to read their inbox and has to resume in the same browser, and
 * the server has to be able to prove to Razorpay that identity was verified.
 * This collection is that memory.
 *
 * Every lookup by handle is by *hash*, never by raw token, so a database dump
 * does not hand an attacker a live checkout or a working magic link.
 */

/** Cookie holding the resume token. httpOnly, so script cannot read it. */
export const CHECKOUT_COOKIE = "morbin_cs";

/** How long a drawer may be open before the server forgets it. */
export const SESSION_TTL_MS = 30 * 60 * 1000;
/** Emailed link lifetime. */
export const OTP_TTL_MS = 15 * 60 * 1000;
/** Resume cookie lifetime — must outlive the drawer it reopens. */
export const RESUME_TTL_MS = 2 * 60 * 60 * 1000;
/** Floor between re-sends, so the endpoint is not a mail cannon. */
export const RESEND_COOLDOWN_MS = 45 * 1000;
/** Brute-force attempts before the link is burned and must be re-requested. */
export const MAX_OTP_ATTEMPTS = 5;

/** Upper bound on a persisted seat count, well above any real order. */
const MAX_SESSION_QTY = 50;

/** URL-safe random token. 32 bytes ≈ 256 bits. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * sha256, hex. Fixed width, so a comparison never has to branch on length —
 * `timingSafeEqual` throws on a mismatch, which would itself leak length.
 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function sessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_MS);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reads and writes
 * ──────────────────────────────────────────────────────────────────────────── */

export async function createCheckoutSession(input: {
  eventId: string;
  flowVersion: number;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null };
}): Promise<CheckoutSession> {
  const db = await getDb();
  const now = new Date();
  const session: CheckoutSession = {
    publicId: randomToken(16),
    eventId: input.eventId,
    flowVersion: input.flowVersion,
    status: "IN_PROGRESS",
    answers: {},
    branch: null,
    identity: { method: "NONE", email: null, verifiedAt: null, via: null, userId: null },
    otpTokenHash: null,
    otpExpiresAt: null,
    otpAttempts: 0,
    resumeTokenHash: null,
    resumeTokenExpiresAt: null,
    customFields: {},
    quantity: {},
    orderId: null,
    utm: {
      source: input.utm?.source ?? null,
      medium: input.utm?.medium ?? null,
      campaign: input.utm?.campaign ?? null,
    },
    createdAt: now,
    updatedAt: now,
    expiresAt: sessionExpiry(now),
  };
  await db.collection<CheckoutSession>("checkoutSessions").insertOne(session);
  return session;
}

export async function getCheckoutSession(publicId: string): Promise<CheckoutSession | null> {
  if (!publicId) return null;
  const db = await getDb();
  const session = await db
    .collection<CheckoutSession>("checkoutSessions")
    .findOne({ publicId });
  if (!session) return null;
  // Expiry is computed on read, not by a background job: a stale session must be
  // inert the instant it lapses, not whenever a sweeper happens to run.
  if (session.status === "IN_PROGRESS" || session.status === "IDENTITY_VERIFIED") {
    if (session.expiresAt < new Date()) {
      await db
        .collection<CheckoutSession>("checkoutSessions")
        .updateOne({ _id: session._id }, { $set: { status: "EXPIRED", updatedAt: new Date() } });
      return { ...session, status: "EXPIRED" };
    }
  }
  return session;
}

/** Resolve a session from the raw resume cookie. */
export async function getSessionByResumeToken(raw: string | undefined | null): Promise<CheckoutSession | null> {
  if (!raw) return null;
  const db = await getDb();
  const session = await db
    .collection<CheckoutSession>("checkoutSessions")
    .findOne({ resumeTokenHash: hashToken(raw) });
  if (!session) return null;
  if (session.resumeTokenExpiresAt && session.resumeTokenExpiresAt < new Date()) return null;
  return getCheckoutSession(session.publicId);
}

/** Write an answer, keeping `branch` in step with the last branching question. */
export async function answerStep(
  publicId: string,
  stepId: string,
  value: string,
  branch: CheckoutSession["branch"],
): Promise<CheckoutSession | null> {
  const db = await getDb();
  await db.collection<CheckoutSession>("checkoutSessions").updateOne(
    { publicId, status: { $in: ["IN_PROGRESS", "IDENTITY_VERIFIED"] } },
    {
      $set: {
        [`answers.${stepId}`]: value,
        branch,
        updatedAt: new Date(),
      },
    },
  );
  return getCheckoutSession(publicId);
}

export async function saveCustomFields(
  publicId: string,
  fields: Record<string, string>,
): Promise<void> {
  const db = await getDb();
  await db
    .collection<CheckoutSession>("checkoutSessions")
    .updateOne({ publicId }, { $set: { customFields: fields, updatedAt: new Date() } });
}

/**
 * Record the buyer's seat selection.
 *
 * Persisted rather than carried in the order request so that
 * `POST /api/checkout/order` can re-derive everything from the session. The
 * numbers are still not trusted — the order route re-checks each one against the
 * freshly resolved offer — but persisting them means a refresh or a second tab
 * does not lose the cart, and the payload stays a bare "go".
 */
export async function saveQuantity(
  publicId: string,
  quantity: Record<string, number>,
): Promise<void> {
  const db = await getDb();
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(quantity)) {
    if (Number.isInteger(v) && v > 0 && v <= MAX_SESSION_QTY) clean[k] = v;
  }
  await db
    .collection<CheckoutSession>("checkoutSessions")
    .updateOne({ publicId }, { $set: { quantity: clean, updatedAt: new Date() } });
}

export async function setOrder(publicId: string, orderId: string): Promise<void> {
  const db = await getDb();
  await db
    .collection<CheckoutSession>("checkoutSessions")
    .updateOne(
      { publicId },
      { $set: { orderId, status: "COMPLETED", updatedAt: new Date() } },
    );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Magic link
 * ──────────────────────────────────────────────────────────────────────────── */

/** Mint a fresh emailed token, superseding any previous one. */
export async function issueOtp(
  publicId: string,
  email: string,
): Promise<{ raw: string; resendAfter: Date }> {
  const db = await getDb();
  const raw = randomToken();
  const now = new Date();
  const resendAfter = new Date(now.getTime() + RESEND_COOLDOWN_MS);
  await db.collection<CheckoutSession>("checkoutSessions").updateOne(
    { publicId },
    {
      $set: {
        otpTokenHash: hashToken(raw),
        otpExpiresAt: new Date(now.getTime() + OTP_TTL_MS),
        otpAttempts: 0,
        resendAfter,
        "identity.method": "EMAIL_OTP",
        "identity.email": email,
        updatedAt: now,
      },
    },
  );
  return { raw, resendAfter };
}

/** Remaining wait before another link may be sent, in seconds. */
export async function resendWaitSeconds(publicId: string): Promise<number> {
  const db = await getDb();
  const session = await db
    .collection<CheckoutSession>("checkoutSessions")
    .findOne({ publicId }, { projection: { resendAfter: 1 } });
  if (!session?.resendAfter) return 0;
  return Math.max(0, Math.ceil((session.resendAfter.getTime() - Date.now()) / 1000));
}

export type OtpResult =
  | { ok: true; session: CheckoutSession; email: string }
  | { ok: false; reason: "invalid" | "expired" | "attempts" };

/**
 * Burn a magic link.
 *
 * Single-use by construction: the matching update requires `otpTokenHash` to
 * still equal this token's hash, so two simultaneous clicks cannot both succeed
 * — the loser matches zero documents and is told the link is invalid.
 */
export async function consumeOtp(raw: string): Promise<OtpResult> {
  if (!raw) return { ok: false, reason: "invalid" };
  const db = await getDb();
  const tokenHash = hashToken(raw);
  const now = new Date();

  const session = await db
    .collection<CheckoutSession>("checkoutSessions")
    .findOne({ otpTokenHash: tokenHash });
  if (!session) return { ok: false, reason: "invalid" };

  if ((session.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) {
    await db
      .collection<CheckoutSession>("checkoutSessions")
      .updateOne({ _id: session._id }, { $set: { otpTokenHash: null, updatedAt: now } });
    return { ok: false, reason: "attempts" };
  }
  if (session.otpExpiresAt && session.otpExpiresAt < now) return { ok: false, reason: "expired" };

  const email = session.identity.email?.toLowerCase();
  if (!email) return { ok: false, reason: "invalid" };

  const result = await db.collection<CheckoutSession>("checkoutSessions").findOneAndUpdate(
    { _id: session._id, otpTokenHash: tokenHash },
    {
      $set: {
        otpTokenHash: null,
        status: "IDENTITY_VERIFIED",
        "identity.verifiedAt": now,
        "identity.via": "EMAIL_OTP",
        updatedAt: now,
      },
      $inc: { otpAttempts: 1 },
    },
    { returnDocument: "after" },
  );
  if (!result) return { ok: false, reason: "invalid" };
  return { ok: true, session: result as CheckoutSession, email };
}

/** Record a failed attempt against a live token so guessing is bounded. */
export async function recordFailedOtpAttempt(raw: string): Promise<void> {
  if (!raw) return;
  const db = await getDb();
  await db
    .collection<CheckoutSession>("checkoutSessions")
    .updateOne(
      { otpTokenHash: hashToken(raw) },
      { $inc: { otpAttempts: 1 }, $set: { updatedAt: new Date() } },
    );
}

/** Mint the resume token that reopens the drawer after verification. */
export async function setResumeToken(
  publicId: string,
  identity: Partial<CheckoutSession["identity"]>,
): Promise<string> {
  const db = await getDb();
  const raw = randomToken();
  const now = new Date();
  const set: Record<string, unknown> = {
    resumeTokenHash: hashToken(raw),
    resumeTokenExpiresAt: new Date(now.getTime() + RESUME_TTL_MS),
    updatedAt: now,
  };
  for (const [k, v] of Object.entries(identity)) {
    set[`identity.${k}`] = v;
  }
  await db.collection<CheckoutSession>("checkoutSessions").updateOne({ publicId }, { $set: set });
  return raw;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Seat accounting
 *
 * Both counts read `tickets`, never `orders`, because `tickets` is where
 * `attendeeEmail` and `flowBranch` are denormalised. That keeps "how many has
 * this person taken under this audience" a single-collection, index-served count
 * — a join against `orders` would be correct but would need an aggregation
 * pipeline on the hot path of every drawer open.
 * ──────────────────────────────────────────────────────────────────────────── */

const LIVE: Ticket["status"][] = ["VALID", "USED"];

/** Seats THIS identity already holds under this branch. */
export async function claimedUnitsFor(
  eventId: string,
  email: string,
  branch: string | null,
): Promise<number> {
  const db = await getDb();
  return db.collection<Ticket>("tickets").countDocuments({
    eventId,
    attendeeEmail: email.toLowerCase(),
    flowBranch: branch,
    status: { $in: LIVE },
  });
}

/** Seats EVERYONE has taken under this branch, for the branch's own allowance. */
export async function branchClaimedUnitsFor(
  eventId: string,
  branch: string | null,
): Promise<number> {
  const db = await getDb();
  return db.collection<Ticket>("tickets").countDocuments({
    eventId,
    flowBranch: branch,
    status: { $in: LIVE },
  });
}

/** Distinct audiences an event has actually sold to, for the insights view. */
export async function branchBreakdown(
  eventId: string,
): Promise<{ branch: string | null; tickets: number; revenue: number }[]> {
  const db = await getDb();
  // Revenue is attributed from orders; seat counts from the denormalised ticket
  // field, so both numbers describe the same population.
  const rows = await db
    .collection<Order>("orders")
    .aggregate<{ _id: string | null; revenue: number }>([
      { $match: { eventId, status: { $in: ["PAID", "REFUNDED"] } } },
      { $group: { _id: "$flowBranch", revenue: { $sum: "$totalPaise" } } },
      { $sort: { revenue: -1 } },
    ])
    .toArray();
  return Promise.all(
    rows.map(async (r) => ({
      branch: r._id,
      tickets: await branchClaimedUnitsFor(eventId, r._id),
      revenue: r.revenue,
    })),
  );
}
