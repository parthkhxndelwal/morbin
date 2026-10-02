"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { PASSWORD_RULES_TEXT } from "@/lib/validations";

export function LoginForm({ googleEnabled, callbackUrl = "/dashboard" }: { googleEnabled: boolean; callbackUrl?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
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
      callbackUrl,
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
    window.location.href = res?.url ?? callbackUrl;
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to manage your events, or to see tickets you booked with this email.
        </p>
      </div>

      <form onSubmit={onSubmit}>
        <FieldGroup>
          {googleEnabled && (
            <>
              <Field>
                <Button type="button" variant="outline" className="w-full" onClick={() => signIn("google", { callbackUrl })}>
                  <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
                    <path d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.28 12 6.28c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.7 3.9 14.56 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.59-.06-1.04-.29-1.1Z" />
                  </svg>
                  Continue with Google
                </Button>
              </Field>
              <FieldSeparator>or</FieldSeparator>
            </>
          )}
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              aria-describedby="password-rules"
            />
            <FieldDescription id="password-rules">Passwords are {PASSWORD_RULES_TEXT.charAt(0).toLowerCase() + PASSWORD_RULES_TEXT.slice(1)}</FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Checkbox id="remember" checked={remember} onCheckedChange={setRemember} />
            <FieldLabel htmlFor="remember" className="font-normal">
              Keep me signed in
            </FieldLabel>
          </Field>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Field>
            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {loading && <Spinner data-icon="inline-start" />}
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </Field>
        </FieldGroup>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Organising events?{" "}
        <a href="/apply" className="font-medium text-foreground underline underline-offset-4">
          List your event
        </a>
      </p>
    </div>
  );
}
