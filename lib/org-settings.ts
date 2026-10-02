import "server-only";

import { getPlatformSettings, feeBpsFor, feeBearerFor } from "@/lib/platform-settings";
import { computePricing, DEFAULT_GST_BPS, type FeeBearer, type OrderPricing } from "@/lib/pricing";
import type { Organization } from "@/lib/types";

/**
 * The read model behind `/dashboard/settings`: the organisation's own profile
 * and the fee arrangement it is on.
 *
 * Every number here comes from `lib/pricing.ts` and `lib/platform-settings.ts`
 * — the settings page renders a view model, it never recomputes money, and it
 * never decides who bears the fee. `feeBps` is admin-set and is surfaced
 * read-only to the owner; the owner chooses only the bearer.
 */

/** A ₹500 ticket — the example the fee copy is written around. */
const EXAMPLE_TICKET_PAISE = 50_000;

/** Basis points as a percentage, the way the fee is always written. */
const percent = (bps: number) => (bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export interface FeeSettingsView {
  /** Platform fee, GST-inclusive, in basis points. Admin-set. Read-only here. */
  feeBps: number;
  /** The same figure for display, e.g. "7" or "7.5". */
  feePercent: string;
  /** GST carved out of the fee, from platform settings. */
  gstBps: number;
  /** The GST rate for display, e.g. "18". */
  gstPercent: string;
  /** Whether this organisation's rate is its own, or the platform default. */
  isCustomRate: boolean;
  /** The organisation's current choice, resolved (absent = ORGANISER). */
  feeBearer: FeeBearer;
  /** ₹500 ticket, buyer pays the fee on top. */
  exampleCustomer: OrderPricing;
  /** ₹500 ticket, the organisation absorbs the fee. */
  exampleOrganiser: OrderPricing;
}

/** Resolve the fee arrangement and the worked examples that explain it. */
export async function getFeeSettings(
  org: Pick<Organization, "feeBps" | "feeBearer">,
): Promise<FeeSettingsView> {
  const settings = await getPlatformSettings();
  const feeBps = feeBpsFor(org, settings);
  const gstBps = settings.gst.rateBps ?? DEFAULT_GST_BPS;
  const feeBearer = feeBearerFor(org);
  const example = (bearer: FeeBearer) =>
    computePricing([{ unitPricePaise: EXAMPLE_TICKET_PAISE, quantity: 1 }], {
      feeBps,
      gstBps,
      bearer,
    });
  return {
    feeBps,
    feePercent: percent(feeBps),
    gstBps,
    gstPercent: percent(gstBps),
    isCustomRate: org.feeBps != null,
    feeBearer,
    exampleCustomer: example("CUSTOMER"),
    exampleOrganiser: example("ORGANISER"),
  };
}

export interface OrgSettingsView {
  name: string;
  slug: string;
  type: Organization["type"];
  contactEmail: string;
  contactPhone: string;
  /** Uppercased, or "" when the organisation has no GSTIN. */
  gstin: string;
  address: string;
  /** GST state code, or "". */
  stateCode: string;
}

/**
 * The profile fields the owner may edit. Pure — the caller already holds the
 * organisation document, so this just normalises the optional fields into the
 * empty-string the form inputs want.
 */
export function getOrgSettingsView(org: Organization): OrgSettingsView {
  return {
    name: org.name,
    slug: org.slug,
    type: org.type,
    contactEmail: org.contactEmail ?? "",
    contactPhone: org.contactPhone ?? "",
    gstin: (org.gstin ?? "").toUpperCase(),
    address: org.address ?? "",
    stateCode: org.stateCode ?? "",
  };
}
