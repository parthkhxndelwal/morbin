"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function Verify() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"loading" | "ok" | "bad">(
    token ? "loading" : "bad",
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => {
        if (!cancelled) setState(r.ok ? "ok" : "bad");
      })
      .catch(() => {
        if (!cancelled) setState("bad");
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="w-full max-w-sm text-center">
      <Link href="/" className="text-lg font-extrabold lowercase tracking-tight">
        morbin
      </Link>
      <div className="mt-8 rounded-2xl border border-white/15 bg-white/5 p-6">
        {state === "loading" && <p className="text-sm text-neutral-300">Verifying…</p>}
        {state === "ok" && (
          <>
            <p className="font-semibold">Email verified.</p>
            <Link href="/login" className="mt-2 inline-block text-sm text-white underline">
              Sign in to continue
            </Link>
          </>
        )}
        {state === "bad" && (
          <p className="text-sm text-rose-300">This link is invalid or expired.</p>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#060614] px-6 font-sans text-white antialiased">
      <Suspense>
        <Verify />
      </Suspense>
    </div>
  );
}
