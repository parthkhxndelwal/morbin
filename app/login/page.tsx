"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";

function LoginForm() {
  const registered = useSearchParams().get("registered") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/onboarding",
    });
    setLoading(false);
    if (res?.error) {
      if (res.error === "EMAIL_NOT_VERIFIED") {
        // Auto-renew the verification link so the user is never stuck.
        try {
          await fetch("/api/auth/resend-verification", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
        } catch {
          /* non-fatal */
        }
        setError(
          "Your email isn't verified yet — we just sent a fresh verification link. Check your inbox, then sign in.",
        );
      } else {
        setError("Invalid email or password.");
      }
      return;
    }
    window.location.href = res?.url ?? "/onboarding";
  }

  return (
    <div className="w-full max-w-sm">
      <Link href="/" className="text-lg font-extrabold lowercase tracking-tight">
        morbin
      </Link>
        <h1 className="mt-8 text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-neutral-400">Sign in to your organizer account.</p>
        {registered && (
          <p role="status" className="mt-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">
            Account created. Verify your email, then sign in below.
          </p>
        )}
        <button
          onClick={() => signIn("google", { callbackUrl: "/onboarding" })}
          className="mt-6 w-full rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold transition-colors hover:bg-white/10"
        >
          Continue with Google
        </button>
        <div className="my-5 flex items-center gap-3 text-xs text-neutral-500">
          <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-neutral-500 focus:border-violet-400/60"
          />
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-neutral-500 focus:border-violet-400/60"
          />
          {error && <p className="text-sm text-rose-300">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-white px-5 py-3 text-sm font-bold text-neutral-950 transition-colors hover:bg-violet-200 disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-neutral-400">
          New here?{" "}
          <Link href="/register" className="font-semibold text-white hover:underline">
            Create an account
          </Link>
        </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#060614] px-6 font-sans text-white antialiased">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
