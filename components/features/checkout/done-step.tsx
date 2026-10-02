"use client";

import Link from "next/link";
import { CheckCircle2Icon, Clock3Icon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/** After paying (or a free order): confirmation, or waiting for Razorpay's webhook. */
export function DoneStep({
  email,
  slug,
  orderId,
  confirmed,
  onRetry,
}: {
  email: string;
  slug: string;
  orderId: string | null;
  /** A free order, or the webhook has marked it PAID. */
  confirmed: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-4">
      {confirmed ? (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>You&apos;re booked</AlertTitle>
          <AlertDescription>
            Your ticket{email ? ` is on its way to ${email}` : " is on its way"}.
            {orderId ? ` Order ${orderId.slice(-8).toUpperCase()}.` : ""}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert>
          <Clock3Icon />
          <AlertTitle>Waiting for your payment…</AlertTitle>
          <AlertDescription>
            This updates the moment Razorpay confirms. Your ticket goes to {email || "your email"} either way.
          </AlertDescription>
        </Alert>
      )}
      <Button variant="outline" className="w-full" nativeButton={false} render={<Link href={`/event/${slug}/tickets`} />}>
        View my tickets
      </Button>
      {!confirmed && (
        <button type="button" onClick={onRetry} className="block w-full text-center text-xs text-muted-foreground underline underline-offset-4">
          Not working? Try paying again
        </button>
      )}
    </div>
  );
}
