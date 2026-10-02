"use client";

import { MailCheckIcon } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { CheckoutState } from "./types";

/**
 * Prove who's booking: Google (a popup, so this tab keeps its place), a
 * one-time email link to an address the buyer types, or — for an ID check
 * with an email template — a link to the address the dataset row implies.
 */
export function IdentityStep({
  state,
  googleBusy,
  linkSent,
  resendIn,
  onGoogle,
  onRequestLink,
}: {
  state: CheckoutState;
  googleBusy: boolean;
  linkSent: boolean;
  resendIn: number;
  onGoogle: () => void;
  onRequestLink: (address: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const derived = state.identity.lookupEmail;

  async function send(address: string) {
    setSending(true);
    await onRequestLink(address);
    setSending(false);
  }

  const sentNote = linkSent && (
    <Alert>
      <MailCheckIcon />
      <AlertDescription>Check your inbox. The link works once and expires in 15 minutes.</AlertDescription>
    </Alert>
  );
  const sendLabel = linkSent && resendIn > 0 ? `Resend in ${resendIn}s` : linkSent ? "Resend the link" : "Send me a link";

  if (state.identity.method === "GOOGLE") {
    return (
      <div className="space-y-4">
        <Heading>Your ticket and QR code go to the email on your Google account.</Heading>
        <Button variant="outline" size="lg" className="w-full" onClick={onGoogle} disabled={googleBusy}>
          {googleBusy && <Spinner data-icon="inline-start" />}
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

  if (derived) {
    return (
      <div className="space-y-4">
        <Heading>
          We&apos;ll send a one-time link to <span className="font-medium text-foreground">{derived}</span>, the address on
          file for your ID. Your ticket goes there too.
        </Heading>
        <Button size="lg" className="w-full" onClick={() => send("")} disabled={sending || resendIn > 0}>
          {sending && <Spinner data-icon="inline-start" />}
          {sendLabel}
        </Button>
        {sentNote}
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
      <Heading>We&apos;ll email you a one-time link to confirm it&apos;s you. Your ticket goes to the same address.</Heading>
      <Field>
        <FieldLabel htmlFor="checkout-email">Email</FieldLabel>
        <Input
          id="checkout-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
          placeholder="you@college.edu"
        />
        <FieldDescription>Use the address your organiser asked for, e.g. your college email.</FieldDescription>
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={sending || !email.includes("@") || resendIn > 0}>
        {sending && <Spinner data-icon="inline-start" />}
        {sendLabel}
      </Button>
      {sentNote}
    </form>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h3 className="text-base font-semibold">Confirm it&apos;s you</h3>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
