"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2Icon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Spends an email-verification token once. The ref guards against React's
 * development double-mount; the request is not aborted on cleanup, so the
 * first (and only) call always lands.
 */
export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<"loading" | "ok" | "bad">(token ? "loading" : "bad");
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => setState(r.ok ? "ok" : "bad"))
      .catch(() => setState("bad"));
  }, [token]);

  if (state === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Spinner /> Verifying your email…
      </p>
    );
  }
  if (state === "ok") {
    return (
      <div className="space-y-4" role="status">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <CheckCircle2Icon className="size-6 text-primary" /> Email verified
        </h1>
        <Button className="w-full" nativeButton={false} render={<Link href="/auth" />}>
          Sign in to continue
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4" role="alert">
      <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
        <XCircleIcon className="size-6 text-destructive" /> Link not valid
      </h1>
      <p className="text-sm text-muted-foreground">This verification link is invalid or has expired. Sign in to get a new one.</p>
      <Button variant="outline" className="w-full" nativeButton={false} render={<Link href="/auth" />}>
        Go to sign in
      </Button>
    </div>
  );
}
