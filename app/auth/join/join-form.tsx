"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { Result } from "@/lib/result";

/**
 * Name + password for an account someone else started (a team invite, or an
 * organisation Morbin set up). On success it signs straight in with what was
 * just typed and lands on the dashboard.
 */
export function JoinForm({
  token,
  email,
  defaultName,
  submitLabel = "Create account and join",
  action,
}: {
  token: string;
  email: string;
  defaultName: string;
  submitLabel?: string;
  action: (token: string, formData: FormData) => Promise<Result<{ email: string }>>;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      let result: Result<{ email: string }>;
      try {
        result = await action(token, formData);
      } catch {
        result = { ok: false, error: "Something went wrong. Please try again." };
      }
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        if (!result.fieldErrors || Object.keys(result.fieldErrors).length === 0) setFormError(result.error);
        return;
      }
      const signedIn = await signIn("credentials", {
        email: result.data.email,
        password: String(formData.get("password") ?? ""),
        redirect: false,
      });
      // The account exists either way; if the automatic sign-in fails, the
      // normal sign-in page works with the password just chosen.
      router.push(signedIn?.ok ? "/dashboard" : "/auth");
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="join-email">Email</FieldLabel>
          <Input id="join-email" value={email} readOnly disabled />
        </Field>
        <Field data-invalid={!!errors.name || undefined}>
          <FieldLabel htmlFor="join-name">Your name</FieldLabel>
          <Input
            id="join-name"
            name="name"
            defaultValue={defaultName}
            autoComplete="name"
            aria-invalid={!!errors.name || undefined}
            required
          />
          <FieldError>{errors.name}</FieldError>
        </Field>
        <Field data-invalid={!!errors.password || undefined}>
          <FieldLabel htmlFor="join-password">Password</FieldLabel>
          <Input
            id="join-password"
            name="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password || undefined}
            required
          />
          <FieldDescription>At least 8 characters, with an uppercase letter and a number.</FieldDescription>
          <FieldError>{errors.password}</FieldError>
        </Field>
        <Field data-invalid={!!errors.confirm || undefined}>
          <FieldLabel htmlFor="join-confirm">Confirm password</FieldLabel>
          <Input
            id="join-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!errors.confirm || undefined}
            required
          />
          <FieldError>{errors.confirm}</FieldError>
        </Field>
      </FieldGroup>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending && <Spinner data-icon="inline-start" />}
        {submitLabel}
      </Button>
    </form>
  );
}
