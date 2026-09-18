"use client";

import Link from "next/link";
import { useState } from "react";
import { signIn } from "next-auth/react";

type Field = "name" | "email" | "password";

const baseInput =
  "w-full rounded-xl border bg-white/5 px-4 py-3 text-sm outline-none placeholder:text-neutral-500";
const okBorder = "border-white/15 focus:border-violet-400/60";
const errBorder = "border-rose-400/70 focus:border-rose-300";

export default function RegisterPage() {
  const [values, setValues] = useState({ name: "", email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState("");
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  function set<K extends Field>(field: K, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    // Clear the field's error as soon as the user edits it.
    setFieldErrors((e) => {
      if (!e[field]) return e;
      const next = { ...e };
      delete next[field];
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFieldErrors({});
    setFormError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const fields = body.issues?.fieldErrors as
          | Partial<Record<Field, string[]>>
          | undefined;
        if (fields && (fields.name ?? fields.email ?? fields.password)) {
          setFieldErrors({
            ...(fields.name?.length ? { name: fields.name.join(" ") } : {}),
            ...(fields.email?.length ? { email: fields.email.join(" ") } : {}),
            ...(fields.password?.length ? { password: fields.password.join(" ") } : {}),
          });
          return;
        }
        setFormError(body.error ?? "Registration failed.");
        return;
      }
      setDone(true);
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function field(field: Field, props: React.InputHTMLAttributes<HTMLInputElement>) {
    const hasError = !!fieldErrors[field];
    return (
      <div>
        <input
          {...props}
          value={values[field]}
          onChange={(e) => set(field, e.target.value)}
          aria-invalid={hasError}
          className={`${baseInput} ${hasError ? errBorder : okBorder}`}
        />
        {hasError && (
          <p role="alert" className="mt-1.5 text-xs text-rose-300">
            {fieldErrors[field]}
          </p>
        )}
      </div>
    );
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
              We sent a verification link to {values.email}. Verify, then{" "}
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
            <form onSubmit={onSubmit} noValidate className="space-y-3">
              {field("name", {
                placeholder: "Full name",
                autoComplete: "name",
              })}
              {field("email", {
                type: "email",
                placeholder: "you@example.com",
                autoComplete: "email",
              })}
              {field("password", {
                type: "password",
                placeholder: "Password (8+ chars, 1 uppercase, 1 number)",
                autoComplete: "new-password",
              })}
              {formError && (
                <p role="alert" className="text-sm text-rose-300">
                  {formError}
                </p>
              )}
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
