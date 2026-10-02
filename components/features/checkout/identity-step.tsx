"use client";

import { MailIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { CheckoutState } from "./types";

/**
 * Prove who's booking without leaving the sheet: Google (a popup, so this tab
 * keeps its place), or a 6-digit code emailed to the buyer — typed here, or
 * the link in the same email tapped (the drawer notices and moves on by itself).
 * For an ID check with an email template the address is fixed by the server.
 */
export function IdentityStep({
  state,
  googleBusy,
  sentTo,
  resendIn,
  onGoogle,
  onSend,
  onCode,
}: {
  state: CheckoutState;
  googleBusy: boolean;
  /** The address a code was sent to, once sent. */
  sentTo: string | null;
  resendIn: number;
  onGoogle: () => void;
  onSend: (address: string) => Promise<void>;
  onCode: (code: string) => Promise<boolean>;
}) {
  const derived = state.identity.lookupEmail;
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  async function send(address: string) {
    setSending(true);
    await onSend(address);
    setSending(false);
  }

  if (state.identity.method === "GOOGLE") {
    return (
      <div className="space-y-4">
        <Lead>Continue with Google — your ticket goes to your Google account&apos;s email.</Lead>
        <Button variant="outline" size="lg" className="h-12 w-full" onClick={onGoogle} disabled={googleBusy}>
          {googleBusy ? <Spinner data-icon="inline-start" /> : <GoogleMark />}
          {googleBusy ? "Waiting for Google…" : "Continue with Google"}
        </Button>
        {googleBusy && (
          <p className="text-center text-xs text-muted-foreground">
            Closed the window by mistake?{" "}
            <button type="button" onClick={onGoogle} className="underline underline-offset-4">
              Try again
            </button>
          </p>
        )}
      </div>
    );
  }

  if (sentTo) {
    return <CodeEntry sentTo={sentTo} resendIn={resendIn} onCode={onCode} onResend={() => send(derived ? "" : sentTo)} />;
  }

  if (derived) {
    return (
      <div className="space-y-4">
        <Lead>
          We&apos;ll send a code to <span className="font-medium text-foreground">{derived}</span>, the address on file for
          your ID. Your ticket goes there too.
        </Lead>
        <Button size="lg" className="h-12 w-full" onClick={() => send("")} disabled={sending}>
          {sending ? <Spinner data-icon="inline-start" /> : <MailIcon data-icon="inline-start" />}
          Send my code
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send(email);
      }}
    >
      <Lead>Enter your email — we&apos;ll send a code to confirm it. Your ticket goes there too.</Lead>
      <Field>
        <FieldLabel htmlFor="checkout-email" className="sr-only">
          Email
        </FieldLabel>
        <Input
          id="checkout-email"
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          placeholder="you@example.com"
          className="h-12 text-base"
        />
        <FieldDescription>If your organiser asked for a college email, use that.</FieldDescription>
      </Field>
      <Button type="submit" size="lg" className="h-12 w-full" disabled={sending || !email.includes("@")}>
        {sending && <Spinner data-icon="inline-start" />}
        Send my code
      </Button>
    </form>
  );
}

/** Six digits, submitted as soon as the sixth is typed (or pasted). */
function CodeEntry({
  sentTo,
  resendIn,
  onCode,
  onResend,
}: {
  sentTo: string;
  resendIn: number;
  onCode: (code: string) => Promise<boolean>;
  onResend: () => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(value: string) {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    const ok = await onCode(value);
    setBusy(false);
    if (!ok) setCode("");
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(code);
      }}
    >
      <Lead>
        Enter the 6-digit code we sent to <span className="font-medium text-foreground">{sentTo}</span>. Or tap the link
        in that email — this page will move on by itself.
      </Lead>
      <Field>
        <FieldLabel htmlFor="checkout-code" className="sr-only">
          6-digit code
        </FieldLabel>
        <Input
          id="checkout-code"
          autoFocus
          value={code}
          onChange={(e) => {
            const next = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(next);
            if (next.length === 6) void submit(next);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="••••••"
          className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
          disabled={busy}
        />
      </Field>
      <Button type="submit" size="lg" className="h-12 w-full" disabled={busy || code.length !== 6}>
        {busy && <Spinner data-icon="inline-start" />}
        Confirm
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        Nothing yet? Check spam, or{" "}
        <button
          type="button"
          className="underline underline-offset-4 disabled:no-underline disabled:opacity-60"
          disabled={resendIn > 0}
          onClick={() => void onResend()}
        >
          {resendIn > 0 ? `resend in ${resendIn}s` : "send a new code"}
        </button>
      </p>
    </form>
  );
}

function Lead({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4" fill="currentColor">
      <path d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.28 12 6.28c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.7 3.9 14.56 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.2 0 8.64-3.65 8.64-8.8 0-.59-.06-1.04-.29-1.1Z" />
    </svg>
  );
}
