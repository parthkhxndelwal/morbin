import type { OrganizationType, OrgRole } from "@/lib/types";

/**
 * Everything about authorization in one place.
 *
 * The rule set is deliberately small: a MEMBER can see and can work the door,
 * an OWNER can also change what the organization is selling and move money.
 * The non-owner role is always MEMBER — the human-readable wording ("Staff",
 * "Student") is derived from the organization type so it can never drift out
 * of sync with the stored role.
 */

/** How a non-owner member is described, per organization type. */
export function memberLabel(type: OrganizationType): string {
  return type === "INSTITUTION" ? "Student" : "Staff";
}

/** Plural form, for headings and empty states. */
export function memberLabelPlural(type: OrganizationType): string {
  return type === "INSTITUTION" ? "Students" : "Staff";
}

export function describeMemberRole(type: OrganizationType, role: OrgRole): string {
  return role === "OWNER" ? "Owner" : memberLabel(type);
}

export type Capability =
  /** View the dashboard, events, orders and ticket types. */
  | "view"
  /** Run check-in at the door. */
  | "checkIn"
  /** Create, edit and publish events; add ticket types. */
  | "manageEvents"
  /** Issue refunds. */
  | "refund"
  /** Download personal data (orders, attendees, datasets) as files. */
  | "export"
  /** See money: balances, payouts, statements. */
  | "finance"
  /** Invite and remove members. */
  | "manageTeam";

/**
 * SUPPORT is a Morbin admin working on one organisation's event on its behalf:
 * it can fix the event's setup, and deliberately nothing else — no money, no
 * refunds, no exports, and no buyers' personal data (no "view").
 */
export type AccessRole = OrgRole | "SUPPORT";

const GRANTS: Record<AccessRole, readonly Capability[]> = {
  SUPPORT: ["manageEvents"],
  OWNER: ["view", "checkIn", "manageEvents", "refund", "export", "finance", "manageTeam"],
  MEMBER: ["view", "checkIn"],
};

export function can(role: AccessRole | null | undefined, capability: Capability): boolean {
  if (!role) return false;
  return GRANTS[role].includes(capability);
}

/** Human-readable summary of a role, for the UI. */
export function capabilitySummary(role: OrgRole): string {
  return can(role, "manageEvents")
    ? "Can create and publish events, run check-in, and issue refunds."
    : "Can view events and run check-in. Cannot create events or issue refunds.";
}
