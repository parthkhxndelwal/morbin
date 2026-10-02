"use client";

import { MailCheckIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { Result } from "@/lib/result";
import { submitDataRequestAction } from "./actions";

const TYPES = [
  { value: "ACCESS", label: "Send me a copy of my data", hint: "Bookings, tickets, answers you gave and emails we sent." },
  { value: "CORRECTION", label: "Correct something", hint: "For example a misspelt name on a ticket." },
  { value: "ERASURE", label: "Erase my data", hint: "Tax invoices are kept for 8 years, as the law requires." },
] as const;

export function RequestForm() {
  const [type, setType] = useState<string>("ACCESS");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("type", type);
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      let result: Result;
      try {
        result = await submitDataRequestAction(formData);
      } catch {
        result = { ok: false, error: "Something went wrong. Please try again." };
      }
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      setSentTo(String(formData.get("email") ?? ""));
    });
  }

  if (sentTo) {
    return (
      <div className="space-y-3 py-6 text-center" role="status">
        <MailCheckIcon className="mx-auto size-10 text-primary" />
        <h2 className="text-lg font-semibold">Check your inbox</h2>
        <p className="text-sm text-muted-foreground">
          If <span className="font-medium text-foreground">{sentTo}</span> can receive email, a confirmation link is on its
          way. Your request reaches us once you open it.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      {formError && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel>What would you like?</FieldLabel>
          <RadioGroup value={type} onValueChange={(v) => setType(String(v))} className="gap-2">
            {TYPES.map((t) => (
              <label
                key={t.value}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-data-checked:border-primary has-data-checked:bg-primary/5"
              >
                <RadioGroupItem value={t.value} className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="block text-xs text-muted-foreground">{t.hint}</span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <FieldError>{errors.type}</FieldError>
        </Field>
        <Field data-invalid={!!errors.email || undefined}>
          <FieldLabel htmlFor="dr-email">Email address</FieldLabel>
          <Input id="dr-email" name="email" type="email" autoComplete="email" required aria-invalid={!!errors.email || undefined} />
          <FieldDescription>The one you booked with. We only act on what&apos;s tied to it.</FieldDescription>
          <FieldError>{errors.email}</FieldError>
        </Field>
        <Field data-invalid={!!errors.details || undefined}>
          <FieldLabel htmlFor="dr-details">{type === "CORRECTION" ? "What should we correct?" : "Anything we should know? (optional)"}</FieldLabel>
          <Textarea id="dr-details" name="details" rows={3} maxLength={2000} aria-invalid={!!errors.details || undefined} />
          <FieldError>{errors.details}</FieldError>
        </Field>
      </FieldGroup>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Spinner data-icon="inline-start" />}
        Send confirmation link
      </Button>
    </form>
  );
}
