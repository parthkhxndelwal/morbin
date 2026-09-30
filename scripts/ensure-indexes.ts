/**
 * Create the unique indexes the payment and ticketing invariants depend on.
 *
 * Idempotent — safe to re-run. Run it once against a given database after the
 * first deploy, and again whenever a new unique index is added:
 *
 *   npm run db:indexes
 *
 * Read MONGODB_URI and MORBIN_DB from the environment.
 */
import { ensureIndexes } from "../lib/db.ts";

if (!process.env.MONGODB_URI) {
  console.error("MONGODB_URI is not set. Refusing to run.");
  process.exit(1);
}

try {
  await ensureIndexes();
  console.log(
    `Indexes ensured on database "${process.env.MORBIN_DB ?? "morbin"}".`,
  );
  process.exit(0);
} catch (error) {
  console.error("Failed to ensure indexes:", error);
  process.exit(1);
}
