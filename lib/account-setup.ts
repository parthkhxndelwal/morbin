import "server-only";

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { ObjectId } from "mongodb";
import { audit } from "@/lib/audit";
import { getDb, toObjectId } from "@/lib/db";
import { appUrl } from "@/lib/email";
import { TxAbort } from "@/lib/tx";
import type { EmailRecord, User } from "@/lib/types";

/**
 * One-time "choose your password" links for accounts Morbin creates on
 * someone's behalf — an organisation owner set up by an admin, or approved from
 * an application. Nobody ever types another person's password: the account
 * exists without one until its owner opens the emailed link.
 *
 * Only the sha256 of the token is stored. A new link replaces the old one.
 */

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface SetupToken {
  _id?: ObjectId;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** Create (or re-issue) a set-password link for this user and email it. */
export async function sendAccountSetup(
  userId: string,
  context: { organizationName: string; inviterName: string },
): Promise<void> {
  const db = await getDb();
  const user = await db.collection<User>("users").findOne({ _id: toObjectId(userId)! });
  if (!user) throw new TxAbort("That account no longer exists.", 404);
  const raw = randomBytes(32).toString("base64url");
  const now = new Date();
  await db
    .collection<SetupToken>("accountSetupTokens")
    .updateOne(
      { userId },
      { $set: { tokenHash: hash(raw), expiresAt: new Date(now.getTime() + TTL_MS), usedAt: null, createdAt: now } },
      { upsert: true },
    );
  await db.collection<EmailRecord>("emailDeliveries").insertOne({
    orderId: null,
    ticketId: null,
    recipient: user.email,
    kind: "ACCOUNT_SETUP",
    status: "QUEUED",
    attempts: 0,
    lastError: null,
    meta: {
      organizationName: context.organizationName,
      inviterName: context.inviterName,
      attendeeName: user.name?.trim() || user.email.split("@")[0],
      link: `${appUrl("/auth/set-password")}?token=${encodeURIComponent(raw)}`,
    },
  });
  try {
    const { flushEmailQueue } = await import("@/lib/email");
    await flushEmailQueue(5);
  } catch {
    /* the scheduler retries */
  }
}

export type SetupView = { state: "valid"; email: string; name: string } | { state: "expired" | "invalid" };

export async function getSetupView(raw: string): Promise<SetupView> {
  if (!raw || raw.length > 200) return { state: "invalid" };
  const db = await getDb();
  const token = await db.collection<SetupToken>("accountSetupTokens").findOne({ tokenHash: hash(raw) });
  if (!token || token.usedAt) return { state: "invalid" };
  if (token.expiresAt.getTime() <= Date.now()) return { state: "expired" };
  const user = await db.collection<User>("users").findOne({ _id: toObjectId(token.userId)! });
  if (!user) return { state: "invalid" };
  return { state: "valid", email: user.email, name: user.name ?? "" };
}

/** Spend the link: set the password, mark the email verified (they opened it). */
export async function completeAccountSetup(raw: string, input: { name: string; password: string }): Promise<{ email: string }> {
  const db = await getDb();
  const now = new Date();
  const passwordHash = await bcrypt.hash(input.password, 12);
  // Claim the token atomically so a double submit can't set two passwords.
  const token = await db
    .collection<SetupToken>("accountSetupTokens")
    .findOneAndUpdate(
      { tokenHash: hash(raw), usedAt: null, expiresAt: { $gt: now } },
      { $set: { usedAt: now } },
    );
  if (!token) throw new TxAbort("This link has expired or was already used. Ask Morbin for a new one.", 410);
  const user = await db
    .collection<User>("users")
    .findOneAndUpdate(
      { _id: toObjectId(token.userId)! },
      { $set: { passwordHash, name: input.name, emailVerified: now, updatedAt: now } },
      { returnDocument: "after" },
    );
  if (!user) throw new TxAbort("That account no longer exists.", 404);
  await audit({
    actorId: token.userId,
    actorRole: "OWNER",
    action: "account.setup.completed",
    targetType: "user",
    targetId: token.userId,
    organizationId: null,
    meta: {},
  });
  return { email: user.email };
}

/**
 * Find or create the person who will own an organisation. A new account has
 * no password until they use the setup link.
 */
export async function findOrCreateOwnerUser(email: string, name: string): Promise<{ userId: string; created: boolean }> {
  const db = await getDb();
  const normalised = email.trim().toLowerCase();
  const existing = await db.collection<User>("users").findOne({ email: normalised });
  if (existing) {
    if (existing.role === "ADMIN") throw new TxAbort("A Morbin admin can't own an organisation.", 409);
    const membership = await db.collection("memberships").findOne({ userId: existing._id!.toString() });
    if (membership) throw new TxAbort(`${normalised} already belongs to an organisation on Morbin.`, 409);
    return { userId: existing._id!.toString(), created: false };
  }
  const now = new Date();
  try {
    const { insertedId } = await db.collection<User>("users").insertOne({
      name: name.trim() || normalised.split("@")[0],
      email: normalised,
      emailVerified: null,
      image: null,
      role: "USER",
      createdAt: now,
      updatedAt: now,
    });
    return { userId: insertedId.toString(), created: true };
  } catch (error) {
    if ((error as { code?: number }).code === 11000) return findOrCreateOwnerUser(email, name);
    throw error;
  }
}
