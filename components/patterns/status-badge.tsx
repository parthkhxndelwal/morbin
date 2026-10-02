"use client";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { statusMeta, type StatusKind, type StatusTone } from "@/lib/status";
import { cn } from "@/lib/utils";

const DOT: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

/**
 * A status, rendered from `lib/status.ts`. The coloured dot is paired with a
 * text label so colour is never the only signal.
 */
export function StatusBadge({
  kind,
  value,
  className,
}: {
  kind: StatusKind;
  value: string | null | undefined;
  className?: string;
}) {
  const meta = statusMeta(kind, value);
  const badge = (
    <Badge variant="outline" className={cn("gap-1.5 font-normal", className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", DOT[meta.tone])} />
      {meta.label}
    </Badge>
  );
  if (!meta.description) return badge;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{badge}</TooltipTrigger>
      <TooltipContent>{meta.description}</TooltipContent>
    </Tooltip>
  );
}
