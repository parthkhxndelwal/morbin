import { cn } from "@/lib/utils";

/**
 * Title, one-line description and the page's primary actions. Every dashboard
 * page starts with this, so titles and action placement never drift.
 */
export function PageHeader({
  title,
  description,
  actions,
  meta,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Buttons, right-aligned on desktop, stacked under the title on mobile. */
  actions?: React.ReactNode;
  /** Small inline items next to the title, e.g. a StatusBadge. */
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {meta}
        </div>
        {description && (
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
