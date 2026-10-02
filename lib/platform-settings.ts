import { cache } from "react";
import { getDb } from "@/lib/db";
import { DEFAULT_FEE_BPS, DEFAULT_GST_BPS, type FeeBearer, type PricingPolicy } from "@/lib/pricing";
import type { Event, GstSettings, Organization, PlatformSettings } from "@/lib/types";

export const DEFAULT_RETENTION_MONTHS = 24;

const DEFAULT_GST: GstSettings = {
  legalName: "",
  tradeName: "Morbin",
  gstin: "",
  pan: "",
  address: "",
  state: "",
  stateCode: "",
  sac: "",
  rateBps: DEFAULT_GST_BPS,
  splitRule: "SUPPLIER_STATE",
  invoicePrefix: "MRB",
  footerText: "This is a computer-generated invoice and does not require a signature.",
};

/** Platform-wide settings, with defaults filled in. Request-cached. */
export const getPlatformSettings = cache(async (): Promise<PlatformSettings> => {
  const db = await getDb();
  const doc = await db.collection<PlatformSettings>("platformSettings").findOne({ _id: "platform" });
  return {
    _id: "platform",
    defaultFeeBps: doc?.defaultFeeBps ?? DEFAULT_FEE_BPS,
    defaultRetentionMonths: doc?.defaultRetentionMonths ?? DEFAULT_RETENTION_MONTHS,
    gst: { ...DEFAULT_GST, ...(doc?.gst ?? {}) },
    updatedBy: doc?.updatedBy ?? null,
    updatedAt: doc?.updatedAt ?? new Date(0),
  };
});

/** Whether invoices can be issued: the supplier's identity must be complete. */
export function gstReady(gst: GstSettings): boolean {
  return Boolean(gst.legalName && gst.gstin && gst.address && gst.state && gst.stateCode && gst.sac);
}

export function feeBpsFor(org: Pick<Organization, "feeBps">, settings: PlatformSettings): number {
  return org.feeBps ?? settings.defaultFeeBps;
}

export function feeBearerFor(
  org: Pick<Organization, "feeBearer">,
  event?: Pick<Event, "feeBearer"> | null,
): FeeBearer {
  return event?.feeBearer ?? org.feeBearer ?? "ORGANISER";
}

/** The pricing policy that applies to an order for this event, right now. */
export function pricingPolicyFor(
  org: Pick<Organization, "feeBps" | "feeBearer">,
  event: Pick<Event, "feeBearer"> | null,
  settings: PlatformSettings,
): PricingPolicy {
  return {
    feeBps: feeBpsFor(org, settings),
    gstBps: settings.gst.rateBps,
    bearer: feeBearerFor(org, event),
  };
}
