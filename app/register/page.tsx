"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fields = body.issues?.fieldErrors as
          | Record<string, string[]>
          | undefined;
        const detail = fields
          ? Object.values(fields)
              .flat()
              .join(" ")
          : null;
        setError(detail ?? body.error ?? "Registration failed.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#060614] px-6 font-sans text-white antialiased">
      <div className="w-full max-w-sm">
        <Link href="/" className="text-lg font-extrabold lowercase tracking-tight">
          morbin
        </Link>
        <h1 className="mt-8 text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="mt-1 text-sm text-neutral-400">Start organizing events in minutes.</p>
        {done ? (
          <div className="mt-6 rounded-2xl border border-white/15 bg-white/5 p-5 text-sm">
            <p className="font-semibold">Check your inbox.</p>
            <p className="mt-1 text-neutral-400">
              We sent a verification link to {email}. Verify, then{" "}
              <Link href="/login" className="text-white underline">
                sign in
              </Link>
              .
            </p>
          </div>
        ) : (
          <>
            <button
              onClick={() => signIn("google", { callbackUrl: "/onboarding" })}
              className="mt-6 w-full rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold transition-colors hover:bg-white/10"
            >
              Continue with Google
            </button>
            <div className="my-5 flex items-center gap-3 text-xs text-neutral-500">
              <span className="h-px flex-1 bg-white/10" /> or{" "}
              <span className="h-px flex-1 bg-white/10" />
            </div>
            <form onSubmit={onSubmit} className="space-y-3">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                autoComplete="name"
                required
                minLength={2}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-neutral-500 focus:border-violet-400/60"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-neutral-500 focus:border-violet-400/60"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (8+ chars, 1 uppercase, 1 number)"
                autoComplete="new-password"
                required
                minLength={8}
                className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-neutral-500 focus:border-violet-400/60"
              />
              {error && <p className="text-sm text-rose-300">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-full bg-white px-5 py-3 text-sm font-bold text-neutral-950 transition-colors hover:bg-violet-200 disabled:opacity-60"
              >
                {loading ? "Creating…" : "Create account"}
              </button>
            </form>
          </>
        )}
        <p className="mt-6 text-center text-sm text-neutral-400">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-white hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
