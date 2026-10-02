import "server-only";

import { audit, notify } from "@/lib/audit";
import type { Organization } from "@/lib/types";

/**
 * Morbin support working on an organisation's event or datasets. Every change is visible
 * to the organisation: it is audit-logged with the admin as actor and the owner
 * gets a dashboard notification saying what changed.
 */

export async function recordSupportChange(
  input: {
    adminId: string;
    organizationId: string;
    action: string;
    summary: string;
    /** Audit meta beyond `support: true` — counts only, never personal data. */
    meta?: Record<string, unknown>;
  } & (
    | { eventId: string }
    | { target: { type: "dataset"; id: string; link: string; title: string } }
  ),
): Promise<void> {
  const target =
    "eventId" in input
      ? { type: "event", id: input.eventId, link: `/dashboard/events/${input.eventId}`, title: "Morbin support updated your event" }
      : input.target;
  await audit({
    actorId: input.adminId,
    actorRole: "ADMIN",
    action: input.action,
    targetType: target.type,
    targetId: target.id,
    organizationId: input.organizationId,
    meta: { ...input.meta, support: true },
  });
  await notify({
    organizationId: input.organizationId,
    audience: "ORG_OWNER",
    kind: "SUPPORT_CHANGE",
    title: target.title,
    body: input.summary,
    link: target.link,
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
