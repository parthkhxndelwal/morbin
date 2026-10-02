"use client";

import Link from "next/link";
import { CheckCircle2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/format";
import { confirmDataRequestAction } from "../actions";

export function ConfirmRequest({ token }: { token: string }) {
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(token ? null : "This link is incomplete. Open it from the email again.");
  const [pending, startTransition] = useTransition();

  if (dueAt) {
    return (
      <div className="space-y-3 py-6 text-center" role="status">
        <CheckCircle2Icon className="mx-auto size-10 text-primary" />
        <h2 className="text-lg font-semibold">Request confirmed</h2>
        <p className="text-sm text-muted-foreground">
          We&apos;ll email you the outcome by {formatDate(dueAt)} at the latest.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>
            {error}{" "}
            <Link href="/privacy/request" className="underline underline-offset-4">
              Start again
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <Button
        size="lg"
        className="w-full"
        disabled={!token || pending}
        onClick={() =>
          startTransition(async () => {
            const r = await confirmDataRequestAction(token).catch(() => null);
            if (r?.ok) setDueAt(r.data.dueAt);
            else setError(r?.error ?? "Something went wrong. Please try again.");
          })
        }
      >
        {pending && <Spinner data-icon="inline-start" />}
        Yes, it&apos;s me — confirm
      </Button>
    </div>
  );
}
