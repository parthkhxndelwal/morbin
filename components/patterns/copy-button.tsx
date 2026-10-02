"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Copies `value` and confirms in place; falls back to a toast if the clipboard is blocked. */
export function CopyButton({
  value,
  label = "Copy",
  showLabel = false,
}: {
  value: string;
  label?: string;
  showLabel?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select the text and copy it manually.");
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={showLabel ? "sm" : "icon-sm"}
      onClick={copy}
      aria-label={label}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {showLabel && (copied ? "Copied" : label)}
    </Button>
  );
}
