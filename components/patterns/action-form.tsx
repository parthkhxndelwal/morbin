"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Result } from "@/lib/result";
import type { FieldErrors } from "./form-dialog";

/**
 * An inline form (settings pages, detail tabs) that submits to a server action.
 * Same contract as FormDialog: field errors inline, a general error above the
 * button, a toast on success, input kept on failure.
 */
export function ActionForm<T>({
  action,
  submitLabel = "Save changes",
  successMessage,
  children,
  disabled = false,
  footer,
  className,
}: {
  action: (formData: FormData) => Promise<Result<T>>;
  submitLabel?: string;
  successMessage?: string;
  children: (errors: FieldErrors) => React.ReactNode;
  disabled?: boolean;
  /** Extra content next to the submit button. */
  footer?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setErrors({});
    setFormError(null);
    startTransition(async () => {
      let result: Result<T>;
      try {
        result = await action(formData);
      } catch {
        result = { ok: false, error: "Something went wrong. Please try again." };
      }
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        if (!result.fieldErrors || Object.keys(result.fieldErrors).length === 0) setFormError(result.error);
        else toast.error(result.error);
        return;
      }
      toast.success(result.message ?? successMessage ?? "Saved");
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      <fieldset disabled={disabled || pending} className="grid gap-6">
        {children(errors)}
        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={disabled || pending}>
            {pending && <Spinner data-icon="inline-start" />}
            {submitLabel}
          </Button>
          {footer}
        </div>
      </fieldset>
    </form>
  );
}
