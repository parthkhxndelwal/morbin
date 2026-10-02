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
import { Spinner } from "@/components/ui/spinner";
import type { Result } from "@/lib/result";

/**
 * A button that asks before doing something consequential.
 *
 * Handles every state the caller would otherwise re-implement: pending (the
 * dialog stays open with a spinner and can't be dismissed), success (closes,
 * toasts, refreshes server data), and failure (stays open with the error shown
 * in place so the person can retry or cancel).
 */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  successMessage,
  action,
  onSuccess,
  children,
}: {
  /** The element that opens the dialog, usually a <Button />. */
  trigger: React.ReactElement;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  /** Toast text on success; the action's own `message` wins if it sets one. */
  successMessage?: string;
  action: () => Promise<Result<unknown>>;
  onSuccess?: () => void;
  /** Extra content between the description and the buttons (summaries, warnings). */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      let result: Result<unknown>;
      try {
        result = await action();
      } catch {
        result = { ok: false, error: "Something went wrong. Please try again." };
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      toast.success(result.message ?? successMessage ?? "Done");
      onSuccess?.();
      router.refresh();
    });
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} onClick={run} disabled={pending}>
            {pending && <Spinner data-icon="inline-start" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
