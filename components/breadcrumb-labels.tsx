"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { BreadcrumbLabels } from "@/lib/nav";

type Ctx = {
  labels: BreadcrumbLabels;
  set: (segment: string, label: string) => void;
};

const BreadcrumbContext = createContext<Ctx>({ labels: {}, set: () => {} });

/**
 * Holds the id → name map the breadcrumbs use. Seeded by the dashboard layout,
 * and updated by `<BreadcrumbLabel>` from nested layouts — needed because the
 * root layout is not re-rendered on client navigation, so a just-created event
 * would otherwise show its raw id.
 */
export function BreadcrumbLabelsProvider({
  initial,
  children,
}: {
  initial: BreadcrumbLabels;
  children: React.ReactNode;
}) {
  const [labels, setLabels] = useState(initial);
  const set = useCallback(
    (segment: string, label: string) =>
      setLabels((prev) => (prev[segment] === label ? prev : { ...prev, [segment]: label })),
    [],
  );
  return <BreadcrumbContext.Provider value={{ labels, set }}>{children}</BreadcrumbContext.Provider>;
}

export function useBreadcrumbLabels(): BreadcrumbLabels {
  return useContext(BreadcrumbContext).labels;
}

/** Render anywhere under the dashboard to name a path segment. */
export function BreadcrumbLabel({ segment, label }: { segment: string; label: string }) {
  const { set } = useContext(BreadcrumbContext);
  useEffect(() => set(segment, label), [segment, label, set]);
  return null;
}
