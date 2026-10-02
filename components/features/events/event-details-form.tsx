"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldSeparator } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { ActionForm } from "@/components/patterns/action-form";
import { formatINR } from "@/lib/format";
import { computePricing, type FeeBearer } from "@/lib/pricing";
import { updateEventDetailsAction } from "./actions";
import { EventFields, type EventFieldValues } from "./event-fields";

/** Edit an event's details, public URL and (per event) who pays the convenience fee. */
export function EventDetailsForm({
  eventId,
  defaults,
  slug,
  feeBearer,
  orgFeeBearer,
  feeBps,
  gstBps,
  disabled,
  appOrigin,
}: {
  eventId: string;
  defaults: EventFieldValues;
  slug: string;
  /** This event's override, or null to follow the organisation. */
  feeBearer: FeeBearer | null;
  orgFeeBearer: FeeBearer;
  feeBps: number;
  gstBps: number;
  disabled: boolean;
  appOrigin: string;
}) {
  const example = (bearer: FeeBearer) =>
    computePricing([{ unitPricePaise: 50_000, quantity: 1 }], { feeBps, gstBps, bearer });
  const describe = (bearer: FeeBearer) => {
    const p = example(bearer);
    return `a ₹500 ticket costs the buyer ${formatINR(p.orderTotalPaise)} and you receive ${formatINR(p.organiserNetPaise)}.`;
  };
  const percent = (feeBps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Event details</CardTitle>
        <CardDescription>What buyers see on the event page and in their tickets.</CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm
          action={(fd) => updateEventDetailsAction(eventId, fd)}
          disabled={disabled}
          successMessage="Event details saved"
        >
          {(errors) => (
            <>
              <EventFields errors={errors} defaults={defaults} />
              <FieldSeparator />
              <FieldGroup>
                <Field data-invalid={!!errors.slug || undefined}>
                  <FieldLabel htmlFor="event-slug">Public link</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <InputGroupText>{appOrigin.replace(/^https?:\/\//, "").replace(/\/$/, "")}/event/</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput id="event-slug" name="slug" defaultValue={slug} />
                  </InputGroup>
                  <FieldDescription>
                    Lowercase letters, numbers and dashes. Changing it breaks links and QR codes already shared.
                  </FieldDescription>
                  <FieldError>{errors.slug}</FieldError>
                </Field>
                <Field>
                  <FieldLabel htmlFor="event-fee-bearer">Convenience fee ({percent}% incl. GST)</FieldLabel>
                  <NativeSelect id="event-fee-bearer" name="feeBearer" defaultValue={feeBearer ?? "DEFAULT"}>
                    <NativeSelectOption value="DEFAULT">
                      Organisation default ({orgFeeBearer === "CUSTOMER" ? "buyer pays" : "we absorb it"})
                    </NativeSelectOption>
                    <NativeSelectOption value="CUSTOMER">Buyer pays it on top</NativeSelectOption>
                    <NativeSelectOption value="ORGANISER">We absorb it</NativeSelectOption>
                  </NativeSelect>
                  <FieldDescription>
                    Buyer pays: {describe("CUSTOMER")} We absorb: {describe("ORGANISER")} Applies to new orders only.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </>
          )}
        </ActionForm>
      </CardContent>
    </Card>
  );
}
