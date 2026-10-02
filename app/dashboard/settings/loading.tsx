import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder shaped like the page: a header line and the three settings cards. */
export default function SettingsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-2xl" />
      </div>
      {[0, 1, 2].map((card) => (
        <div
          key={card}
          className="flex flex-col gap-4 rounded-xl bg-card py-4 ring-1 ring-foreground/10"
        >
          <div className="space-y-2 px-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
          <div className="space-y-4 px-4">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-2/3" />
          </div>
        </div>
      ))}
      <span className="sr-only">Loading settings…</span>
    </div>
  );
}
