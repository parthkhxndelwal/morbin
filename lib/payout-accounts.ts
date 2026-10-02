import "server-only";

import { createCipheriv, randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import type { PayoutAccount } from "@/lib/types";

/**
 * Payout bank details, encrypted at rest.
 *
 * Morbin holds the account a payout is transferred to, so the account number is
 * the one piece of financial PII the database is not allowed to hold in the
 * clear. It is sealed with **AES-256-GCM** under a single deployment secret,
 * `DATA_ENCRYPTION_KEY`, and stored as one self-describing string:
 *
 *     v1.<iv base64url>.<auth tag base64url>.<ciphertext base64url>
 *
 * A fresh 12-byte IV is generated per write, and the version prefix is what
 * lets a future key rotation or algorithm change read old rows.
 *
 * Two rules hold this module together:
 *
 * 1. **No plaintext, ever.** `savePayoutAccount` refuses to write anything when
 *    the key is missing or malformed — it throws `EncryptionNotConfigured`
 *    rather than falling back to an unencrypted row. Callers must not catch it
 *    and retry without encryption.
 * 2. **No decryption on the way out.** `getPayoutAccountView` returns the
 *    account name, IFSC and last four digits only, so the UI and the audit log
 *    can never carry a full account number. No current feature needs the
 *    plaintext; the format above is the whole contract, and a feature that
 *    genuinely must decrypt should add an audited, single-purpose reader here
 *    rather than reaching for the stored string.
 */

/** AES-256: 32 bytes, 12-byte IV, 16-byte GCM tag. */
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = "v1";

/**
 * The deployment is missing a usable `DATA_ENCRYPTION_KEY`.
 *
 * `reason` is MISSING (absent/blank) or INVALID (present but not 32 bytes of
 * base64 or hex). Typed so a caller can show a different message for each, and
 * so the invariant "never store plaintext" is enforced by the type system: the
 * write path has no branch that continues past this.
 */
export class EncryptionNotConfigured extends Error {
  readonly code = "ENCRYPTION_NOT_CONFIGURED" as const;

  constructor(readonly reason: "MISSING" | "INVALID") {
    // The message reaches organisation owners, so it names no server internals;
    // the operator-facing detail is logged once when the key is first read.
    super("Payout bank details can't be saved right now because of a configuration issue on Morbin's side.");
    this.name = "EncryptionNotConfigured";
  }
}

export function isEncryptionNotConfigured(error: unknown): error is EncryptionNotConfigured {
  return error instanceof EncryptionNotConfigured;
}

export type PayoutEncryptionState =
  | { configured: true }
  | { configured: false; reason: "MISSING" | "INVALID"; message: string };

/**
 * Decode the secret. Accepts 64 hex characters (`openssl rand -hex 32`) or
 * 44 base64/base64url characters (`openssl rand -base64 32`) and insists on
 * exactly 32 bytes, so a truncated or mistyped value is caught at startup
 * rather than silently deriving a weak key.
 */
function readKeyBytes(raw: string | undefined): Buffer | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) {
    const bytes = Buffer.from(value, "hex");
    return bytes.length === KEY_BYTES ? bytes : null;
  }
  // `openssl rand -base64 32` emits standard base64; accept the URL-safe
  // alphabet too, since a value copied out of a URL would use it.
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  const bytes = Buffer.from(base64, "base64");
  return bytes.length === KEY_BYTES ? bytes : null;
}

/**
 * Memoised per process: the env is fixed once, and re-deriving the key on every
 * write is wasted work. Keyed on the raw value so a test or a dev server that
 * changes it is picked up immediately.
 */
type KeyState =
  | { raw: string | undefined; key: Buffer; reason: null }
  | { raw: string | undefined; key: null; reason: "MISSING" | "INVALID" };

let cachedKey: KeyState | undefined;

function encryptionKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY;
  if (cachedKey && cachedKey.raw === raw) {
    if (!cachedKey.key) throw new EncryptionNotConfigured(cachedKey.reason);
    return cachedKey.key;
  }
  const bytes = readKeyBytes(raw);
  // The failure reason is cached with the key, so a misconfigured server keeps
  // reporting *why* it is misconfigured instead of degrading to "missing".
  const state: KeyState = bytes
    ? { raw, key: bytes, reason: null }
    : { raw, key: null, reason: raw?.trim() ? "INVALID" : "MISSING" };
  cachedKey = state;
  if (!state.key) {
    console.error(
      state.reason === "MISSING"
        ? "[payout-accounts] DATA_ENCRYPTION_KEY is not set; payout bank details cannot be saved."
        : "[payout-accounts] DATA_ENCRYPTION_KEY is not 32 bytes of hex or base64; payout bank details cannot be saved.",
    );
    throw new EncryptionNotConfigured(state.reason);
  }
  return state.key;
}

/**
 * Whether payout details can be written at all, for the UI to disable the form
 * with an explanation rather than letting the owner fill it in and fail on save.
 */
export function payoutEncryptionState(): PayoutEncryptionState {
  try {
    encryptionKey();
    return { configured: true };
  } catch (error) {
    if (isEncryptionNotConfigured(error)) {
      return { configured: false, reason: error.reason, message: error.message };
    }
    throw error;
  }
}

/** Seal a secret into the stored `v1.<iv>.<tag>.<ciphertext>` string. */
function encryptSecret(plaintext: string): string {
  const key = encryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_BYTES) throw new Error("Unexpected AES-GCM tag length");
  const b64 = (b: Buffer) => b.toString("base64url");
  return [VERSION, b64(iv), b64(tag), b64(ciphertext)].join(".");
}

/** An account number as a bank writes it: 9–18 digits, no separators. */
function normaliseAccountNumber(accountNumber: string): string {
  return accountNumber.replace(/[\s-]/g, "");
}

/** The safe projection of a stored account: enough to recognise it, never to spend from it. */
export interface PayoutAccountView {
  accountName: string;
  ifsc: string;
  /** Last four digits only — the full number is never read back out. */
  last4: string;
  verifiedAt: Date | null;
  updatedAt: Date;
}

/**
 * Save (or replace) the organisation's payout account.
 *
 * `accountNumber` may be omitted to leave the stored number untouched, which is
 * how the settings form re-saves a name or IFSC without ever having the number
 * to re-submit. Any account number supplied is re-encrypted with a fresh IV, so
 * a rotated account cannot be told apart from a saved one by comparing rows.
 */
export async function savePayoutAccount(
  organizationId: string,
  input: { accountName: string; ifsc: string; accountNumber?: string | null },
): Promise<PayoutAccountView> {
  // Checked before any write, and on every path, so an unencrypted row is never
  // a reachable state and a misconfigured server fails the same way whatever the
  // owner was trying to change.
  encryptionKey();

  const number = normaliseAccountNumber(input.accountNumber ?? "");
  const db = await getDb();
  const collection = db.collection<PayoutAccount>("payoutAccounts");
  const now = new Date();

  if (number.length === 0) {
    // Nothing new to seal: keep the stored number exactly as it was written and
    // only update the descriptive fields.
    const existing = await collection.findOne({ organizationId });
    if (!existing) throw new Error("This organisation has no payout account to update yet.");
    // A different IFSC is a different destination, even with the same number,
    // so it needs verifying again just like a new account number would.
    const verifiedAt = existing.ifsc === input.ifsc ? (existing.verifiedAt ?? null) : null;
    const next = { accountName: input.accountName, ifsc: input.ifsc, verifiedAt, updatedAt: now };
    await collection.updateOne({ organizationId }, { $set: next });
    return toView({ ...existing, ...next });
  }

  const doc: PayoutAccount = {
    organizationId,
    accountName: input.accountName,
    ifsc: input.ifsc,
    accountNumberEnc: encryptSecret(number),
    last4: number.slice(-4),
    // A changed account is unverified again until an admin looks at it.
    verifiedAt: null,
    updatedAt: now,
  };
  await collection.updateOne(
    { organizationId },
    { $set: doc, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
  return toView(doc);
}

function toView(doc: PayoutAccount): PayoutAccountView {
  return {
    accountName: doc.accountName,
    ifsc: doc.ifsc,
    last4: doc.last4,
    verifiedAt: doc.verifiedAt ?? null,
    updatedAt: doc.updatedAt,
  };
}

/** The stored account, as a safe view model, or null when none is on file. */
export async function getPayoutAccountView(
  organizationId: string,
): Promise<PayoutAccountView | null> {
  const db = await getDb();
  const doc = await db.collection<PayoutAccount>("payoutAccounts").findOne(
    { organizationId },
    { projection: { accountName: 1, ifsc: 1, last4: 1, verifiedAt: 1, updatedAt: 1 } },
  );
  return doc ? toView(doc) : null;
}
