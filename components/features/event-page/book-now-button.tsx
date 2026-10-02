"use client";

import { useSyncExternalStore } from "react";
import GlassSurface from "@/components/GlassSurface";
import { cn } from "@/lib/utils";

/**
 * The public event page's Book-now call to action: React Bits' GlassSurface
 * with the owner's exact settings (issue #7 — not to be tuned), wrapped in a
 * real <button> so it's keyboard-focusable with a visible focus ring.
 *
 * Falls back to a solid accent button when the browser can't do
 * backdrop-filter at all, or the visitor asked for reduced motion or reduced
 * transparency. Safari and Firefox, which lack SVG backdrop filters, get
 * GlassSurface's own frosted-glass fallback.
 */
export const GLASS_SETTINGS = {
  saturation: 1.6,
  opacity: 0.9,
  distortionScale: 130,
  blueOffset: 2,
  borderRadius: 49,
  borderWidth: 0.08,
  blur: 8,
  redOffset: 14,
  backgroundOpacity: 0.45,
  displace: 2.9,
  brightness: 48,
  greenOffset: 16,
} as const;

const REDUCE_QUERY = "(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(REDUCE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** null until hydrated (server render), then whether the glass may be used. */
function useGlassAllowed(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => !window.matchMedia(REDUCE_QUERY).matches && CSS.supports("backdrop-filter", "blur(1px)"),
    () => null,
  );
}

export function BookNowButton({
  label,
  detail,
  eventTitle,
  accentColor,
  onClick,
  onPrefetch,
  className,
  height = 56,
}: {
  label: string;
  /** Secondary text on the right, e.g. the price. */
  detail?: string | null;
  eventTitle: string;
  accentColor: string;
  onClick: () => void;
  /** Hover / focus / touch: warm up whatever the click will need. */
  onPrefetch?: () => void;
  className?: string;
  height?: number;
}) {
  const glass = useGlassAllowed();
  const ring =
    "rounded-[49px] outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  if (!glass) {
    // Also the server render, so the button is usable before hydration finishes.
    return (
      <button
        type="button"
        onClick={onClick}
        onPointerEnter={onPrefetch}
        onFocus={onPrefetch}
        onTouchStart={onPrefetch}
        aria-label={`${label} — ${eventTitle}`}
        className={cn(
          ring,
          "flex w-full items-center justify-between gap-3 px-7 text-base font-semibold text-white shadow-lg transition-transform active:scale-[0.99]",
          !detail && "justify-center",
          className,
        )}
        style={{ backgroundColor: accentColor, height }}
      >
        <span>{label}</span>
        {detail && <span className="text-sm font-medium text-white/85">{detail}</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPrefetch}
      onFocus={onPrefetch}
      onTouchStart={onPrefetch}
      aria-label={`${label} — ${eventTitle}`}
      className={cn(ring, "group block w-full transition-transform active:scale-[0.99]", className)}
    >
      <GlassSurface {...GLASS_SETTINGS} width="100%" height={height}>
        <span className={cn("flex w-full items-center gap-3 px-5", detail ? "justify-between" : "justify-center")}>
          <span className="text-base font-semibold text-foreground drop-shadow-sm">{label}</span>
          {detail && <span className="text-sm font-medium text-muted-foreground">{detail}</span>}
        </span>
      </GlassSurface>
    </button>
  );
}
