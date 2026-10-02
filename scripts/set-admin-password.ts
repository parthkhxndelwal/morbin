/**
 * Set a local admin's password.
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/set-admin-password.ts <email> <password>
 *
 * Deliberately does not touch `role`: the bootstrap owns that field, and this
 * script is only about the credential. Refuses on a production-shaped
 * configuration so a stray invocation against a real database cannot quietly
 * install a weak password on an admin account.
 */
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";

const [, , emailArg, password] = process.argv;
if (!emailArg || !password) {
  console.error("usage: set-admin-password.ts <email> <password>");
  process.exit(1);
}
const email = emailArg.toLowerCase();

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
if (/^https?:\/\//.test(appUrl) && !/localhost|127\.0\.0\.1/.test(appUrl)) {
  console.error(
    `Refusing: NEXT_PUBLIC_APP_URL is ${appUrl}, which is not local. ` +
      "This script exists for development databases only.",
  );
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI ?? "");
await client.connect();
const db = client.db(process.env.MORBIN_DB ?? "morbin");

const existing = await db
  .collection("users")
  .findOne({ email }, { projection: { role: 1, emailVerified: 1 } });
if (!existing) {
  console.error(`No user row for ${email}. Create the account first.`);
  await client.close();
  process.exit(1);
}

await db.collection("users").updateOne(
  { email },
  {
    $set: {
      passwordHash: await bcrypt.hash(password, 12),
      updatedAt: new Date(),
    },
  },
);

console.log(`Password updated for ${email} (role: ${existing.role ?? "none"}).`);
if (!existing.emailVerified) {
  console.log(
    "Note: emailVerified is null, so the first sign-in will be refused with " +
      "EMAIL_NOT_VERIFIED and will email a verification link.",
  );
}
await client.close();
