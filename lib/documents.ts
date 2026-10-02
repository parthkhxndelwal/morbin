import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectId } from "mongodb";
import { getDb, toObjectId } from "@/lib/db";
import type { StoredDocument, StoredDocumentKind } from "@/lib/types";

/**
 * Private documents (payout statements, breakdowns, refund proofs).
 *
 * Stored on this server's disk under DOCUMENTS_DIR — a separate volume from
 * public media, never served statically. The only way to read one is
 * `app/api/documents/[id]`, which checks the caller may see that
 * organisation's documents. Files are immutable once written; a replacement
 * is a new document.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const TYPES: Record<string, { ext: string; magic?: number[] }> = {
  "application/pdf": { ext: "pdf", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] }, // %PDF-
  "text/csv": { ext: "csv" },
  "image/png": { ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  "image/jpeg": { ext: "jpg", magic: [0xff, 0xd8, 0xff] },
};

function root(): string {
  // Runtime data directory, never part of the build: keep it out of output tracing.
  return path.resolve(/*turbopackIgnore: true*/ process.env.DOCUMENTS_DIR ?? path.join(process.cwd(), "data", "documents"));
}

/** Does the content really have this type? (Declared types are not trusted.) */
export function matchesType(body: Buffer, contentType: string): boolean {
  const spec = TYPES[contentType];
  if (!spec) return false;
  if (!spec.magic) return true;
  return spec.magic.every((b, i) => body[i] === b);
}

function safeFileName(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${base || "document"}.${ext}`;
}

export async function storeDocument(input: {
  organizationId: string | null;
  kind: StoredDocumentKind;
  fileName: string;
  contentType: string;
  body: Buffer;
  uploadedBy: string | null;
}): Promise<StoredDocument> {
  const spec = TYPES[input.contentType];
  if (!spec) throw new Error("Unsupported document type");
  if (input.body.length === 0) throw new Error("The file is empty");
  if (input.body.length > MAX_DOCUMENT_BYTES) throw new Error("The file is larger than 10 MB");
  if (!matchesType(input.body, input.contentType)) throw new Error("The file's contents don't match its type");

  const storageKey = `${input.organizationId ?? "platform"}/${randomUUID()}.${spec.ext}`;
  const full = path.join(/*turbopackIgnore: true*/ root(), storageKey);
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.tmp`;
  await writeFile(tmp, input.body, { mode: 0o640 });
  await rename(tmp, full);

  const doc: StoredDocument = {
    _id: new ObjectId(),
    organizationId: input.organizationId,
    kind: input.kind,
    storageKey,
    fileName: safeFileName(input.fileName, spec.ext),
    contentType: input.contentType,
    bytes: input.body.length,
    sha256: createHash("sha256").update(input.body).digest("hex"),
    uploadedBy: input.uploadedBy,
    createdAt: new Date(),
  };
  const db = await getDb();
  await db.collection<StoredDocument>("documents").insertOne(doc);
  return doc;
}

export async function getDocument(id: string): Promise<StoredDocument | null> {
  const _id = toObjectId(id);
  if (!_id) return null;
  const db = await getDb();
  return db.collection<StoredDocument>("documents").findOne({ _id });
}

/** Read a document's bytes, verifying they are unchanged since upload. */
export async function readDocumentBody(doc: StoredDocument): Promise<Buffer> {
  const full = path.resolve(/*turbopackIgnore: true*/ root(), doc.storageKey);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid document path");
  const body = await readFile(full);
  if (createHash("sha256").update(body).digest("hex") !== doc.sha256) {
    throw new Error("Document integrity check failed");
  }
  return body;
}

/** Remove a document and its file (retention jobs, test cleanup). */
export async function deleteDocument(id: string): Promise<void> {
  const doc = await getDocument(id);
  if (!doc) return;
  const full = path.resolve(/*turbopackIgnore: true*/ root(), doc.storageKey);
  if (full.startsWith(root() + path.sep)) {
    await unlink(full).catch(() => {});
  }
  const db = await getDb();
  await db.collection<StoredDocument>("documents").deleteOne({ _id: doc._id });
}

/** Quote a value for CSV, neutralising spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
