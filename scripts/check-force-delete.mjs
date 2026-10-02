/**
 * End-to-end check for the force-delete admin route, against a running dev
 * server and a real MongoDB.
 *
 * Why this exists and why it is a script rather than a unit test:
 *
 *   - `lib/admin.ts` pulls in `@/lib/auth`, which pulls in `next-auth` and
 *     `next/server`. None of that loads outside the Next runtime, so the cascade
 *     cannot be exercised by importing the function — only by calling the route.
 *   - the cascade is irreversible and its failure mode is silent data loss, so
 *     "it compiles" is not an acceptable level of evidence.
 *
 * The script mints its own throwaway admin account (role ADMIN, verified email,
 * random password), drives the real HTTP route, asserts on the resulting
 * database state, then deletes every document it created including the admin.
 *
 * Refuses to run unless MORBIN_DB looks like a test database, because it writes.
 *
 *   node scripts/check-force-delete.mjs
 */
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { MongoClient, ObjectId } from "mongodb";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const DB_NAME = process.env.MORBIN_DB ?? "";
if (!/test/i.test(DB_NAME)) {
  console.error(`Refusing to run: MORBIN_DB is "${DB_NAME}", which does not look like a test database.`);
  process.exit(1);
}

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}${detail ? `  ${detail}` : ""}`);
  }
};

const tag = `forcecheck-${randomBytes(4).toString("hex")}`;
const password = `Chk${randomBytes(9).toString("base64url")}9`;
const adminEmail = `${tag}@example.com`;

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(DB_NAME);
const now = new Date();

/* ------------------------------------------------------------------ fixtures */

const adminId = new ObjectId();
await db.collection("users").insertOne({
  _id: adminId,
  email: adminEmail,
  name: "Force Delete Check",
  emailVerified: now,
  role: "ADMIN",
  passwordHash: await bcrypt.hash(password, 10),
  createdAt: now,
  updatedAt: now,
});

/** An org with one of everything the cascade must reach. */
async function makeOrg(label, { orderStatus = "EXPIRED", withMember = true } = {}) {
  const orgId = new ObjectId();
  const eventId = new ObjectId();
  const orderId = orderStatus ? new ObjectId() : null;

  await db.collection("organizations").insertOne({
    _id: orgId,
    name: `ForceCheck ${label}`,
    slug: `${tag}-${label.toLowerCase()}`,
    ownerId: new ObjectId().toString(),
    type: "EVENT",
    status: "ACTIVE",
    onboardingStatus: "ACTIVE",
    paymentAccountStatus: "VERIFIED",
    payoutsEnabled: true,
    chargesEnabled: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.collection("events").insertOne({
    _id: eventId,
    organizationId: orgId.toString(),
    title: `Event ${label}`,
    slug: `${tag}-${label.toLowerCase()}-event`,
    description: "",
    venue: "",
    timezone: "Asia/Kolkata",
    startsAt: now,
    endsAt: now,
    status: "PUBLISHED",
    createdAt: now,
    updatedAt: now,
  });
  if (withMember)
    await db.collection("memberships").insertOne({
      organizationId: orgId.toString(),
      userId: new ObjectId().toString(),
      role: "OWNER",
      createdAt: now,
    });
  if (orderId)
    await db.collection("orders").insertOne({
      _id: orderId,
      eventId: eventId.toString(),
      organizationId: orgId.toString(),
      buyerName: "Buyer",
      buyerEmail: `${label.toLowerCase()}@example.com`,
      buyerPhone: "",
      items: [],
      subtotalPaise: 5000,
      platformFeePaise: 250,
      organizerAmountPaise: 4750,
      totalPaise: 5000,
      currency: "INR",
      razorpayOrderId: `order_${tag}_${label.toLowerCase()}`,
      status: orderStatus,
      createdAt: now,
      ...(orderStatus === "PAID" ? { razorpayPaymentId: `pay_${tag}` } : {}),
    });

  return { orgId, eventId, orderId };
}

const terminal = await makeOrg("Terminal", { orderStatus: "EXPIRED" });
const inFlight = await makeOrg("Inflight", { orderStatus: "CREATED" });
const captured = await makeOrg("Captured", { orderStatus: "PAID" });
// Nothing attached at all, so the *plain* delete path should accept it — this
// is the case that has no orders AND no members.
const bare = await makeOrg("Bare", { orderStatus: null, withMember: false });
// A member but no orders: the other half of the plain-delete refusal.
const memberOnly = await makeOrg("Memberonly", { orderStatus: null });

/**
 * Cleanup runs from `finally`, not at the end of the happy path.
 *
 * An earlier version of this script deleted its fixtures only on success, so any
 * failing assertion left a phantom admin account and a handful of organizations
 * behind in the database. That is exactly the kind of test that makes a mess of
 * the thing it is meant to protect, so cleanup is now unconditional and also
 * runs on an unhandled rejection or Ctrl-C.
 */
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    await db.collection("users").deleteOne({ _id: adminId });
    await db.collection("memberships").deleteMany({ organizationId: { $in: orgIds } });
    await db.collection("orders").deleteMany({ organizationId: { $in: orgIds } });
    await db.collection("events").deleteMany({ organizationId: { $in: orgIds } });
    await db.collection("organizations").deleteMany({ slug: orgRe });
    await db.collection("events").deleteMany({ slug: orgRe });
    await db.collection("orders").deleteMany({ razorpayOrderId: { $regex: `^order_${tag}` } });
    await db.collection("users").deleteMany({ email: { $regex: `^${tag}@` } });
    console.log(`\ncleaned up every ${tag} fixture`);
  } catch (err) {
    console.error(`\nCLEANUP FAILED — manual removal needed for ${tag}:`, err.message);
    process.exitCode = 1;
  }
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => void cleanup().then(() => process.exit(1)));

const orgIds = [terminal, inFlight, captured, bare, memberOnly].map((o) => o.orgId.toString());
const orgRe = new RegExp(`^${tag}`);

// Everything from here to the end runs under try/finally so the fixtures and the
// throwaway admin are removed even if an assertion throws.
try {
/* --------------------------------------------------------------------- auth */

console.log(`\n— signing in as a throwaway admin (${DB_NAME}) —`);

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
function absorb(res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
absorb(csrfRes);
const { csrfToken } = await csrfRes.json();
check("got a CSRF token", typeof csrfToken === "string" && csrfToken.length > 0);

const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookieHeader() },
  body: new URLSearchParams({ csrfToken, email: adminEmail, password }),
  redirect: "manual",
});
absorb(loginRes);
const loggedIn = [...jar.keys()].some((k) => k.includes("session-token"));
check("signed in and received a session cookie", loggedIn, `status ${loginRes.status}`);

/* -------------------------------------------------------------------- tests */

const del = async (id, force) => {
  const res = await fetch(`${BASE}/api/admin/organizations/${id}${force ? "?force=1" : ""}`, {
    method: "DELETE",
    headers: { Cookie: cookieHeader() },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

console.log("\n— unauthorized callers get nowhere —");
const anon = await fetch(`${BASE}/api/admin/organizations/${terminal.orgId}?force=1`, {
  method: "DELETE",
});
check("anonymous force delete is refused", anon.status === 401, `status ${anon.status}`);

console.log("\n— plain delete still refuses when there is history —");
const plain = await del(terminal.orgId, false);
check("plain delete refused with 409", plain.status === 409, `status ${plain.status}`);
check("it suggests suspending", /Suspend it instead/.test(plain.body.error ?? ""), plain.body.error);
check(
  "and the org is still there",
  (await db.collection("organizations").findOne({ _id: terminal.orgId })) !== null,
);

console.log("\n— force delete cascades —");
const forced = await del(terminal.orgId, true);
check("force delete succeeded", forced.status === 200, JSON.stringify(forced.body));
check("it reported the order count", forced.body.counts?.orders === 1, JSON.stringify(forced.body.counts));
check("it reported the event count", forced.body.counts?.events === 1);
check("it reported the membership count", forced.body.counts?.memberships === 1);
check("organization document is gone", (await db.collection("organizations").findOne({ _id: terminal.orgId })) === null);
check("event is gone", (await db.collection("events").findOne({ _id: terminal.eventId })) === null);
check(
  "order is gone",
  (await db.collection("orders").findOne({ _id: terminal.orderId })) === null,
);
check(
  "membership is gone",
  (await db.collection("memberships").findOne({ organizationId: terminal.orgId.toString() })) === null,
);

console.log("\n— a CREATED order blocks the force delete —");
const f1 = await del(inFlight.orgId, true);
check("refused with 409", f1.status === 409, `status ${f1.status}`);
check("message names the checkout hold", /checkout hold/.test(f1.body.error ?? ""), f1.body.error);
check(
  "the in-flight order still exists",
  (await db.collection("orders").findOne({ _id: inFlight.orderId })) !== null,
);

console.log("\n— an unrefunded captured payment blocks the force delete —");
const f2 = await del(captured.orgId, true);
check("refused with 409", f2.status === 409, `status ${f2.status}`);
check("message shows the amount", /₹50\.00/.test(f2.body.error ?? ""), f2.body.error);
check("message says refund first", /Refund them first/.test(f2.body.error ?? ""), f2.body.error);
check(
  "the paid order still exists",
  (await db.collection("orders").findOne({ _id: captured.orderId })) !== null,
);

console.log("\n— an org with nothing attached deletes either way —");
const plainEmpty = await del(bare.orgId, false);
check("plain delete succeeds", plainEmpty.status === 200, JSON.stringify(plainEmpty.body));
check("and the document is gone", (await db.collection("organizations").findOne({ _id: bare.orgId })) === null);

console.log("\n— members alone are still enough to block a plain delete —");
const memberRes = await del(memberOnly.orgId, false);
check("refused with 409", memberRes.status === 409, `status ${memberRes.status}`);
check("message counts the member", /still has 1 member/.test(memberRes.body.error ?? ""), memberRes.body.error);

console.log("\n— deleting a nonexistent org is a 404, not a crash —");
const missing = await del(new ObjectId().toString(), true);
check("returns 404", missing.status === 404, `status ${missing.status}`);

} finally {
  await cleanup();
  await client.close();
}

console.log(
  failures === 0 ? "\nall force-delete end-to-end checks passed" : `\n${failures} check(s) FAILED`,
);
process.exitCode = failures === 0 ? 0 : 1;