"use client";

import Link from "next/link";
import { CheckCircle2Icon } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { Result } from "@/lib/result";
import { submitApplicationAction } from "./actions";

export function ApplyForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      let result: Result;
      try {
        result = await submitApplicationAction(formData);
      } catch {
        result = { ok: false, error: "Something went wrong. Please try again." };
      }
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setFormError(result.error);
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <div className="space-y-3 py-6 text-center">
        <CheckCircle2Icon className="mx-auto size-10 text-primary" />
        <h2 className="text-lg font-semibold">Thanks — we&apos;ve got it</h2>
        <p className="text-sm text-muted-foreground">
          We&apos;ve emailed you a copy. A person reviews every application, usually within two working days.
        </p>
      </div>
    );
  }

  const f = (name: string) => ({ "data-invalid": !!errors[name] || undefined });
  return (
    <form onSubmit={onSubmit} className="grid gap-6" noValidate>
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />
      <FieldGroup>
        <Field {...f("organizationName")}>
          <FieldLabel htmlFor="ap-org">Organisation or event name</FieldLabel>
          <Input id="ap-org" name="organizationName" autoComplete="organization" required />
          <FieldError>{errors.organizationName}</FieldError>
        </Field>
        <Field {...f("type")}>
          <FieldLabel htmlFor="ap-type">What describes you best?</FieldLabel>
          <NativeSelect id="ap-type" name="type" defaultValue="EVENT" className="w-full">
            <NativeSelectOption value="EVENT">Event organiser or collective</NativeSelectOption>
            <NativeSelectOption value="INSTITUTION">College or university</NativeSelectOption>
            <NativeSelectOption value="CORPORATE">Company</NativeSelectOption>
          </NativeSelect>
          <FieldError>{errors.type}</FieldError>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field {...f("eventsPerYear")}>
            <FieldLabel htmlFor="ap-events">Events a year</FieldLabel>
            <NativeSelect id="ap-events" name="eventsPerYear" defaultValue="2-5" className="w-full">
              <NativeSelectOption value="1">Just one</NativeSelectOption>
              <NativeSelectOption value="2-5">2–5</NativeSelectOption>
              <NativeSelectOption value="6-20">6–20</NativeSelectOption>
              <NativeSelectOption value="20+">More than 20</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field {...f("ticketsPerEvent")}>
            <FieldLabel htmlFor="ap-tickets">Tickets per event</FieldLabel>
            <NativeSelect id="ap-tickets" name="ticketsPerEvent" defaultValue="100-500" className="w-full">
              <NativeSelectOption value="<100">Under 100</NativeSelectOption>
              <NativeSelectOption value="100-500">100–500</NativeSelectOption>
              <NativeSelectOption value="500-2000">500–2,000</NativeSelectOption>
              <NativeSelectOption value="2000+">More than 2,000</NativeSelectOption>
            </NativeSelect>
          </Field>
        </div>
        <Field {...f("about")}>
          <FieldLabel htmlFor="ap-about">Tell us about your events</FieldLabel>
          <Textarea
            id="ap-about"
            name="about"
            rows={4}
            maxLength={2000}
            placeholder="What kind of events, who comes, how you sell tickets today…"
          />
          <FieldError>{errors.about}</FieldError>
        </Field>
      </FieldGroup>

      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field {...f("contactName")}>
            <FieldLabel htmlFor="ap-name">Your name</FieldLabel>
            <Input id="ap-name" name="contactName" autoComplete="name" required />
            <FieldError>{errors.contactName}</FieldError>
          </Field>
          <Field {...f("city")}>
            <FieldLabel htmlFor="ap-city">City</FieldLabel>
            <Input id="ap-city" name="city" autoComplete="address-level2" required />
            <FieldError>{errors.city}</FieldError>
          </Field>
          <Field {...f("email")}>
            <FieldLabel htmlFor="ap-email">Email</FieldLabel>
            <Input id="ap-email" name="email" type="email" autoComplete="email" required />
            <FieldDescription>This becomes your sign-in if you&apos;re approved.</FieldDescription>
            <FieldError>{errors.email}</FieldError>
          </Field>
          <Field {...f("phone")}>
            <FieldLabel htmlFor="ap-phone">Phone</FieldLabel>
            <Input id="ap-phone" name="phone" type="tel" autoComplete="tel" required />
            <FieldError>{errors.phone}</FieldError>
          </Field>
        </div>
        <Field {...f("gstin")}>
          <FieldLabel htmlFor="ap-gstin">GSTIN (if registered)</FieldLabel>
          <Input id="ap-gstin" name="gstin" className="uppercase" />
          <FieldError>{errors.gstin}</FieldError>
        </Field>
        <Field orientation="horizontal" {...f("consent")}>
          <Checkbox id="ap-consent" name="consent" value="on" />
          <FieldLabel htmlFor="ap-consent" className="leading-snug font-normal">
            Morbin may use these details to review this application and contact me about it. See the{" "}
            <Link href="/legal/privacy" className="underline">
              privacy policy
            </Link>
            .
          </FieldLabel>
        </Field>
        <FieldError>{errors.consent}</FieldError>
      </FieldGroup>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending && <Spinner data-icon="inline-start" />}
        Send application
      </Button>
    </form>
  );
}
