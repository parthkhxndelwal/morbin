"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { Result } from "@/lib/result";

export type FieldErrors = Record<string, string>;

/**
 * A dialog wrapping a form that submits to a server action.
 *
 * The caller provides fields as a render function, so each field can show its
 * own error (`errors.title`). Pending, success (toast + close + refresh or
 * navigate) and failure (inline errors, dialog stays open, input kept) are all
 * handled here.
 */
export function FormDialog<T>({
  trigger,
  title,
  description,
  submitLabel = "Save",
  successMessage,
  action,
  onSuccess,
  children,
  className,
  open: controlledOpen,
  onOpenChange,
}: {
  /** Omit when controlled (e.g. opened from a dropdown menu item). */
  trigger?: React.ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  submitLabel?: string;
  successMessage?: string;
  action: (formData: FormData) => Promise<Result<T>>;
  /** Called with the action's data; return a URL to navigate there instead of refreshing. */
  onSuccess?: (data: T) => string | void;
  children: (errors: FieldErrors) => React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // A submit handler rather than `<form action>`: React resets a form after a
  // form action completes, which would wipe what the person typed whenever
  // validation fails.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(new FormData(event.currentTarget));
  }

  function submit(formData: FormData) {
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
        if (!result.fieldErrors || Object.keys(result.fieldErrors).length === 0) {
          setFormError(result.error);
        }
        return;
      }
      setOpen(false);
      toast.success(result.message ?? successMessage ?? "Saved");
      const next = onSuccess?.(result.data);
      if (next) router.push(next);
      else router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) {
          setErrors({});
          setFormError(null);
        }
      }}
    >
      {trigger && <DialogTrigger render={trigger} />}
      <DialogContent className={className}>
        <form onSubmit={onSubmit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          {children(errors)}
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" disabled={pending} />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
