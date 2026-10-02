import Image from "next/image";
import Link from "next/link";

/** Intrinsic size of public/morbin-logo.png. Used for the layout box. */
const INTRINSIC = { width: 843, height: 296 } as const;

/**
 * The Morbin wordmark.
 *
 * Rendered from the artwork rather than as styled text, so the letterforms stay
 * identical everywhere. The source PNG is white on a transparent background,
 * which is what this app's dark surfaces need.
 *
 * Sizing: the image is given its true intrinsic dimensions and the rendered
 * height is applied in CSS. The browser then derives the width from the real
 * aspect ratio instead of a rounded one, so the wordmark is never distorted
 * however it is scaled.
 */
export function Logo({
  height = 24,
  className,
  priority = false,
  linkTo = "/",
}: {
  /** Rendered height in px. Width follows the artwork's aspect ratio. */
  height?: number;
  className?: string;
  priority?: boolean;
  /** Pass null to render the image without wrapping it in a link. */
  linkTo?: string | null;
}) {
  const image = (
    <Image
      src="/morbin-logo.png"
      alt="Morbin"
      width={INTRINSIC.width}
      height={INTRINSIC.height}
      priority={priority}
      // Height is set in CSS and width is left to follow the aspect ratio.
      style={{ height, width: "auto" }}
      className={className}
    />
  );

  if (!linkTo) return image;
  return (
    <Link
      href={linkTo}
      className="inline-block shrink-0 leading-none"
      aria-label="Morbin home"
    >
      {image}
    </Link>
  );
}