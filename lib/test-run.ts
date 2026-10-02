import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * "Run through checkout as a buyer": a short-lived, signed token that opens
 * the real public drawer for one event in test mode, using the *draft* rules.
 *
 * Minted only for the event's owner or Morbin support (the route checks
 * `manageEvents`). A test-mode checkout session can never create an order,
 * hold a seat or send an email — the checkout routes refuse, not just the UI.
 */

export const TEST_RUN_TTL_MS = 15 * 60 * 1000;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return `test-run:${s}`;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function signTestRun(eventId: string, userId: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ e: eventId, u: userId, x: now + TEST_RUN_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The event (and who started the run) for a valid, unexpired token; null otherwise. */
export function verifyTestRun(token: string | null | undefined, now = Date.now()): { eventId: string; userId: string } | null {
  if (!token || token.length > 400) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { e?: string; u?: string; x?: number };
    if (!data.e || !data.u || typeof data.x !== "number" || data.x < now) return null;
    return { eventId: data.e, userId: data.u };
  } catch {
    return null;
  }
}
