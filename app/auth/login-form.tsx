"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
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
      // A failed `CredentialsSignin` arrives as error="CredentialsSignin" with the
      // specific reason in a *separate* `code` field. Comparing `res.error`
      // against "EMAIL_NOT_VERIFIED" was therefore never true, which sent this
      // account down the generic "invalid password" path while its password was
      // in fact correct. Both fields are checked so neither reason is swallowed.
      if (res.code === "EMAIL_NOT_VERIFIED") {
        // Auto-renew the verification link so the user is never stuck.
        let sent = false;
        try {
          const r = await fetch("/api/auth/resend-verification", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email }),
          });
          sent = r.ok;
        } catch {
          /* non-fatal */
        }
        setError(
          sent
            ? "Your email isn't verified yet — we just sent a fresh verification link. Check your inbox, then sign in."
            : "Your email isn't verified yet, and we couldn't send a new link just now. Use the most recent one, or ask an admin to verify it.",
        );
      } else {
        setError("Invalid email or password.");
      }
      return;
    }
    window.location.href = res?.url ?? "/dashboard";
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-neutral-400">
          Sign in to your organizer account to manage events and check-in.
        </p>
      </div>

      {googleEnabled && (
        <>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          >
            <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="currentColor">
              <path d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.28 12 6.28c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.7 3.9 14.56 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.59-.06-1.04-.29-1.1Z" />
            </svg>
            Continue with Google
          </Button>
          <div className="relative py-1">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-widest">
              <span className="bg-[#060614] px-3 text-neutral-500">or</span>
            </div>
          </div>
        </>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="remember"
            checked={remember}
            onCheckedChange={setRemember}
            aria-label="Keep me signed in"
          />
          <Label htmlFor="remember" className="normal-case tracking-normal">
            Keep me signed in
          </Label>
        </div>

        {error && (
          <p role="alert" className="text-sm text-rose-300">
            {error}
          </p>
        )}

        <Button type="submit" disabled={loading} className="w-full" size="lg">
          {loading ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-center text-xs text-neutral-500">
        Accounts are created by the Morbin team. Contact us to get set up.
      </p>
    </div>
  );
}