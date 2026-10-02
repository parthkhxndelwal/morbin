"use client";

import { CheckIcon, MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/patterns/confirm-action";
import { PromptAction } from "@/components/patterns/prompt-action";
import type { PayoutDetail } from "@/lib/dashboard-data";
import { acknowledgePayoutAction, raiseQueryAction } from "./actions";

/** Acknowledge / raise a query — only offered once the payout has been transferred. */
export function OwnerPayoutActions({ payout }: { payout: PayoutDetail }) {
  const canAck = payout.status === "PAID" || payout.status === "RESOLVED";
  const canQuery = canAck || payout.status === "DISPUTED";
  if (!canQuery) return null;
  return (
    <>
      <PromptAction
        trigger={
          <Button variant="outline">
            <MessageSquareIcon data-icon="inline-start" />
            {payout.status === "DISPUTED" ? "Add to query" : "Raise a query"}
          </Button>
        }
        title="Something doesn't add up?"
        description="Morbin's team will review the statement and reply here."
        label="What looks wrong"
        multiline
        minLength={5}
        confirmLabel="Send"
        action={(message) => raiseQueryAction(payout.id, message)}
      />
      {canAck && (
        <ConfirmAction
          trigger={
            <Button>
              <CheckIcon data-icon="inline-start" />
              Acknowledge
            </Button>
          }
          title="Acknowledge this payout?"
          description="Confirms you received the amount and the statement matches your records."
          confirmLabel="Acknowledge"
          action={() => acknowledgePayoutAction(payout.id)}
        />
      )}
    </>
  );
}
