"use client";

import { FlaskConicalIcon, InfoIcon } from "lucide-react";
import { Money } from "@/components/patterns/money";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PriceBreakdown } from "./price-breakdown";
import type { CheckoutState } from "./types";

/** The summary and the pay button — or, in a builder test run, where paying would happen. */
export function PaymentStep({
  state,
  hasItems,
  paying,
  cancelled,
  onPay,
  onSwitchPerson,
  accentColor,
}: {
  state: CheckoutState;
  hasItems: boolean;
  paying: boolean;
  cancelled: boolean;
  onPay: () => void;
  onSwitchPerson: () => void;
  accentColor: string;
}) {
  const total = state.pricing.quote.orderTotalPaise;
  return (
    <div className="space-y-4">
      {hasItems && <PriceBreakdown pricing={state.pricing} />}
      {cancelled && (
        <Alert>
          <InfoIcon />
          <AlertTitle>Payment window closed</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>Nothing was charged. You can pay again, or continue as a different person.</p>
            <Button variant="outline" size="sm" onClick={onSwitchPerson}>
              Continue as someone else
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {state.testRun ? (
        <Alert>
          <FlaskConicalIcon />
          <AlertTitle>This is where the buyer would pay</AlertTitle>
          <AlertDescription>
            {hasItems ? (
              <>
                They&apos;d pay <Money paise={total} /> and get their tickets by email.
              </>
            ) : (
              "They'd choose tickets here first."
            )}{" "}
            Test runs never create orders, hold seats or send email.
          </AlertDescription>
        </Alert>
      ) : (
        <Button
          size="lg"
          className="w-full text-white"
          style={{ backgroundColor: accentColor }}
          onClick={onPay}
          disabled={paying || !hasItems || state.offer.soldOutForIdentity}
        >
          {paying && <Spinner data-icon="inline-start" />}
          {state.offer.soldOutForIdentity ? (
            "Not available for you"
          ) : paying ? (
            "Opening payment…"
          ) : !hasItems ? (
            "Select tickets"
          ) : total === 0 ? (
            "Get my ticket"
          ) : (
            <>
              {cancelled ? "Pay again" : "Continue to payment"} · <Money paise={total} />
            </>
          )}
        </Button>
      )}
    </div>
  );
}
