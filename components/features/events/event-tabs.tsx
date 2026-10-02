"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface EventTab {
  label: string;
  /** Path relative to the event root; "" is the overview. */
  path: string;
}

/** Section navigation under an event's header. Scrolls horizontally on phones. */
export function EventTabs({ eventId, tabs }: { eventId: string; tabs: EventTab[] }) {
  const pathname = usePathname();
  const base = `/dashboard/events/${eventId}`;
  return (
    <nav aria-label="Event sections" className="-mx-1 overflow-x-auto border-b">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((tab) => {
          const href = tab.path ? `${base}/${tab.path}` : base;
          const active = tab.path ? pathname.startsWith(href) : pathname === base;
          return (
            <li key={tab.label}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-9 items-center px-3 text-sm text-muted-foreground transition-colors hover:text-foreground",
                  active &&
                    "font-medium text-foreground after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
