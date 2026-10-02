"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export function VerifyEmail({ token }: { token: string }) {
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

  if (state === "loading")
    return <p className="text-sm text-neutral-300">Verifying…</p>;

  if (state === "ok")
    return (
      <div className="space-y-3">
        <p className="font-semibold">Email verified.</p>
        <Link href="/auth" className="inline-block text-sm text-white underline">
          Sign in to continue
        </Link>
      </div>
    );

  return <p className="text-sm text-rose-300">This link is invalid or expired.</p>;
}