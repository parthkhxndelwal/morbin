"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ActionForm } from "@/components/patterns/action-form";
import { formatINR } from "@/lib/format";
import type { FeeBearer } from "@/lib/pricing";
import { setFeeBearerAction } from "./actions";

/** Secondary weight on a headline figure, so the two parts read as one line. */
const MUTED = "text-sm font-normal text-muted-foreground";

/** The ₹500 worked example for each arrangement, priced by the server. */
export interface FeeExample {
  /** What the buyer is charged for a ₹500 ticket. */
  orderTotalPaise: number;
  /** What the organisation receives from that ticket. */
  organiserNetPaise: number;
  /** The fee itself, GST-inclusive. */
  feePaise: number;
}

/**
 * Who bears the convenience fee.
 *
 * The rate is Morbin's to set and is shown, never submitted — there is no
 * `feeBps` input in this form, so an owner cannot post one. Both worked
 * examples are priced on the server by `lib/pricing.ts` and arrive ready to
 * render, so the browser picks a row rather than computing a price.
 */
export function FeeBearerForm({
  feePercent,
  gstPercent,
  isCustomRate,
  feeBearer,
  exampleCustomer,
  exampleOrganiser,
  disabled,
}: {
  feePercent: string;
  gstPercent: string;
  isCustomRate: boolean;
  feeBearer: FeeBearer;
  exampleCustomer: FeeExample;
  exampleOrganiser: FeeExample;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<FeeBearer>(feeBearer);
  const active = selected === "CUSTOMER" ? exampleCustomer : exampleOrganiser;
  const other = selected === "CUSTOMER" ? exampleOrganiser : exampleCustomer;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convenience fee</CardTitle>
        <CardDescription>
          Morbin takes a fee on every ticket sold. You choose who pays it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Read-only: the rate is the admin's to set, so it is not a form
            control and there is nothing here to submit. */}
        <dl className="mb-6 grid gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">Platform fee</dt>
            <dd className="text-base font-medium">
              {feePercent}% <span className={MUTED}>of the ticket price</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Includes GST</dt>
            <dd className="text-base font-medium">
              GST @ {gstPercent}% <span className={MUTED}>carved out of the fee</span>
            </dd>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            {isCustomRate
              ? "This rate is set for your organisation by Morbin. Ask your contact to change it."
              : "This is Morbin's standard rate. Ask your contact to change it."}{" "}
            It applies to new orders only — orders already placed keep the price they were
            charged.
          </p>
        </dl>

        <ActionForm
          action={setFeeBearerAction}
          disabled={disabled}
          submitLabel="Save choice"
          successMessage="Saved"
        >
          {(errors) => (
            <FieldGroup>
              <Field data-invalid={!!errors.feeBearer || undefined}>
                <FieldLabel htmlFor="org-fee-bearer">Who pays the fee?</FieldLabel>
                <NativeSelect
                  id="org-fee-bearer"
                  name="feeBearer"
                  value={selected}
                  onChange={(event) => setSelected(event.target.value as FeeBearer)}
                  aria-invalid={!!errors.feeBearer || undefined}
                >
                  <NativeSelectOption value="CUSTOMER">
                    Buyer pays it on top (convenience fee)
                  </NativeSelectOption>
                  <NativeSelectOption value="ORGANISER">
                    We absorb it (deducted from your payout)
                  </NativeSelectOption>
                </NativeSelect>
                <FieldError>{errors.feeBearer}</FieldError>
              </Field>

              {/* Priced on the server; this only shows one arrangement or the other. */}
              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground">On a ₹500.00 ticket</p>
                <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
                  <dt className="text-muted-foreground">The buyer pays</dt>
                  <dd className="font-medium tabular-nums">{formatINR(active.orderTotalPaise)}</dd>
                  <dt className="text-muted-foreground">You receive</dt>
                  <dd className="font-medium tabular-nums">
                    {formatINR(active.organiserNetPaise)}
                  </dd>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  The other way round, a buyer pays {formatINR(other.orderTotalPaise)} and you
                  receive {formatINR(other.organiserNetPaise)}.
                </p>
              </div>
            </FieldGroup>
          )}
        </ActionForm>
      </CardContent>
    </Card>
  );
}
