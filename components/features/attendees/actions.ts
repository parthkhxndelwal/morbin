"use server";

import { revalidatePath } from "next/cache";
import { orgActor } from "@/lib/action-guards";
import { checkInTicket, type CheckInResult } from "@/lib/checkin";
import { err, ok, type Result } from "@/lib/result";

/** Check a ticket in from the scanner or the attendee list. Owners and staff. */
export async function checkInAction(scan: string, eventId?: string | null): Promise<Result<CheckInResult>> {
  const guard = await orgActor("checkIn", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  if (!scan.trim() || scan.length > 300) return err("Scan or type a ticket code.");
  const result = await checkInTicket({ organizationId: guard.actor.orgId, scan, eventId });
  if (result.ok && eventId) revalidatePath(`/dashboard/events/${eventId}/attendees`);
  return ok(result);
}
