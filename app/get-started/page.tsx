"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";

export default function GetStartedPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#060614] px-6 font-sans text-white antialiased">
      <div className="w-full max-w-sm text-center">
        <Link href="/" className="text-lg font-extrabold lowercase tracking-tight">
          morbin
        </Link>
        <h1 className="mt-8 text-2xl font-bold tracking-tight">Start organizing</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Create your organizer account to list events and get paid.
        </p>
        <button
          onClick={() => signIn("google", { callbackUrl: "/onboarding" })}
          className="mt-6 w-full rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold transition-colors hover:bg-white/10"
        >
          Continue with Google
        </button>
        <Link
          href="/register"
          className="mt-3 block w-full rounded-full bg-white px-5 py-3 text-sm font-bold text-neutral-950 transition-colors hover:bg-violet-200"
        >
          Continue with email
        </Link>
        <p className="mt-6 text-xs text-neutral-500">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline">Terms</Link> and{" "}
          <Link href="/privacy" className="underline">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
