import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The Morbin wordmark as text: follows the theme (no light/dark image pair to
 * keep in sync) and needs no extra request.
 */
export function BrandMark({ className, href = "/" }: { className?: string; href?: string | null }) {
  const mark = (
    <span className={cn("text-lg font-extrabold lowercase tracking-tight text-foreground", className)}>
      morbin
    </span>
  );
  return href ? (
    <Link href={href} aria-label="Morbin home" className="inline-flex rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
      {mark}
    </Link>
  ) : (
    mark
  );
}
