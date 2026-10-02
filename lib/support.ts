import "server-only";

import { audit, notify } from "@/lib/audit";
import type { Organization } from "@/lib/types";

/**
 * Morbin support working on an organisation's event. Every change is visible
 * to the organisation: it is audit-logged with the admin as actor and the owner
 * gets a dashboard notification saying what changed.
 */

export async function recordSupportChange(input: {
  adminId: string;
  organizationId: string;
  eventId: string;
  action: string;
  summary: string;
}): Promise<void> {
  await audit({
    actorId: input.adminId,
    actorRole: "ADMIN",
    action: input.action,
    targetType: "event",
    targetId: input.eventId,
    organizationId: input.organizationId,
    meta: { support: true },
  });
  await notify({
    organizationId: input.organizationId,
    audience: "ORG_OWNER",
    kind: "SUPPORT_CHANGE",
    title: "Morbin support updated your event",
    body: input.summary,
    link: `/dashboard/events/${input.eventId}`,
  });
}

/**
 * The owner's "support changes need my approval" switch. When on, support may
 * prepare changes but not make them live: booking rules are saved as a draft
 * for the owner to publish, and publishing or cancelling the event is refused.
 */
export function supportNeedsApproval(org: Pick<Organization, "requireApprovalForSupportChanges">): boolean {
  return !!org.requireApprovalForSupportChanges;
}

export const APPROVAL_REQUIRED_MESSAGE =
  "This organisation reviews support changes, so only its owner can publish, unpublish or cancel this event.";
