"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { Result } from "@/lib/result";

/**
 * ConfirmAction that also asks for one piece of text — a reason, a note, a
 * payment reference — and passes it to the action. Same pending/error/success
 * handling as ConfirmAction.
 */
export function PromptAction({
  trigger,
  title,
  description,
  label,
  placeholder,
  hint,
  multiline = false,
  required = true,
  minLength = 3,
  confirmLabel = "Confirm",
  destructive = false,
  action,
  onSuccess,
  initialValue = "",
  open: controlledOpen,
  onOpenChange,
}: {
  /** The element that opens the dialog. Omit when controlled. */
  trigger?: React.ReactElement;
  /** Controlled mode, e.g. opened from a dropdown menu item. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Pre-filled text, e.g. the current name when renaming. */
  initialValue?: string;
  title: string;
  description?: React.ReactNode;
  label: string;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  required?: boolean;
  minLength?: number;
  confirmLabel?: string;
  destructive?: boolean;
  action: (value: string) => Promise<Result<unknown>>;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      let result: Result<unknown>;
      try {
        result = await action(value.trim());
      } catch {
        result = { ok: false, error: "Something went wrong. Please try again." };
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setValue(initialValue);
      toast.success(result.message ?? "Done");
      onSuccess?.();
      router.refresh();
    });
  }

  const tooShort = required && value.trim().length < minLength;
  const Control = multiline ? Textarea : Input;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      {trigger && <AlertDialogTrigger render={trigger} />}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <Field>
          <FieldLabel htmlFor="prompt-value">{label}</FieldLabel>
          <Control
            id="prompt-value"
            value={value}
            onChange={(e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setValue(e.target.value)}
            placeholder={placeholder}
            {...(multiline ? { rows: 3 } : {})}
          />
          {hint && <FieldDescription>{hint}</FieldDescription>}
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} onClick={run} disabled={pending || tooShort}>
            {pending && <Spinner data-icon="inline-start" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
