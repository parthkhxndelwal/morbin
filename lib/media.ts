/**
 * Organizer-uploaded media, stored on the server's own disk.
 *
 * Morbin is self-hosted on a single server and personal/organizer data must not
 * leave it, so uploads live in `MEDIA_DIR` (a Docker volume in production) and
 * are served back by `app/media/[...key]/route.ts`. Only *keys* are persisted in
 * Mongo; the URL is derived at render time.
 */
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
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
  // Runtime data directory, never part of the build: keep it out of output tracing.
  return path.resolve(/*turbopackIgnore: true*/ process.env.MEDIA_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "media"));
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
  const full = path.resolve(/*turbopackIgnore: true*/ mediaRoot(), key);
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

/**
 * Every file under `events/`, for the retention sweep: valid keys, plus any
 * leftover temp files from an interrupted write (`key` null, `file` set).
 * Anything else in the directory is not ours to judge and is not listed.
 */
export async function listMediaFiles(): Promise<{ key: string | null; file: string; modifiedAt: Date }[]> {
  const base = path.join(/*turbopackIgnore: true*/ mediaRoot(), "events");
  const out: { key: string | null; file: string; modifiedAt: Date }[] = [];
  const dirs = await readdir(base, { withFileTypes: true }).catch(() => []);
  for (const dir of dirs) {
    if (!dir.isDirectory() || !/^[a-f0-9]{24}$/.test(dir.name)) continue;
    const files = await readdir(path.join(/*turbopackIgnore: true*/ base, dir.name)).catch(() => [] as string[]);
    for (const name of files) {
      const key = `events/${dir.name}/${name}`;
      const isKey = isValidMediaKey(key);
      const isTmp = /\.tmp$/.test(name) && isValidMediaKey(key.replace(/\.\d+\.tmp$/, ""));
      if (!isKey && !isTmp) continue;
      const file = path.join(/*turbopackIgnore: true*/ base, dir.name, name);
      const info = await stat(file).catch(() => null);
      if (info?.isFile()) out.push({ key: isKey ? key : null, file, modifiedAt: info.mtime });
    }
  }
  return out;
}

/** Remove a leftover temp file found by `listMediaFiles`. */
export async function removeMediaTemp(file: string): Promise<void> {
  const full = path.resolve(/*turbopackIgnore: true*/ file);
  if (!full.startsWith(mediaRoot() + path.sep) || !full.endsWith(".tmp")) throw new Error("Invalid media path");
  await unlink(full).catch(() => {});
}
