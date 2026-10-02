"use server";

import { orgActor } from "@/lib/action-guards";
import { createEventWithDefaults } from "@/lib/events";
import { err, ok, zodFieldErrors, type Result } from "@/lib/result";
import { eventDetailsSchema } from "@/lib/validations";

/** Create a draft event in the caller's organisation. Owner only. */
export async function createEventAction(formData: FormData): Promise<Result<{ id: string }>> {
  const guard = await orgActor("manageEvents");
  if ("error" in guard) return err(guard.error);

  const parsed = eventDetailsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  }

  const event = await createEventWithDefaults(guard.actor.orgId, {
    ...parsed.data,
    timezone: "Asia/Kolkata",
  });
  return ok({ id: event._id!.toString() }, "Draft event created");
}
