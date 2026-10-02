import type { ClientSession, Db } from "mongodb";
import { getClientPromise, getDbName } from "@/lib/db";

/**
 * Run `fn` in a MongoDB multi-document transaction.
 *
 * Money and inventory changes (seat holds + order, capture + tickets + ledger,
 * refunds, payouts) go through this so they commit together or not at all.
 * MongoDB runs as a replica set in every environment (single-node in Docker,
 * Atlas in development), which transactions require.
 *
 * `withTransaction` retries transient errors and write conflicts, so `fn` must
 * be safe to run more than once: no external calls (Razorpay, email) inside it.
 */
export async function withTransaction<T>(
  fn: (session: ClientSession, db: Db) => Promise<T>,
): Promise<T> {
  const client = await getClientPromise();
  const db = client.db(getDbName());
  const session = client.startSession();
  try {
    let result!: T;
    await session.withTransaction(
      async () => {
        result = await fn(session, db);
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        readPreference: "primary",
      },
    );
    return result;
  } finally {
    await session.endSession();
  }
}

/**
 * Serialise transactions that read-then-write the same organisation's balance.
 *
 * Snapshot isolation stops lost updates but not write skew: two refund
 * requests could each read "balance ₹1,000" and each hold ₹800. Bumping a
 * shared document makes the second transaction conflict and retry, at which
 * point it sees the first hold.
 */
export async function lockOrgBalance(
  db: Db,
  session: ClientSession,
  organizationId: string,
): Promise<void> {
  await db
    .collection<{ _id: string; v: number }>("locks")
    .updateOne({ _id: `balance:${organizationId}` }, { $inc: { v: 1 } }, { upsert: true, session });
}

/** A typed error a transaction can throw to abort with a user-facing message. */
export class TxAbort extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
