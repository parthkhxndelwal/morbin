"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { markAllNotificationsReadAction } from "./actions";

/** Clears the whole inbox for the caller's audience. Hidden when there is nothing to clear. */
export function MarkAllReadButton({ unreadCount }: { unreadCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (unreadCount === 0) return null;

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsReadAction();
          if (!result.ok) {
            toast.error(result.error);
            return;
          }
          toast.success("All notifications marked as read");
          router.refresh();
        })
      }
    >
      {pending && <Spinner data-icon="inline-start" />}
      Mark all as read
    </Button>
  );
}
