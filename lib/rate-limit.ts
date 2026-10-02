import "server-only";

import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { getDb } from "@/lib/db";

/**
 * Fixed-window rate limiting, stored in Mongo so it holds across restarts and
 * needs no extra service on the server. Counters expire through a TTL index.
 *
 * Callers pass a *subject* (an IP, an email); it is HMAC'd with AUTH_SECRET
 * before it is stored, so the collection never holds an IP address or email.
 */

interface Counter {
  _id: string;
  count: number;
  expiresAt: Date;
}

function digest(subject: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "morbin-rate-limit").update(subject).digest("base64url").slice(0, 32);
}

/** True when this call is within the limit; false once it is exceeded. */
export async function rateLimit(bucket: string, subject: string, limit: number, windowMs: number): Promise<boolean> {
  const window = Math.floor(Date.now() / windowMs);
  const _id = `${bucket}:${digest(subject)}:${window}`;
  const db = await getDb();
  const doc = await db.collection<Counter>("rateLimits").findOneAndUpdate(
    { _id },
    { $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 1) * windowMs + 60_000) } },
    { upsert: true, returnDocument: "after" },
  );
  return (doc?.count ?? 1) <= limit;
}

/**
 * The client's IP as Caddy saw it. Caddy only honours an incoming
 * X-Forwarded-For from its trusted proxies (loopback, or the Docker bridge in
 * tunnel mode) and otherwise writes the real peer address, so the left-most
 * entry is trustworthy. Headers like CF-Connecting-IP are not: in direct mode
 * any client could send one.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
