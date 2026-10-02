/**
 * Public URL for a stored media object.
 *
 * Split from `lib/media.ts` so client components can build an image `src`
 * without pulling that module's filesystem access into the browser bundle.
 * Media is served from this app's own origin (`app/media/[...key]`), so the URL
 * is a relative path and never points at a third-party host.
 */
export function publicMediaUrl(key: string): string {
  return `/media/${key}`;
}
