"use client";

import { ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import type { CheckoutState } from "./types";

/**
 * The DPDP notice, shown before the buyer gives any personal data. Never
 * pre-ticked: ticking it is the consent, recorded server-side with the notice
 * version, and the step below stays disabled until then.
 */
export function ConsentNotice({
  privacy,
  onAccept,
}: {
  privacy: CheckoutState["privacy"];
  onAccept: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3 rounded-xl border bg-muted/40 p-3 text-sm">
      <p className="flex items-start gap-2">
        <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-muted-foreground">
          We&apos;ll collect your name, email and the details you enter, to issue your ticket and run this event. The
          organiser receives them; Amazon SES (email) and Razorpay (payments) process them for us.
        </span>
      </p>
      <details className="group rounded-lg bg-background/60 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium underline-offset-4 hover:underline">
          Read the full privacy notice
        </summary>
        <dl className="mt-2 space-y-2 text-xs">
          {privacy.notice.map((s) => (
            <div key={s.heading}>
              <dt className="font-medium">{s.heading}</dt>
              <dd className="text-muted-foreground">{s.body}</dd>
            </div>
          ))}
        </dl>
        <a href="/legal/privacy" target="_blank" className="mt-2 inline-block text-xs underline underline-offset-4">
          Privacy policy
        </a>
      </details>
      <label className="flex cursor-pointer items-center gap-2.5 font-medium">
        {busy ? (
          <Spinner className="size-4" />
        ) : (
          <Checkbox
            checked={false}
            onCheckedChange={async (checked) => {
              if (!checked || busy) return;
              setBusy(true);
              await onAccept();
              setBusy(false);
            }}
          />
        )}
        I agree to this use of my data
      </label>
    </div>
  );
}
