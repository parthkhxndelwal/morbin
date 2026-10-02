/**
 * Dev only: an organisation owner you can sign in as, for exercising the
 * dashboard locally.
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/seed-dev-owner.ts
 *
 * Creates (idempotently) the org "Morbin Dev Test Org" and the verified user
 * DEV_OWNER_EMAIL (default owner@morbin.test) as its OWNER, with the password
 * from DEV_OWNER_PASSWORD, plus member@morbin.test as a MEMBER with the same
 * password, for checking what a member can and can't see. Refuses to run against a database whose name does
 * not contain "test" or "dev", so it can never touch production.
 */
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";

const dbName = process.env.MORBIN_DB ?? "";
if (!/test|dev/i.test(dbName)) {
  console.error(`Refusing to seed "${dbName}": not a test/dev database.`);
  process.exit(1);
}
const email = (process.env.DEV_OWNER_EMAIL ?? "owner@morbin.test").toLowerCase();
const password = process.env.DEV_OWNER_PASSWORD ?? "";
if (password.length < 12) {
  console.error("Set DEV_OWNER_PASSWORD (12+ chars) in .env.local first.");
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI ?? "");
await client.connect();
const db = client.db(dbName);
const now = new Date();

const passwordHash = await bcrypt.hash(password, 12);
await db.collection("users").updateOne(
  { email },
  {
    $set: { passwordHash, emailVerified: now, name: "Dev Owner", role: "USER", updatedAt: now },
    $setOnInsert: { email, image: null, createdAt: now },
  },
  { upsert: true },
);
const user = await db.collection("users").findOne({ email });
const userId = user!._id.toString();

const slug = "morbin-dev-test-org";
await db.collection("organizations").updateOne(
  { slug },
  {
    $setOnInsert: {
      name: "Morbin Dev Test Org",
      slug,
      ownerId: userId,
      type: "INSTITUTION",
      status: "ACTIVE",
      onboardingStatus: "ACTIVE",
      paymentAccountStatus: "VERIFIED",
      payoutsEnabled: true,
      chargesEnabled: true,
      createdAt: now,
      updatedAt: now,
    },
  },
  { upsert: true },
);
const org = await db.collection("organizations").findOne({ slug });
const orgId = org!._id.toString();
await db
  .collection("memberships")
  .updateOne(
    { organizationId: orgId, userId },
    { $set: { role: "OWNER" }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );

const memberEmail = "member@morbin.test";
await db.collection("users").updateOne(
  { email: memberEmail },
  {
    $set: { passwordHash, emailVerified: now, name: "Dev Member", role: "USER", updatedAt: now },
    $setOnInsert: { email: memberEmail, image: null, createdAt: now },
  },
  { upsert: true },
);
const member = await db.collection("users").findOne({ email: memberEmail });
await db
  .collection("memberships")
  .updateOne(
    { organizationId: orgId, userId: member!._id.toString() },
    { $set: { role: "MEMBER" }, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );

console.log(`Dev owner ready: ${email} → "${org!.name}" (${orgId}) in ${dbName}`);
console.log(`Dev member ready: ${memberEmail} (same password)`);
await client.close();
