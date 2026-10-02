/**
 * One-off data migration for the roles-and-organization-types change.
 *
 * Idempotent — safe to re-run.
 *
 *   npm run db:migrate
 *
 * Does three things:
 *   1. memberships.role "STAFF" -> "MEMBER"   (the non-owner role was renamed;
 *      the human wording is now derived from the organization type)
 *   2. organizations.type  -> "EVENT"          (every pre-typed org was an
 *                                              event organizer)
 *   3. organizations.status -> "ACTIVE"         (orgs were soft-deletable after
 *                                              this change; treat old ones as live)
 *
 * Also (re)creates the unique indexes, so a fresh database can be brought up in
 * one step.
 */
import { ensureIndexes, getDb } from "../lib/db.ts";

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set. Refusing to run.");
  process.exit(1);
}

const db = await getDb();

const roles = await db
  .collection("memberships")
  .updateMany({ role: "STAFF" }, { $set: { role: "MEMBER" } });
console.log(`memberships: ${roles.modifiedCount} STAFF -> MEMBER`);

const orgs = await db
  .collection("organizations")
  .updateMany(
    { $or: [{ type: { $exists: false } }, { type: null }] },
    { $set: { type: "EVENT" } },
  );
console.log(`organizations: ${orgs.modifiedCount} missing type -> EVENT`);

const suspended = await db
  .collection("organizations")
  .updateMany(
    { $or: [{ status: { $exists: false } }, { status: null }] },
    { $set: { status: "ACTIVE" } },
  );
console.log(`organizations: ${suspended.modifiedCount} missing status -> ACTIVE`);

await ensureIndexes();
console.log("indexes ensured");

// Admin role backfill. Accounts that were previously granted admin purely by
// being in the ADMIN_EMAILS allowlist now carry role: "ADMIN" on the document,
// which is what requireAdmin actually checks.
//
// The guard `role: { $exists: false }` is deliberate: someone an operator has
// explicitly demoted has role "USER" and must stay demoted.
const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
if (adminEmails.length === 0) {
  console.log("admin: ADMIN_EMAILS empty — skipped (no one can hold ADMIN)");
} else {
  const promoted = await db.collection("users").updateMany(
    { email: { $in: adminEmails }, role: { $exists: false } },
    { $set: { role: "ADMIN" } },
  );
  console.log(`admin: ${promoted.modifiedCount} account(s) promoted to ADMIN`);
}

const sample = await db
  .collection("organizations")
  .find({}, { projection: { name: 1, type: 1, status: 1 } })
  .limit(5)
  .toArray();
console.log("sample:", JSON.stringify(sample));

process.exit(0);
