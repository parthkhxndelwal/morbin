/**
 * Turn human text into a URL segment.
 *
 * Punctuation becomes a *separator* rather than being deleted. Deleting it lost
 * information and silently produced the wrong slug: "KRMU Ideas 4.0" collapsed to
 * `krmu-ideas-40`, which is indistinguishable from the year 2040 and does not
 * match the `krmu-ideas-4-0` link an organiser would print on a QR code.
 * Turning runs of punctuation into a single dash yields `krmu-ideas-4-0`.
 *
 * Only newly generated slugs change; slugs already stored are never rewritten.
 */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    // Any run of characters that cannot appear in a segment becomes a space, so
    // the collapse below folds "4.0", "hello — world" and "a/b" each into one dash.
    .replace(/[^\w\s-]+/g, " ")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Longest slug we will ever store. Bounded so a path segment stays sane. */
export const SLUG_MAX_LENGTH = 80;

/** A slug safe to put in a path: non-empty, dash-delimited, length-bounded. */
export function isValidSlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= SLUG_MAX_LENGTH &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

/**
 * Normalise an organiser-supplied slug, or fall back to deriving one from a
 * title. Returns null when the input cannot be made into a valid slug at all, so
 * the caller can reject it rather than storing something unroutable.
 */
export function normaliseSlug(input: string | undefined | null, fallbackTitle: string): string | null {
  const fromInput = slugify(input ?? "");
  const candidate = fromInput || slugify(fallbackTitle);
  if (!candidate) return null;
  return candidate.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "") || null;
}

/** Append a short random suffix: `krmu-ideas-4-0-a1b2c`. */
export function withSlugSuffix(slug: string): string {
  const suffix = Math.random().toString(36).slice(2, 7);
  const head = slug.slice(0, SLUG_MAX_LENGTH - suffix.length - 1).replace(/-+$/g, "");
  return `${head}-${suffix}`;
}
