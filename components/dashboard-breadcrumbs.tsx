"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useBreadcrumbLabels } from "@/components/breadcrumb-labels";

/** Words for fixed path segments. Ids are named through `BreadcrumbLabelsProvider`. */
const SEGMENTS: Record<string, string> = {
  dashboard: "Dashboard",
  admin: "Admin",
  events: "Events",
  scan: "Check-in",
  flow: "Booking flow",
  appearance: "Appearance",
  insights: "Insights",
  orders: "Orders",
  attendees: "Attendees",
  tickets: "Tickets",
  details: "Details",
  refunds: "Refunds",
  payouts: "Payouts",
  notifications: "Notifications",
  datasets: "Datasets",
  team: "Team",
  settings: "Settings",
  organisations: "Organisations",
  orgs: "Organisations",
  applications: "Applications",
  audit: "Audit log",
};

/**
 * Breadcrumbs from the URL. Event and organisation ids are named through
 * `BreadcrumbLabelsProvider`, so `/dashboard/events/6650…` reads as
 * "Events › Tech Fest 2026" rather than an ObjectId.
 */
export function DashboardBreadcrumbs({ rootHref }: { rootHref: string }) {
  const pathname = usePathname();
  const labels = useBreadcrumbLabels();
  const parts = pathname.split("/").filter(Boolean);
  // The admin area is rooted at /dashboard/admin; skip the shared "dashboard".
  const start = rootHref === "/dashboard/admin" ? 2 : 1;
  const crumbs = parts.slice(start).map((segment, i) => ({
    href: "/" + parts.slice(0, start + i + 1).join("/"),
    label: labels[segment] ?? SEGMENTS[segment] ?? decodeURIComponent(segment),
  }));
  const rootLabel = rootHref === "/dashboard/admin" ? "Admin" : "Overview";

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.length === 0 ? (
          <BreadcrumbItem>
            <BreadcrumbPage>{rootLabel}</BreadcrumbPage>
          </BreadcrumbItem>
        ) : (
          <>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink render={<Link href={rootHref} />}>{rootLabel}</BreadcrumbLink>
            </BreadcrumbItem>
            {crumbs.map((c, i) => (
              <Fragment key={c.href}>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem className={i < crumbs.length - 1 ? "hidden md:block" : undefined}>
                  {i === crumbs.length - 1 ? (
                    <BreadcrumbPage className="max-w-[40ch] truncate">{c.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<Link href={c.href} />}>{c.label}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
