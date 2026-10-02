import "server-only";

import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { audit } from "@/lib/audit";
import { getDb, safeObjectIds, toObjectId } from "@/lib/db";
import { appUrl } from "@/lib/email";
import { TxAbort, withTransaction } from "@/lib/tx";
import type {
  EmailRecord,
  Membership,
  Organization,
  OrgRole,
  TeamInvite,
  User,
} from "@/lib/types";

/**
 * An organisation's team: who is on it, and how new people join.
 *
 * Two ways in, both decided here so no page or action can bend them:
 *
 * - **Someone who already has a Morbin account** is added as a MEMBER straight
 *   away and told by email.
 * - **Someone new** gets an invite: a one-time link (only its sha256 is stored)
 *   to a page where they choose a password. Accepting creates the account and
 *   the membership in one transaction.
 *
 * A person belongs to one organisation: the dashboard resolves a user to a
 * single workspace and has no switcher, so a second membership would be one
 * they could never reach. Platform admins are never members of anything.
 * The owner is never removed here, and nobody removes themselves.
 */

/** The emailed secret; only its sha256 is ever stored. */
function randomToken(): string {
  return randomBytes(32).toString("base64url");
}
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Resending re-arms the link; this keeps it from becoming a mail cannon. */
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_INVITE = 5;
const MAX_INVITES_PER_DAY = 50;

/* ── View models ─────────────────────────────────────────────────────────── */

export interface TeamMemberRow {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  isOwner: boolean;
  isYou: boolean;
  joinedAt: string;
}

export interface TeamInviteRow {
  id: string;
  email: string;
  name: string | null;
  expired: boolean;
  expiresAt: string;
  lastSentAt: string;
  canResend: boolean;
}

export async function getTeam(
  organizationId: string,
  viewerId: string,
): Promise<{ members: TeamMemberRow[]; invites: TeamInviteRow[] }> {
  const db = await getDb();
  const orgOid = toObjectId(organizationId);
  if (!orgOid) return { members: [], invites: [] };
  const [org, memberships, invites] = await Promise.all([
    db.collection<Organization>("organizations").findOne({ _id: orgOid }, { projection: { ownerId: 1 } }),
    db.collection<Membership>("memberships").find({ organizationId }).sort({ createdAt: 1 }).toArray(),
    db
      .collection<TeamInvite>("teamInvites")
      .find({ organizationId, status: "PENDING" })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray(),
  ]);
  const users = await db
    .collection<User>("users")
    .find({ _id: { $in: safeObjectIds(memberships.map((m) => m.userId)) } }, { projection: { name: 1, email: 1 } })
    .toArray();
  const byId = new Map(users.map((u) => [u._id!.toString(), u]));
  const now = Date.now();

  const members = memberships.flatMap((m) => {
    const u = byId.get(m.userId);
    if (!u) return [];
    const isOwner = m.userId === org?.ownerId || m.role === "OWNER";
    return [
      {
        userId: m.userId,
        name: u.name?.trim() || u.email.split("@")[0],
        email: u.email,
        role: isOwner ? ("OWNER" as const) : m.role,
        isOwner,
        isYou: m.userId === viewerId,
        joinedAt: m.createdAt.toISOString(),
      },
    ];
  });
  // Owner first, then by join date.
  members.sort((a, b) => Number(b.isOwner) - Number(a.isOwner));

  return {
    members,
    invites: invites.map((i) => ({
      id: i._id!.toString(),
      email: i.email,
      name: i.name,
      expired: i.expiresAt.getTime() <= now,
      expiresAt: i.expiresAt.toISOString(),
      lastSentAt: i.lastSentAt.toISOString(),
      canResend: i.sendCount < MAX_SENDS_PER_INVITE,
    })),
  };
}

/* ── Inviting ────────────────────────────────────────────────────────────── */

interface Actor {
  organizationId: string;
  userId: string;
  role: OrgRole;
}

async function actorContext(actor: Actor) {
  const db = await getDb();
  const [org, me] = await Promise.all([
    db.collection<Organization>("organizations").findOne({ _id: toObjectId(actor.organizationId)! }),
    db.collection<User>("users").findOne({ _id: toObjectId(actor.userId)! }, { projection: { name: 1, email: 1 } }),
  ]);
  if (!org) throw new TxAbort("Organisation not found.", 404);
  return { db, org, inviterName: me?.name?.trim() || me?.email || "Your organisation's owner" };
}

async function queueTeamEmail(
  kind: "TEAM_INVITE" | "TEAM_ADDED",
  recipient: string,
  meta: { organizationName: string; inviterName: string; attendeeName: string; link: string },
): Promise<void> {
  const db = await getDb();
  await db.collection<EmailRecord>("emailDeliveries").insertOne({
    orderId: null,
    ticketId: null,
    recipient,
    kind,
    status: "QUEUED",
    attempts: 0,
    lastError: null,
    meta,
  });
  // Best-effort prompt delivery; the scheduler retries anything left queued.
  try {
    const { flushEmailQueue } = await import("@/lib/email");
    await flushEmailQueue(5);
  } catch {
    /* retried by the scheduler */
  }
}

function joinLink(raw: string): string {
  return `${appUrl("/auth/join")}?token=${encodeURIComponent(raw)}`;
}

export type InviteOutcome = { kind: "added"; email: string } | { kind: "invited"; email: string };

/** Add someone to the team: directly if they have an account, by invite if not. */
export async function inviteToTeam(
  actor: Actor,
  input: { email: string; name: string | null },
): Promise<InviteOutcome> {
  const email = input.email.trim().toLowerCase();
  const { db, org, inviterName } = await actorContext(actor);
  const organizationId = actor.organizationId;

  const user = await db.collection<User>("users").findOne({ email });
  if (user) {
    const userId = user._id!.toString();
    if (userId === actor.userId) throw new TxAbort("That's you — you're already on the team.", 409);
    if (user.role === "ADMIN") throw new TxAbort("Morbin admins can't be added to an organisation.", 409);
    const existing = await db.collection<Membership>("memberships").findOne({ userId });
    const ownsAnother = await db
      .collection<Organization>("organizations")
      .findOne({ ownerId: userId, _id: { $ne: org._id } }, { projection: { _id: 1 } });
    if (existing?.organizationId === organizationId) {
      throw new TxAbort(`${email} is already on your team.`, 409);
    }
    if (existing || ownsAnother) {
      throw new TxAbort(
        `${email} already belongs to another organisation on Morbin. A person can be part of one organisation at a time.`,
        409,
      );
    }
    try {
      await db.collection<Membership>("memberships").insertOne({
        organizationId,
        userId,
        role: "MEMBER",
        createdAt: new Date(),
      });
    } catch (error) {
      // The unique (organizationId, userId) index: a concurrent add got there first.
      if ((error as { code?: number }).code === 11000) throw new TxAbort(`${email} is already on your team.`, 409);
      throw error;
    }
    await audit({
      actorId: actor.userId,
      actorRole: actor.role,
      action: "team.member.added",
      targetType: "user",
      targetId: userId,
      organizationId,
      meta: {},
    });
    await queueTeamEmail("TEAM_ADDED", email, {
      organizationName: org.name,
      inviterName,
      attendeeName: user.name?.trim() || email.split("@")[0],
      link: appUrl("/dashboard"),
    });
    return { kind: "added", email };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db
    .collection<TeamInvite>("teamInvites")
    .countDocuments({ organizationId, createdAt: { $gte: since } });
  if (recent >= MAX_INVITES_PER_DAY) {
    throw new TxAbort("That's a lot of invites for one day. Try again tomorrow, or contact Morbin support.", 429);
  }

  const raw = randomToken();
  const now = new Date();
  try {
    await db.collection<TeamInvite>("teamInvites").insertOne({
      organizationId,
      email,
      name: input.name,
      tokenHash: hashToken(raw),
      status: "PENDING",
      invitedBy: actor.userId,
      expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      lastSentAt: now,
      sendCount: 1,
      acceptedUserId: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    // Partial unique index: one PENDING invite per address per organisation.
    if ((error as { code?: number }).code === 11000) {
      throw new TxAbort(`${email} already has an invite waiting. Resend it from the list instead.`, 409);
    }
    throw error;
  }
  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "team.invite.sent",
    targetType: "teamInvite",
    targetId: null,
    organizationId,
    meta: {},
  });
  await queueTeamEmail("TEAM_INVITE", email, {
    organizationName: org.name,
    inviterName,
    attendeeName: input.name?.trim() || email.split("@")[0],
    link: joinLink(raw),
  });
  return { kind: "invited", email };
}

/**
 * Send the invite again with a fresh link (the old one stops working) and a
 * fresh seven days.
 */
export async function resendInvite(actor: Actor, inviteId: string): Promise<void> {
  const _id = toObjectId(inviteId);
  if (!_id) throw new TxAbort("That invite no longer exists.", 404);
  const { db, org, inviterName } = await actorContext(actor);
  const raw = randomToken();
  const now = new Date();
  const invite = await db.collection<TeamInvite>("teamInvites").findOneAndUpdate(
    {
      _id,
      organizationId: actor.organizationId,
      status: "PENDING",
      sendCount: { $lt: MAX_SENDS_PER_INVITE },
      lastSentAt: { $lte: new Date(now.getTime() - RESEND_COOLDOWN_MS) },
    },
    {
      $set: {
        tokenHash: hashToken(raw),
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        lastSentAt: now,
        updatedAt: now,
      },
      $inc: { sendCount: 1 },
    },
    { returnDocument: "after" },
  );
  if (!invite) {
    const current = await db
      .collection<TeamInvite>("teamInvites")
      .findOne({ _id, organizationId: actor.organizationId });
    if (!current || current.status !== "PENDING") throw new TxAbort("That invite no longer exists.", 404);
    if (current.sendCount >= MAX_SENDS_PER_INVITE) {
      throw new TxAbort("This invite has been sent as many times as it can be. Revoke it and invite again.", 429);
    }
    throw new TxAbort("It was sent a moment ago. Give it a minute before resending.", 429);
  }
  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "team.invite.resent",
    targetType: "teamInvite",
    targetId: inviteId,
    organizationId: actor.organizationId,
    meta: {},
  });
  await queueTeamEmail("TEAM_INVITE", invite.email, {
    organizationName: org.name,
    inviterName,
    attendeeName: invite.name?.trim() || invite.email.split("@")[0],
    link: joinLink(raw),
  });
}

export async function revokeInvite(actor: Actor, inviteId: string): Promise<void> {
  const _id = toObjectId(inviteId);
  if (!_id) throw new TxAbort("That invite no longer exists.", 404);
  const db = await getDb();
  const r = await db
    .collection<TeamInvite>("teamInvites")
    .updateOne(
      { _id, organizationId: actor.organizationId, status: "PENDING" },
      { $set: { status: "REVOKED", updatedAt: new Date() } },
    );
  if (r.modifiedCount === 0) throw new TxAbort("That invite no longer exists.", 404);
  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "team.invite.revoked",
    targetType: "teamInvite",
    targetId: inviteId,
    organizationId: actor.organizationId,
    meta: {},
  });
}

export async function removeFromTeam(actor: Actor, userId: string): Promise<void> {
  if (userId === actor.userId) throw new TxAbort("You can't remove yourself.", 400);
  const db = await getDb();
  const org = await db
    .collection<Organization>("organizations")
    .findOne({ _id: toObjectId(actor.organizationId)! }, { projection: { ownerId: 1 } });
  if (!org) throw new TxAbort("Organisation not found.", 404);
  if (org.ownerId === userId) throw new TxAbort("The owner can't be removed.", 400);
  // Only MEMBER rows are removable; an OWNER membership is never deleted here.
  const r = await db
    .collection<Membership>("memberships")
    .deleteOne({ organizationId: actor.organizationId, userId, role: "MEMBER" });
  if (r.deletedCount === 0) throw new TxAbort("That person isn't on your team.", 404);
  await audit({
    actorId: actor.userId,
    actorRole: actor.role,
    action: "team.member.removed",
    targetType: "user",
    targetId: userId,
    organizationId: actor.organizationId,
    meta: {},
  });
}

/* ── Joining ─────────────────────────────────────────────────────────────── */

export type InviteView =
  | { state: "valid"; email: string; name: string | null; organizationName: string; expiresAt: string }
  | { state: "expired" | "used" | "invalid" };

/** What the join page may show for a token. Reveals nothing for an unknown one. */
export async function getInviteView(raw: string): Promise<InviteView> {
  if (!raw || raw.length > 200) return { state: "invalid" };
  const db = await getDb();
  const invite = await db.collection<TeamInvite>("teamInvites").findOne({ tokenHash: hashToken(raw) });
  if (!invite || invite.status === "REVOKED") return { state: "invalid" };
  if (invite.status === "ACCEPTED") return { state: "used" };
  if (invite.expiresAt.getTime() <= Date.now()) return { state: "expired" };
  const org = await db
    .collection<Organization>("organizations")
    .findOne({ _id: toObjectId(invite.organizationId)! }, { projection: { name: 1 } });
  if (!org) return { state: "invalid" };
  return {
    state: "valid",
    email: invite.email,
    name: invite.name,
    organizationName: org.name,
    expiresAt: invite.expiresAt.toISOString(),
  };
}

/**
 * Accept an invite: create the account (email verified — they proved it by
 * opening the link) and the membership, and spend the invite, all or nothing.
 * Returns the email so the client can sign straight in.
 */
export async function acceptInvite(raw: string, input: { name: string; password: string }): Promise<{ email: string }> {
  const tokenHash = hashToken(raw);
  // Hashing is slow on purpose; keep it outside the transaction.
  const passwordHash = await bcrypt.hash(input.password, 12);
  return withTransaction(async (session, db) => {
    const now = new Date();
    const invite = await db
      .collection<TeamInvite>("teamInvites")
      .findOne({ tokenHash, status: "PENDING", expiresAt: { $gt: now } }, { session });
    if (!invite) throw new TxAbort("This invite link has expired or was already used. Ask for a new one.", 410);

    const existing = await db.collection<User>("users").findOne({ email: invite.email }, { session });
    if (existing) {
      throw new TxAbort(
        "An account with this email already exists. Sign in, and ask the owner to add you from their Team page.",
        409,
      );
    }
    const { insertedId } = await db.collection<User>("users").insertOne(
      {
        name: input.name,
        email: invite.email,
        passwordHash,
        emailVerified: now,
        image: null,
        role: "USER",
        createdAt: now,
        updatedAt: now,
      },
      { session },
    );
    const userId = insertedId.toString();
    await db
      .collection<Membership>("memberships")
      .insertOne({ organizationId: invite.organizationId, userId, role: "MEMBER", createdAt: now }, { session });
    const spent = await db
      .collection<TeamInvite>("teamInvites")
      .updateOne(
        { _id: invite._id, status: "PENDING" },
        { $set: { status: "ACCEPTED", acceptedUserId: userId, updatedAt: now } },
        { session },
      );
    if (spent.modifiedCount === 0) throw new TxAbort("This invite was just used.", 409);
    await audit(
      {
        actorId: userId,
        actorRole: "MEMBER",
        action: "team.invite.accepted",
        targetType: "teamInvite",
        targetId: invite._id!.toString(),
        organizationId: invite.organizationId,
        meta: {},
      },
      session,
    );
    return { email: invite.email };
  });
}
