"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { GST_STATES } from "@/lib/invoice-rules";
import { ActionForm } from "@/components/patterns/action-form";
import { updateOrgProfileAction } from "./actions";

/** Edit the organisation's profile — the fields Morbin puts on its paperwork. */
export function OrgProfileForm({
  defaults,
  disabled,
}: {
  defaults: {
    name: string;
    contactEmail: string;
    contactPhone: string;
    gstin: string;
    address: string;
    stateCode: string;
  };
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organisation profile</CardTitle>
        <CardDescription>
          The name buyers and Morbin see, and where your paperwork goes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ActionForm
          action={updateOrgProfileAction}
          disabled={disabled}
          successMessage="Organisation profile saved"
        >
          {(errors) => (
            <FieldGroup>
              <Field data-invalid={!!errors.name || undefined}>
                <FieldLabel htmlFor="org-name">Organisation name</FieldLabel>
                <Input
                  id="org-name"
                  name="name"
                  defaultValue={defaults.name}
                  aria-invalid={!!errors.name || undefined}
                  required
                />
                <FieldError>{errors.name}</FieldError>
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field data-invalid={!!errors.contactEmail || undefined}>
                  <FieldLabel htmlFor="org-contact-email">Contact email</FieldLabel>
                  <Input
                    id="org-contact-email"
                    name="contactEmail"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    defaultValue={defaults.contactEmail}
                    placeholder="accounts@example.com"
                    aria-invalid={!!errors.contactEmail || undefined}
                  />
                  <FieldDescription>
                    Invoices and payout statements are sent here.
                  </FieldDescription>
                  <FieldError>{errors.contactEmail}</FieldError>
                </Field>
                <Field data-invalid={!!errors.contactPhone || undefined}>
                  <FieldLabel htmlFor="org-contact-phone">Contact phone</FieldLabel>
                  <Input
                    id="org-contact-phone"
                    name="contactPhone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    defaultValue={defaults.contactPhone}
                    placeholder="+91 98765 43210"
                    aria-invalid={!!errors.contactPhone || undefined}
                  />
                  <FieldError>{errors.contactPhone}</FieldError>
                </Field>
              </div>
              <Field data-invalid={!!errors.gstin || undefined}>
                <FieldLabel htmlFor="org-gstin">GSTIN</FieldLabel>
                <Input
                  id="org-gstin"
                  name="gstin"
                  defaultValue={defaults.gstin}
                  placeholder="27AAPFU0939F1ZV"
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="uppercase"
                  aria-invalid={!!errors.gstin || undefined}
                />
                <FieldDescription>
                  Optional. Printed on the fee invoice Morbin issues to your
                  organisation when you absorb the convenience fee.
                </FieldDescription>
                <FieldError>{errors.gstin}</FieldError>
              </Field>
              <Field data-invalid={!!errors.address || undefined}>
                <FieldLabel htmlFor="org-address">Registered address</FieldLabel>
                <Textarea
                  id="org-address"
                  name="address"
                  rows={3}
                  defaultValue={defaults.address}
                  placeholder="Building, street, city, state, PIN"
                  aria-invalid={!!errors.address || undefined}
                />
                <FieldDescription>
                  Optional. Used on invoices and on the transfer advice.
                </FieldDescription>
                <FieldError>{errors.address}</FieldError>
              </Field>
              <Field data-invalid={!!errors.stateCode || undefined}>
                <FieldLabel htmlFor="org-state">State</FieldLabel>
                <NativeSelect
                  id="org-state"
                  name="stateCode"
                  defaultValue={defaults.stateCode}
                  className="w-full"
                  aria-invalid={!!errors.stateCode || undefined}
                >
                  <NativeSelectOption value="">Not set</NativeSelectOption>
                  {GST_STATES.map((s) => (
                    <NativeSelectOption key={s.code} value={s.code}>
                      {s.name} ({s.code})
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <FieldDescription>
                  Decides whether Morbin&apos;s fee invoice charges CGST + SGST
                  or IGST. With a GSTIN, it must match the GSTIN&apos;s state.
                </FieldDescription>
                <FieldError>{errors.stateCode}</FieldError>
              </Field>
            </FieldGroup>
          )}
        </ActionForm>
      </CardContent>
    </Card>
  );
}
