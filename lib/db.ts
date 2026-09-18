import { MongoClient, type Db } from "mongodb";

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

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db(dbName);
}

/** Create unique indexes. Call explicitly (e.g. post-deploy script), never at import. */
export async function ensureIndexes(): Promise<void> {
  const db = await getDb();
  await Promise.all([
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("organizations").createIndex({ slug: 1 }, { unique: true }),
    db.collection("organizations").createIndex({ ownerId: 1 }),
    db.collection("memberships").createIndex(
      { organizationId: 1, userId: 1 },
      { unique: true },
    ),
    db.collection("events").createIndex({ organizationId: 1, slug: 1 }, { unique: true }),
    db.collection("ticketTypes").createIndex({ eventId: 1 }),
    db.collection("orders").createIndex({ razorpayOrderId: 1 }, { unique: true }),
    db.collection("orders").createIndex({ razorpayPaymentId: 1 }, { sparse: true }),
    db.collection("orders").createIndex({ eventId: 1 }),
    db.collection("tickets").createIndex({ code: 1 }, { unique: true }),
    db.collection("tickets").createIndex({ orderId: 1 }),
    db.collection("razorpayWebhooks").createIndex({ providerEventId: 1 }, { unique: true }),
    db.collection("emailDeliveries").createIndex({ status: 1 }),
    db.collection("waitlist").createIndex({ email: 1 }, { unique: true }),
  ]);
}
