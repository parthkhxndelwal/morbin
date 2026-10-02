import Link from "next/link";
import { ArrowRightIcon, BellIcon } from "lucide-react";
import { MarkAllReadButton } from "@/components/features/notifications/mark-all-read-button";
import { DateTime } from "@/components/patterns/money";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState, NoAccessState } from "@/components/patterns/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getNotificationScope, getNotifications, getUnreadCount } from "@/lib/notifications";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const metadata = { title: "Notifications" };

/** How many notices one page of history holds. */
const PAGE_SIZE = 50;

/**
 * Every in-dashboard notice for the signed-in person's audience — payouts,
 * refunds, Morbin support changes.
 *
 * The audience is resolved here, on the server, from the session: an admin reads
 * the platform desk, everybody else reads their own organisation's. There is no
 * filter in the URL, so this page cannot be pointed at another tenant's inbox.
 */
export default async function NotificationsPage() {
  if (!(await auth())?.user?.id) redirect("/auth");
  const scope = await getNotificationScope();
  if (!scope) return <NoAccessState description="Notifications cover payouts and refunds, so they go to the organisation owner." />;
  const [unreadCount, items] = await Promise.all([
    getUnreadCount(scope),
    getNotifications(scope, { limit: PAGE_SIZE }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Payouts, refunds and Morbin support changes for this workspace. Newest first."
        meta={
          unreadCount > 0 ? (
            <span className="text-xs text-muted-foreground">{unreadCount} unread</span>
          ) : undefined
        }
        actions={<MarkAllReadButton unreadCount={unreadCount} />}
      />

      {items.length === 0 ? (
        <EmptyState
          title="Nothing yet"
          description="When Morbin pays you a payout, decides a refund, or edits one of your events as support, it shows up here as well as in your email."
          icon={<BellIcon />}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((n) => {
            const unread = n.readAt === null;
            return (
              <li key={n.id}>
                <Card className={cn("py-4", unread && "border-primary/40 bg-accent/30")}>
                  <CardContent className="flex items-start gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        unread ? "bg-primary" : "bg-transparent",
                      )}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span
                          className={cn("text-sm", unread ? "font-medium" : "text-foreground/80")}
                        >
                          {n.title}
                        </span>
                        {unread && (
                          <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                            Unread
                          </Badge>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">{n.body}</p>
                      <p className="text-xs text-muted-foreground">
                        {unread ? (
                          <DateTime value={n.createdAt} mode="relative" />
                        ) : (
                          <>
                            Read <DateTime value={n.readAt} mode="relative" /> ·{" "}
                            <DateTime value={n.createdAt} />
                          </>
                        )}
                      </p>
                    </div>
                    {n.link && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        nativeButton={false}
                        render={<Link href={n.link} />}
                      >
                        Open
                        <ArrowRightIcon data-icon="inline-end" />
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
