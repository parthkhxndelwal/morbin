import { formatDate, formatDateTime, formatINR, formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/** An amount in paise, always formatted the same way and tabular. */
export function Money({
  paise,
  className,
  signed = false,
}: {
  paise: number;
  className?: string;
  /** Prefix positive values with "+" (ledgers, adjustments). */
  signed?: boolean;
}) {
  const text = formatINR(paise);
  return (
    <span className={cn("tabular-nums", paise < 0 && "text-destructive", className)}>
      {signed && paise > 0 ? `+${text}` : text}
    </span>
  );
}

/** A date or date-time in the event's (or default) timezone, with an exact tooltip. */
export function DateTime({
  value,
  timeZone,
  mode = "datetime",
  className,
}: {
  value: Date | string | number | null | undefined;
  timeZone?: string;
  mode?: "date" | "datetime" | "relative";
  className?: string;
}) {
  if (value === null || value === undefined) return <span className={className}>—</span>;
  const iso = new Date(value).toISOString();
  const exact = formatDateTime(value, timeZone);
  const text =
    mode === "date" ? formatDate(value, timeZone) : mode === "relative" ? formatRelative(value) : exact;
  return (
    <time dateTime={iso} title={exact} className={cn("tabular-nums", className)}>
      {text}
    </time>
  );
}
