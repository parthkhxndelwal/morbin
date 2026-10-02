"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/patterns/states";

/**
 * Error boundary for `/dashboard/settings`.
 *
 * Next 16 passes `retry()` (the old `reset()` re-renders without re-fetching,
 * which is rarely what a settings page needs). Anything the page throws on the
 * way in — a database or platform-settings read — lands here.
 */
export default function SettingsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[settings]", error);
  }, [error]);

  return (
    <ErrorState
      title="Settings didn't load"
      description="We couldn't load your settings. Try again in a moment."
      action={
        <Button variant="outline" onClick={() => retry()}>
          Try again
        </Button>
      }
    />
  );
}
