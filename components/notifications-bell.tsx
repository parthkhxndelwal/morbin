"use client";

import Link from "next/link";
import { BellIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/components/features/notifications/actions";
import { DateTime } from "@/components/patterns/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { NotificationItem } from "@/lib/notifications";
import { cn } from "@/lib/utils";

/** What the badge shows once the number stops being worth counting. */
const BADGE_MAX = 99;

const ROW = cn(
  "block w-full rounded-md px-3 py-2.5 text-left transition-colors outline-none",
  "hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50",
);

/**
 * The dashboard header's notification bell: unread badge, the most recent
 * notices, and a way to clear them.
 *
 * `unreadCount` and `items` arrive as plain DTOs that the server layout has
 * already resolved for this person's audience — the bell never reads the
 * database itself, and the action it calls re-derives that audience on the
 * server, so nothing a browser sends can widen it.
 *
 * Read state is optimistic: the dot and the badge clear the moment it is
 * clicked, and the server action's `revalidatePath` re-renders the layout so
 * the badge is settled either way. No polling.
 */
export function NotificationsBell({
  unreadCount,
  items,
  viewAllHref = "/dashboard/notifications",
}: {
  unreadCount: number;
  items: NotificationItem[];
  viewAllHref?: string;
}) {
  const [open, setOpen] = useState(false);
  // Optimistic read marks layered over what the server sent. When the layout
  // re-renders with fresh props, those already agree, so the overlay is harmless.
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  const [clearedAll, setClearedAll] = useState<number | false>(false);
  const [pending, startTransition] = useTransition();

  const recent = items.map((n) =>
    n.readAt === null && readIds.has(n.id) ? { ...n, readAt: n.createdAt } : n,
  );
  const locallyRead = items.filter((n) => n.readAt === null && readIds.has(n.id)).length;
  // "Mark all" also clears unread notices older than this list; hold the badge
  // at zero until the server's count moves (to 0, or up with a new notice).
  const unread = clearedAll === unreadCount ? 0 : Math.max(0, unreadCount - locallyRead);

  function markOne(id: string) {
    setReadIds((prev) => new Set(prev).add(id));
    startTransition(async () => {
      const result = await markNotificationReadAction(id);
      if (!result.ok) toast.error(result.error);
    });
  }

  function markAll() {
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Older unread notices beyond this list were cleared too; newer ones that
      // arrive later are not in this set, so they still show as unread.
      setReadIds(new Set(items.map((n) => n.id)));
      setClearedAll(unreadCount);
      toast.success("All notifications marked as read");
    });
  }

  const label =
    unread > 0
      ? `Notifications, ${unread > BADGE_MAX ? `${BADGE_MAX}+` : unread} unread`
      : "Notifications";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon" className="relative" aria-label={label} />}
      >
        <BellIcon />
        {unread > 0 && (
          <Badge className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[10px] leading-none">
            {unread > BADGE_MAX ? `${BADGE_MAX}+` : unread}
          </Badge>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 p-0 sm:w-96">
        <PopoverHeader className="flex-row items-center justify-between gap-2 px-3 py-2.5">
          <PopoverTitle>Notifications</PopoverTitle>
          {unread > 0 && (
            <Button variant="ghost" size="xs" onClick={markAll} disabled={pending}>
              {pending && <Spinner data-icon="inline-start" />}
              Mark all read
            </Button>
          )}
        </PopoverHeader>
        <Separator />

        {/* base-ui's viewport fills its Root, which only scrolls when the Root
            has a definite height — this box scrolls on its own instead. */}
        <div className="max-h-96 overflow-y-auto overscroll-contain">
          {recent.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nothing here yet. Payouts, refunds and Morbin support changes land in this list.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5 p-1.5">
              {recent.map((n) => (
                <li key={n.id}>
                  <NotificationRow
                    item={n}
                    onOpen={() => {
                      setOpen(false);
                      if (n.readAt === null) markOne(n.id);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <Separator />
        <div className="p-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            nativeButton={false}
            render={<Link href={viewAllHref} onClick={() => setOpen(false)} />}
          >
            View all notifications
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One notice. It is a link where the notice has somewhere to go and a button
 * where it doesn't, so the whole row is the target either way. Phrasing content
 * only — a `<button>` may not contain flow content.
 */
function NotificationRow({
  item,
  onOpen,
}: {
  item: NotificationItem;
  onOpen: () => void;
}) {
  const unread = item.readAt === null;
  const body = (
    <>
      <span className="flex items-start gap-2">
        <span
          aria-hidden
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            unread ? "bg-primary" : "bg-transparent",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{item.title}</span>
          <span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
            {item.body}
          </span>
          <DateTime
            value={item.createdAt}
            mode="relative"
            className="mt-1 block text-xs text-muted-foreground"
          />
        </span>
      </span>
      {unread && <span className="sr-only">Unread</span>}
    </>
  );

  if (!item.link) {
    return (
      <button type="button" className={cn(ROW, unread && "bg-accent/50")} onClick={onOpen}>
        {body}
      </button>
    );
  }
  return (
    <Link href={item.link} className={cn(ROW, unread && "bg-accent/50")} onClick={onOpen}>
      {body}
    </Link>
  );
}
