import Link from "next/link";
import { EarlyAccessForm } from "@/components/early-access-form";
import { HeroTitle } from "@/components/hero-title";
import { LightTunnel } from "@/components/light-tunnel";

export default function Home() {
  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-[#060614] font-sans text-white antialiased">
      {/* light tunnel backdrop */}
      <div className="absolute inset-0">
        <LightTunnel
          cableColor="#6a00ce"
          pulseColor="#994cf7"
          tunnelColor="#9802c0"
          tunnelOpacity={0.97}
          speed={0.1}
          flowDirection="outward"
          pulseSpeed={1.9}
          pulseLength={0.42}
          pulseBlend={1}
          pulseWidth={1}
          cableCount={37}
          thickness={0.1}
          rimWidth={0.03}
          waviness={0.3}
          sway={0.16}
          size={1.75}
          centerX={-0.03}
          centerY={0.05}
          glow={0.6}
          fadeNear={0.36}
          fadeFar={1.95}
          brightness={0.65}
          colorVariance={false}
          grain={false}
          grainIntensity={0}
          opacity={0.46}
          mouseInteraction={false}
          mouseStrength={0}
        />
      </div>
      {/* legibility gradient — keeps text readable over the tunnel */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#060614] via-[#060614]/55 to-transparent"
      />

      {/* logo only — no nav */}
      <header className="relative z-10 mx-auto w-full max-w-7xl shrink-0 px-6 pt-5 sm:px-10 sm:pt-7">
        <span className="text-base font-extrabold lowercase tracking-tight sm:text-lg">morbin</span>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-7xl min-h-0 flex-1 items-center px-6 sm:px-10">
        <div className="w-full max-w-xl py-4">
          <HeroTitle />
          <p className="mt-4 max-w-md text-[clamp(0.9rem,2.5vw,1.125rem)] leading-relaxed text-slate-400 [@media(max-height:700px)]:mt-2 [@media(max-height:700px)]:hidden sm:[@media(max-height:700px)]:block">
            We&apos;re building something new for people who bring people
            together. Morbin is in stealth — join the list to get in early.
          </p>
          <div className="mt-6 max-w-md [@media(max-height:700px)]:mt-4">
            <EarlyAccessForm compact />
          </div>
        </div>
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-7xl shrink-0 flex-col gap-1.5 px-6 pb-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:pb-7">
        <p>© 2026 Morbin. All rights reserved.</p>
        <div className="flex gap-5">
          <Link href="/privacy" className="transition-colors hover:text-slate-300">
            Privacy Policy
          </Link>
          <Link href="/terms" className="transition-colors hover:text-slate-300">
            Terms &amp; Conditions
          </Link>
        </div>
      </footer>
    </div>
  );
}
