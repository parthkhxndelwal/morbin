"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(true);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((b) => {
        if (typeof b.google === "boolean") setGoogleEnabled(b.google);
      })
      .catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/dashboard",
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
    window.location.href = res?.url ?? "/dashboard";
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="mt-8 text-2xl font-bold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-neutral-400">Sign in to your organizer account.</p>
      <button
        onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
        className="mt-6 w-full rounded-full border border-white/15 bg-white/5 px-5 py-3 text-sm font-semibold transition-colors hover:bg-white/10"
        hidden={!googleEnabled}
      >
        Continue with Google
      </button>
      <div className="my-5 flex items-center gap-3 text-xs text-neutral-500" hidden={!googleEnabled}>
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
      <p className="mt-6 text-center text-xs text-neutral-500">
        Accounts are created by the Morbin team. Contact us to get set up.
      </p>
    </div>
  );
}
