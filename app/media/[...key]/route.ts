import { mediaBucket } from "@/lib/media";

export const runtime = "nodejs";

/**
 * Serves organizer-uploaded images from local disk.
 *
 * Keys are content-addressed by a random UUID and never rewritten, so the
 * response is cacheable forever. `nosniff` plus the sniffed-on-upload content
 * type mean a stored file can only ever be rendered as an image.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const object = await mediaBucket().get(key.join("/"));
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(object.body), {
    headers: {
      "Content-Type": object.contentType,
      "Content-Length": String(object.body.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
