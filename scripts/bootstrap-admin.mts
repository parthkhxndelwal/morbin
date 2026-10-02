/**
 * Explicit admin provisioning, for the case where you want the account created
 * right now rather than on the next cold start.
 *
 *   npm run admin:bootstrap
 *
 * Safe to re-run. See lib/admin-bootstrap.ts for the rules: it never invents a
 * credential, never resets an existing password, and never re-promotes an
 * account whose role was explicitly set.
 */
import { ensureBootstrapAdmin } from "../lib/admin-bootstrap.ts";
import { adminBootstrapPassword, adminEmails } from "../lib/config.ts";

const emails = [...adminEmails()];
if (emails.length === 0) {
  console.error("ADMIN_EMAILS is empty — nobody is allowed to be an admin. Refusing to run.");
  process.exit(1);
}
if (!adminBootstrapPassword() && !(await hasExistingUser())) {
  console.error(
    `No Morbin account exists yet for: ${emails.join(", ")}\n` +
      `Set ADMIN_BOOTSTRAP_PASSWORD (8+ chars, one uppercase, one number) and re-run to ` +
      `create it, or sign in once with Google to create the account by hand.`,
  );
  process.exit(1);
}

async function hasExistingUser(): Promise<boolean> {
  const { getDb } = await import("../lib/db.ts");
  const db = await getDb();
  const found = await db.collection("users").findOne({ email: emails[0] }, { projection: { _id: 1 } });
  return !!found;
}

try {
  const r = await ensureBootstrapAdmin();
  console.log(`allowlisted: ${r.emails.join(", ")}`);
  console.log(`created    : ${r.created.join(", ") || "(none)"}`);
  console.log(`promoted   : ${r.promoted.join(", ") || "(none)"}`);
  console.log(
    `left alone : ${[...r.skippedExplicitRole, ...r.skippedNoPassword].join(", ") || "(none)"}`,
  );
  if (r.created.length) {
    console.log("\nChange that password immediately, then remove ADMIN_BOOTSTRAP_PASSWORD.");
  }
  process.exit(0);
} catch (error) {
  console.error("admin bootstrap failed:", error);
  process.exit(1);
}
