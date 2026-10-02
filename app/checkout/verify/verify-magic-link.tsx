"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type State =
  | { kind: "working" }
  | { kind: "done"; eventSlug: string | null }
  | { kind: "invalid"; reason: string; eventSlug: string | null; canRetry: boolean };

/**
 * Consumes a magic link and returns the buyer to their event.
 *
 * The token is spent by the server on the first attempt and never retried, so a
 * refresh — or an email client that pre-fetches the link — cannot burn it. The
 * `claimed` ref is the guard: React 18+ mounts effects twice in development, and
 * a second request would be reported as "already used" to a buyer who did
 * nothing wrong.
 */
export function VerifyMagicLink({ token }: { token: string }) {
  const [state, setState] = useState<State>(() =>
    token
      ? { kind: "working" }
      : {
          kind: "invalid",
          reason: "This link is missing its code. Request a new one from the event page.",
          eventSlug: null,
          canRetry: false,
        },
  );
  const claimed = useRef(false);

  useEffect(() => {
    if (!token || claimed.current) return;
    claimed.current = true;
    // Deliberately not aborted on cleanup: in development React runs this
    // effect twice, and aborting the first request while the ref blocks the
    // second left the page on "Confirming…" forever.
    (async () => {
      try {
        const res = await fetch(`/api/checkout/magic-link?token=${encodeURIComponent(token)}`);
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.ok) {
          setState({ kind: "done", eventSlug: body.eventSlug ?? null });
          return;
        }
        setState({
          kind: "invalid",
          reason:
            body.reason === "expired"
              ? "This link has expired. Request a new one — it only takes a moment."
              : body.reason === "attempts"
                ? "This link was locked after too many attempts. Request a new one."
                : "This link has already been used. If that wasn't you, request a new one.",
          eventSlug: body.eventSlug ?? null,
          canRetry: !!body.canRetry,
        });
      } catch {
        setState({
          kind: "invalid",
          reason: "We couldn't reach the server. Check your connection and try again.",
          eventSlug: null,
          canRetry: false,
        });
      }
    })();
  }, [token]);

  if (state.kind === "working") {
    return (
      <Frame>
        <p className="mt-8 text-sm text-neutral-400">Confirming your email…</p>
        <div className="mx-auto mt-5 h-1 w-24 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-violet-400" />
        </div>
      </Frame>
    );
  }

  if (state.kind === "done") {
    return (
      <Frame>
        <div className="mt-8 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-6">
          <p className="font-bold">Email confirmed</p>
          <p className="mt-1 text-sm text-neutral-300">Taking you back to your tickets…</p>
        </div>
        {state.eventSlug ? (
          <Link
            href={`/event/${state.eventSlug}?resume=1`}
            className="mt-5 inline-block text-sm font-semibold underline"
          >
            Continue
          </Link>
        ) : null}
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="mt-8 rounded-2xl border border-white/15 bg-white/5 p-6">
        <p className="font-bold">{state.reason}</p>
        {state.eventSlug ? (
          <Link
            href={`/event/${state.eventSlug}?resume=1`}
            className="mt-4 inline-block rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-950 hover:bg-violet-200"
          >
            {state.canRetry ? "Send a new link" : "Back to event"}
          </Link>
        ) : (
          <Link
            href="/"
            className="mt-4 inline-block text-sm font-semibold underline"
          >
            Go home
          </Link>
        )}
      </div>
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-[#060614] px-6 font-sans text-white antialiased">
      <div className="w-full max-w-sm text-center">
        <Link href="/" className="text-lg font-extrabold lowercase tracking-tight">
          morbin
        </Link>
        {children}
      </div>
    </div>
  );
}
