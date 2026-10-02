"use client";

import { PlayIcon } from "lucide-react";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { DateTime } from "@/components/patterns/money";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { runRetentionAction } from "./actions";

export interface RetentionRunView {
  startedAt: string | null;
  finishedAt: string | null;
  trigger: "SCHEDULE" | "ADMIN" | null;
  running: boolean;
  error: string | null;
  counts: Record<string, number> | null;
}

const LABELS: Record<string, string> = {
  events: "Events anonymised",
  orders: "Orders",
  tickets: "Tickets",
  ticketPdfs: "Ticket PDFs deleted",
  checkoutSessions: "Abandoned checkouts",
  emailMeta: "Email contents stripped",
  orphanMedia: "Unused uploads",
  invoices: "Invoices past 8 years",
  auditLogs: "Audit entries past 8 years",
  notifications: "Old notifications",
};

/** The daily DPDP retention job: when it last ran, what it did, and a manual run. */
export function RetentionCard({ run, defaultMonths }: { run: RetentionRunView | null; defaultMonths: number }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Data retention</CardTitle>
        <CardDescription>
          Runs daily. Attendee data is anonymised {defaultMonths} months after an event ends (or the organisation&apos;s own
          period); invoices and the ledger are kept.
        </CardDescription>
        <CardAction>
          <ConfirmAction
            trigger={
              <Button variant="outline" size="sm" disabled={run?.running}>
                <PlayIcon data-icon="inline-start" />
                Run now
              </Button>
            }
            title="Run retention now?"
            description="Anonymises attendee data past retention and removes expired records. Safe to run any time; it never changes amounts, invoices or the ledger."
            confirmLabel="Run now"
            action={runRetentionAction}
          />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {run?.error && (
          <Alert variant="destructive">
            <AlertDescription>The last run failed: {run.error}</AlertDescription>
          </Alert>
        )}
        {run?.running ? (
          <p className="text-muted-foreground">Running now…</p>
        ) : run?.finishedAt ? (
          <p className="text-muted-foreground">
            Last run <DateTime value={run.finishedAt} mode="relative" /> ({run.trigger === "ADMIN" ? "by an admin" : "scheduled"}).
          </p>
        ) : (
          <p className="text-muted-foreground">Hasn&apos;t run yet.</p>
        )}
        {run?.counts && (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {Object.entries(LABELS).map(([k, label]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{run.counts?.[k] ?? 0}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
