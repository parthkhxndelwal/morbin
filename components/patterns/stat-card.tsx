import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** One KPI: label, value, and an optional hint line (comparison, context). */
export function StatCard({
  label,
  value,
  hint,
  icon,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card size="sm" className={cn("gap-1", className)}>
      <CardHeader>
        <CardDescription className="flex items-center justify-between gap-2">
          <span>{label}</span>
          {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

export function StatCardSkeleton() {
  return (
    <Card size="sm" className="gap-2">
      <CardHeader>
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-7 w-32" />
      </CardHeader>
    </Card>
  );
}

/** Responsive grid for a row of StatCards. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2 xl:grid-cols-4", className)}>{children}</div>
  );
}
