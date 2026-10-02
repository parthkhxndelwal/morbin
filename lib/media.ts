/**
 * Organizer-uploaded media, stored on the server's own disk.
 *
 * Morbin is self-hosted on a single server and personal/organizer data must not
 * leave it, so uploads live in `MEDIA_DIR` (a Docker volume in production) and
 * are served back by `app/media/[...key]/route.ts`. Only *keys* are persisted in
 * Mongo; the URL is derived at render time.
 */
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { publicMediaUrl } from "@/lib/media-public";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Formats we accept. SVG is deliberately excluded: it is script-capable, and
 * serving organizer-supplied markup from our own origin is a stored-XSS vector
 * regardless of the CSP on the page that embeds it.
 */
const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(ALLOWED).map(([type, ext]) => [ext, type]),
);

/** Server-side alias of the public helper. */
export function mediaUrl(key: string): string {
  return publicMediaUrl(key);
}

export function isAllowedImageType(contentType: string): boolean {
  return contentType.toLowerCase() in ALLOWED;
}

export function extensionFor(contentType: string): string {
  return ALLOWED[contentType.toLowerCase()] ?? "bin";
}

export { MAX_BYTES, ALLOWED };

function mediaRoot(): string {
  return path.resolve(process.env.MEDIA_DIR ?? path.join(process.cwd(), "data", "media"));
}

/**
 * Keys look like `events/<objectId>/<kind>-<uuid>.<ext>`. Anything else is
 * refused before it reaches the filesystem, which is what makes path traversal
 * impossible rather than merely checked-for.
 */
const KEY_PATTERN =
  /^events\/[a-f0-9]{24}\/(banner|social)-[0-9a-f-]{36}\.(jpg|png|webp|avif|gif)$/;

export function isValidMediaKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

function resolveKey(key: string): string {
  if (!isValidMediaKey(key)) throw new Error("Invalid media key");
  const full = path.resolve(mediaRoot(), key);
  if (!full.startsWith(mediaRoot() + path.sep)) throw new Error("Invalid media key");
  return full;
}

export interface MediaStore {
  put(key: string, value: ArrayBuffer): Promise<void>;
  get(key: string): Promise<{ body: Buffer; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

/** Local-disk store. Writes are atomic (temp file + rename). */
export function mediaBucket(): MediaStore {
  return {
    async put(key, value) {
      const full = resolveKey(key);
      await mkdir(path.dirname(full), { recursive: true });
      const tmp = `${full}.${process.pid}.tmp`;
      await writeFile(tmp, Buffer.from(value), { mode: 0o640 });
      await rename(tmp, full);
    },
    async get(key) {
      let full: string;
      try {
        full = resolveKey(key);
      } catch {
        return null;
      }
      try {
        const body = await readFile(full);
        const ext = key.slice(key.lastIndexOf(".") + 1);
        return { body, contentType: TYPE_BY_EXT[ext] ?? "application/octet-stream" };
      } catch {
        return null;
      }
    },
    async delete(key) {
      try {
        await unlink(resolveKey(key));
      } catch {
        /* already gone */
      }
    },
  };
}
