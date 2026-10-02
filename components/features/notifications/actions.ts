"use server";

import { revalidatePath } from "next/cache";
import { markAllRead, markRead, resolveNotificationScope } from "@/lib/notifications";
import { err, ok, type Result } from "@/lib/result";

/**
 * Marking notifications read.
 *
 * Both actions resolve the caller's audience on the server — the id alone never
 * decides the scope — and `lib/notifications` carries that scope into the update
 * filter, so an id from another tenant changes nothing.
 */

async function run(fn: () => Promise<unknown>, message?: string): Promise<Result> {
  try {
    await fn();
    // The bell lives in the dashboard layout, so the layout is what has to
    // re-render for the badge to update.
    revalidatePath("/dashboard", "layout");
    return ok(undefined, message);
  } catch (error) {
    console.error("[notifications:action]", error);
    return err("Something went wrong. Please try again.");
  }
}

export async function markNotificationReadAction(id: string): Promise<Result> {
  if (!id) return err("That notification no longer exists.");
  const guard = await resolveNotificationScope();
  if ("error" in guard) return err(guard.error);
  // Idempotent on purpose: a notification that is already read, or one that is
  // no longer in this caller's inbox, is a no-op rather than an error toast.
  return run(() => markRead(id, guard.scope));
}

export async function markAllNotificationsReadAction(): Promise<Result> {
  const guard = await resolveNotificationScope();
  if ("error" in guard) return err(guard.error);
  return run(() => markAllRead(guard.scope), "All notifications marked as read");
}
