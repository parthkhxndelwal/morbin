import Image from "next/image";
import { Logo } from "@/components/logo";

/**
 * The shell for every /auth state: a form column on the left, and the Morbin
 * panel on the right. Split out so the sign-in, verify-email and pending
 * screens cannot drift apart visually.
 *
 * The panel is hidden on small screens, where the form takes the full width.
 *
 * Self-hosted rather than hotlinked: the source is licensed stock, so serving
 * it from /public avoids depending on a third party's signed URL, avoids
 * sending visitors to them, and keeps the photographer's EXIF/XMP/IPTC out of
 * every browser. The file in public/ was re-encoded to carry no metadata at all.
 * It is 612x408 — the largest size that source permits — so it is upscaled
 * slightly on wide viewports.
 */
const PANEL_IMAGE = "/concert-crowd.jpg";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-[#060614] font-sans text-white antialiased lg:grid lg:grid-cols-[1fr_minmax(0,45rem)]">
      <div className="flex flex-col px-6 py-8 sm:px-10 lg:px-14 lg:py-10">
        <Logo height={24} priority />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>

      {/* Decorative only: the subject is not meaningful, so it is hidden from
          assistive tech rather than described. */}
      <aside aria-hidden className="relative hidden lg:block">
        <Image
          src={PANEL_IMAGE}
          alt=""
          fill
          priority
          sizes="45rem"
          className="object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#060614] via-[#060614]/45 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#060614]/85 via-transparent to-[#060614]/25" />
        <div className="absolute inset-x-0 bottom-0 p-10">
          <p className="max-w-md text-2xl font-bold leading-snug tracking-tight">
            Ticketing for people who bring people together.
          </p>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-white/70">
            Create an event, publish it, and take payments — with tickets delivered
            and settled automatically.
          </p>
        </div>
      </aside>
    </div>
  );
}