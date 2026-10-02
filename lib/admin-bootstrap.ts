import bcrypt from "bcryptjs";
import { adminBootstrapPassword, adminEmails } from "@/lib/config";
import { getDb, toObjectId } from "@/lib/db";
import { passwordProblem, planBootstrap, type BootstrapAction } from "@/lib/admin-bootstrap-plan";
import type { User, UserRole } from "@/lib/types";

export { passwordProblem, MIN_PASSWORD_LENGTH } from "@/lib/admin-bootstrap-plan";
export type { BootstrapAction } from "@/lib/admin-bootstrap-plan";

export interface BootstrapResult {
  emails: string[];
  promoted: string[];
  created: string[];
  skippedNoPassword: string[];
  skippedExplicitRole: string[];
  weakPassword: boolean;
}

/**
 * Guarantee that the emails listed in ADMIN_EMAILS hold the ADMIN role.
 *
 * Idempotent, and safe to run on every cold start. An existing account's
 * password is never read, reset or replaced — only the role field is touched.
 * See lib/admin-bootstrap-plan.ts for the decision rules.
 */
export async function ensureBootstrapAdmin(): Promise<BootstrapResult> {
  const result: BootstrapResult = {
    emails: [],
    promoted: [],
    created: [],
    skippedNoPassword: [],
    skippedExplicitRole: [],
    weakPassword: false,
  };

  const emails = [...adminEmails()];
  result.emails = emails;
  if (emails.length === 0) return result;

  const db = await getDb();
  const users = db.collection<User>("users");
  const found = await users
    .find({ email: { $in: emails } }, { projection: { email: 1, role: 1 } })
    .toArray();
  const existing = new Map(found.map((u) => [u.email, u.role as string | undefined]));

  const plan = planBootstrap(emails, existing, adminBootstrapPassword());

  for (const action of plan) {
    if (action.type === "skip") {
      recordSkip(result, action);
      continue;
    }

    if (action.type === "promote") {
      // Guarded so a concurrent demotion between the read and this write is
      // not silently undone.
      const r = await users.updateOne(
        {
          email: action.email,
          $or: [{ role: { $exists: false } }, { role: null as unknown as UserRole }],
        },
        { $set: { role: "ADMIN" as UserRole, updatedAt: new Date() } },
      );
      if (r.modifiedCount === 1) result.promoted.push(action.email);
      else result.skippedExplicitRole.push(action.email);
      continue;
    }

    const now = new Date();
    const doc = {
      name: "Morbin Admin",
      email: action.email,
      passwordHash: await bcrypt.hash(action.password, 12),
      // Admin-provisioned: no verification round-trip is possible or useful.
      emailVerified: now,
      image: null,
      role: "ADMIN" as UserRole,
      createdAt: now,
      updatedAt: now,
    };
    try {
      await users.insertOne(doc);
      result.created.push(action.email);
    } catch (error) {
      // Duplicate key means a concurrent cold start won the race; that is a
      // success for our purposes — make sure the role is set either way.
      if (error instanceof Error && "code" in error && error.code === 11000) {
        await users.updateOne(
          { email: action.email },
          { $set: { role: "ADMIN" as UserRole } },
        );
        result.promoted.push(action.email);
      } else {
        throw error;
      }
    }
  }

  return result;
}

function recordSkip(result: BootstrapResult, action: BootstrapAction): void {
  if (action.type !== "skip") return;
  switch (action.reason) {
    case "already-admin":
      break;
    case "explicitly-demoted":
      result.skippedExplicitRole.push(action.email);
      break;
    case "no-account-and-weak-password":
      result.weakPassword = true;
      result.skippedNoPassword.push(action.email);
      break;
    case "no-account-and-no-password":
      result.skippedNoPassword.push(action.email);
      break;
  }
}

/** Whether any account currently holds the ADMIN role. */
export async function adminExists(): Promise<boolean> {
  const db = await getDb();
  const found = await db
    .collection<User>("users")
    .findOne({ role: "ADMIN" }, { projection: { _id: 1 } });
  return !!found;
}

/** Promote or demote an account by id. Used by admin tooling, not by request handlers. */
export async function setUserRole(userId: string, role: UserRole): Promise<boolean> {
  const db = await getDb();
  const _id = toObjectId(userId);
  if (!_id) return false;
  const r = await db
    .collection<User>("users")
    .updateOne({ _id }, { $set: { role, updatedAt: new Date() } });
  return r.modifiedCount === 1 || r.matchedCount === 1;
}

/** Re-exported for the startup diagnostics. */
export { passwordProblem as bootstrapPasswordProblem };