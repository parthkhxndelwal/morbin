"use client";

import { LockIcon, TriangleAlertIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ActionForm } from "@/components/patterns/action-form";
import { formatDateTime } from "@/lib/format";
import { savePayoutAccountAction } from "./actions";

/** The safe view of the stored account — never the account number. */
export interface PayoutAccountView {
  accountName: string;
  ifsc: string;
  last4: string;
  updatedAt: string;
}

export interface PayoutEncryptionState {
  configured: boolean;
  message?: string;
}

/**
 * Payout bank details.
 *
 * The account number is write-only: it is encrypted with AES-256-GCM on the
 * server (`lib/payout-accounts`) and never sent back, so an edit that leaves
 * the field blank keeps whatever is on file and the card shows only the last
 * four digits.
 */
export function PayoutAccountForm({
  view,
  encryption,
  disabled,
}: {
  view: PayoutAccountView | null;
  encryption: PayoutEncryptionState;
  disabled?: boolean;
}) {
  const hasAccount = view !== null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payout bank details</CardTitle>
        <CardDescription>
          Where Morbin sends your payouts. The account number is encrypted before it is
          stored and is never shown again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!encryption.configured ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Payout details can&rsquo;t be saved</AlertTitle>
            <AlertDescription>
              {encryption.message ??
                "The server is not configured to store bank details securely."}{" "}
              Your existing details are untouched — contact Morbin support to have this
              fixed.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {hasAccount && (
              <div className="mb-6 flex items-start gap-2 rounded-lg border bg-muted/30 p-4">
                <LockIcon
                  className="mt-1 size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <p>
                  <span className="font-medium">{view.accountName}</span> · {view.ifsc} ·{" "}
                  <span className="font-mono tabular-nums">•••• {view.last4}</span>
                  <span className="block text-xs text-muted-foreground">
                    Last updated {formatDateTime(view.updatedAt)}
                  </span>
                </p>
              </div>
            )}

            <ActionForm
              action={savePayoutAccountAction}
              disabled={disabled}
              submitLabel={hasAccount ? "Update bank details" : "Save bank details"}
              successMessage="Payout bank details saved"
            >
              {(errors) => (
                <FieldGroup>
                  <Field data-invalid={!!errors.accountName || undefined}>
                    <FieldLabel htmlFor="payout-account-name">Account holder name</FieldLabel>
                    <Input
                      id="payout-account-name"
                      name="accountName"
                      defaultValue={view?.accountName ?? ""}
                      autoComplete="off"
                      aria-invalid={!!errors.accountName || undefined}
                      required
                    />
                    <FieldDescription>
                      Exactly as it appears on your bank statement.
                    </FieldDescription>
                    <FieldError>{errors.accountName}</FieldError>
                  </Field>
                  <Field data-invalid={!!errors.ifsc || undefined}>
                    <FieldLabel htmlFor="payout-ifsc">IFSC code</FieldLabel>
                    <Input
                      id="payout-ifsc"
                      name="ifsc"
                      defaultValue={view?.ifsc ?? ""}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      placeholder="HDFC0001234"
                      aria-invalid={!!errors.ifsc || undefined}
                      required
                    />
                    <FieldError>{errors.ifsc}</FieldError>
                  </Field>
                  <Field data-invalid={!!errors.accountNumber || undefined}>
                    <FieldLabel htmlFor="payout-account-number">
                      Account number
                      {hasAccount && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          — leave blank to keep •••• {view.last4}
                        </span>
                      )}
                    </FieldLabel>
                    <Input
                      id="payout-account-number"
                      name="accountNumber"
                      type="password"
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder={hasAccount ? "Unchanged" : "000123456789012"}
                      aria-invalid={!!errors.accountNumber || undefined}
                    />
                    <FieldDescription>
                      9 to 18 digits. Stored encrypted and only ever shown back as the last four digits.
                    </FieldDescription>
                    <FieldError>{errors.accountNumber}</FieldError>
                  </Field>
                </FieldGroup>
              )}
            </ActionForm>
          </>
        )}
      </CardContent>
    </Card>
  );
}
