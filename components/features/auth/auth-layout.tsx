import Image from "next/image";
import { BrandMark } from "@/components/patterns/brand-mark";
import { cn } from "@/lib/utils";

/**
 * One frame for every /auth/* page and /apply: the brand mark, the content in a
 * column, and (on wide screens) a decorative panel. Colours come from the
 * theme tokens, so light and dark both work; mobile-first, with the panel
 * dropped below `lg`.
 *
 * The panel photo is self-hosted licensed stock, re-encoded without any
 * EXIF/XMP/IPTC metadata. It's decorative, so it has `alt=""` and the panel is
 * hidden from assistive tech.
 */
const PANEL_IMAGE = "/concert-crowd.jpg";

export function AuthLayout({
  children,
  wide = false,
  panel = true,
}: {
  children: React.ReactNode;
  /** A wider column, for longer forms such as /apply. */
  wide?: boolean;
  /** Show the decorative photo panel on large screens. */
  panel?: boolean;
}) {
  return (
    <div className={cn("min-h-dvh bg-background text-foreground", panel && "lg:grid lg:grid-cols-[1fr_minmax(0,40rem)]")}>
      <div className="flex min-h-dvh flex-col px-4 py-6 sm:px-10 lg:px-14 lg:py-10">
        <header>
          <BrandMark />
        </header>
        <main className="flex flex-1 items-center justify-center py-8">
          <div className={cn("w-full", wide ? "max-w-2xl" : "max-w-sm")}>{children}</div>
        </main>
      </div>
      {panel && (
        <aside aria-hidden className="relative hidden lg:block">
          <Image src={PANEL_IMAGE} alt="" fill priority sizes="40rem" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/10" />
          <div className="absolute inset-x-0 bottom-0 p-10 text-white">
            <p className="max-w-md text-2xl font-bold leading-snug tracking-tight">
              Ticketing for people who bring people together.
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/75">
              Create an event, publish it, and take payments — with tickets delivered and settled automatically.
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
