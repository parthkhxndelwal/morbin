"use client";

import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ActionForm } from "@/components/patterns/action-form";
import type { PlatformSettings } from "@/lib/types";
import { savePlatformSettingsAction } from "./actions";

type Values = Pick<PlatformSettings, "defaultFeeBps" | "defaultRetentionMonths" | "gst">;

function Text({
  name,
  label,
  defaultValue,
  error,
  hint,
  className,
}: {
  name: string;
  label: string;
  defaultValue: string;
  error?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <Field data-invalid={!!error || undefined} className={className}>
      <FieldLabel htmlFor={`ps-${name}`}>{label}</FieldLabel>
      <Input id={`ps-${name}`} name={name} defaultValue={defaultValue} aria-invalid={!!error || undefined} />
      {hint && <FieldDescription>{hint}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function PlatformSettingsForm({ values, gstReady }: { values: Values; gstReady: boolean }) {
  const g = values.gst;
  return (
    <ActionForm action={savePlatformSettingsAction} submitLabel="Save settings">
      {(errors) => (
        <div className="space-y-6">
          {!gstReady && (
            <Alert>
              <AlertTriangleIcon />
              <AlertTitle>Invoices can&apos;t be issued yet</AlertTitle>
              <AlertDescription>
                Fill in the legal name, GSTIN, address, state, state code and SAC. Until then, tickets are emailed
                without a tax invoice.
              </AlertDescription>
            </Alert>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Defaults for organisations</CardTitle>
              <CardDescription>Used when an organisation has no rate or retention of its own.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Text
                  name="defaultFee"
                  label="Platform fee, % including GST"
                  defaultValue={String(values.defaultFeeBps / 100)}
                  error={errors.defaultFee}
                  hint="New orders only; placed orders keep their fee."
                />
                <Text
                  name="defaultRetentionMonths"
                  label="Keep attendee data for (months)"
                  defaultValue={String(values.defaultRetentionMonths)}
                  error={errors.defaultRetentionMonths}
                  hint="After the event ends, then anonymised."
                />
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>GST &amp; invoicing</CardTitle>
              <CardDescription>
                Printed on the tax invoice for the convenience fee. Changes apply to invoices issued from now on.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                <Text name="legalName" label="Legal name" defaultValue={g.legalName} error={errors.legalName} />
                <Text name="tradeName" label="Trade name" defaultValue={g.tradeName} error={errors.tradeName} />
                <Text name="gstin" label="GSTIN" defaultValue={g.gstin} error={errors.gstin} />
                <Text name="pan" label="PAN" defaultValue={g.pan} error={errors.pan} />
                <Field data-invalid={!!errors.address || undefined} className="sm:col-span-2">
                  <FieldLabel htmlFor="ps-address">Registered address</FieldLabel>
                  <Textarea id="ps-address" name="address" rows={2} defaultValue={g.address} />
                  <FieldError>{errors.address}</FieldError>
                </Field>
                <Text name="state" label="State" defaultValue={g.state} error={errors.state} />
                <Text name="stateCode" label="State code" defaultValue={g.stateCode} error={errors.stateCode} hint="e.g. 07 for Delhi" />
                <Text name="sac" label="SAC code" defaultValue={g.sac} error={errors.sac} hint="Service accounting code for the fee" />
                <Text name="gstRate" label="GST rate, %" defaultValue={String(g.rateBps / 100)} error={errors.gstRate} />
                <Field className="sm:col-span-2">
                  <FieldLabel htmlFor="ps-split">How tax is shown on invoices</FieldLabel>
                  <NativeSelect id="ps-split" name="splitRule" defaultValue={g.splitRule} className="w-full">
                    <NativeSelectOption value="SUPPLIER_STATE">CGST + SGST (place of supply: Morbin&apos;s state)</NativeSelectOption>
                    <NativeSelectOption value="ALWAYS_IGST">IGST</NativeSelectOption>
                  </NativeSelect>
                  <FieldDescription>Checkout always shows a single “GST” line. Confirm the split with your CA.</FieldDescription>
                </Field>
                <Text
                  name="invoicePrefix"
                  label="Invoice number prefix"
                  defaultValue={g.invoicePrefix}
                  error={errors.invoicePrefix}
                  hint="Numbers run per financial year, e.g. MRB/2026-27/000001"
                />
                <Field data-invalid={!!errors.footerText || undefined} className="sm:col-span-2">
                  <FieldLabel htmlFor="ps-footer">Footer text</FieldLabel>
                  <Textarea id="ps-footer" name="footerText" rows={2} defaultValue={g.footerText} />
                  <FieldError>{errors.footerText}</FieldError>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        </div>
      )}
    </ActionForm>
  );
}
