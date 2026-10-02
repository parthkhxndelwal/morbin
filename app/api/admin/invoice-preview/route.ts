import { AdminError, requireAdmin } from "@/lib/admin";
import { financialYear, invoiceNumber, splitTax } from "@/lib/invoice-rules";
import { getPlatformSettings } from "@/lib/platform-settings";
import { computePricing } from "@/lib/pricing";
import { buildInvoicePdf } from "@/lib/ticket-pdf";

/**
 * Admin → Settings → "Preview invoice": a sample fee invoice rendered from the
 * current GST details. Nothing is stored and no invoice number is used up.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch (error) {
    const status = error instanceof AdminError ? error.status : 403;
    return new Response("Forbidden", { status });
  }
  const s = await getPlatformSettings();
  const pricing = computePricing([{ unitPricePaise: 50000, quantity: 1 }], {
    feeBps: s.defaultFeeBps,
    gstBps: s.gst.rateBps,
    bearer: "CUSTOMER",
  });
  const now = new Date();
  const bytes = await buildInvoicePdf({
    number: invoiceNumber((s.gst.invoicePrefix || "MRB").slice(0, 3), financialYear(now), 0),
    financialYear: financialYear(now),
    kind: "CUSTOMER_FEE",
    orderId: "preview",
    organizationId: "preview",
    recipient: { name: "Sample Buyer", email: "buyer@example.com" },
    placeOfSupply: `${s.gst.state || "State"} (${s.gst.stateCode || "00"})`,
    sac: s.gst.sac || "------",
    description: "Convenience fee — order SAMPLE01, Sample Event (Rs. 500 ticket)",
    taxablePaise: pricing.feeBasePaise,
    ...splitTax(pricing.feeGstPaise, s.gst.splitRule),
    totalPaise: pricing.feePaise,
    rateBps: s.gst.rateBps,
    supplier: s.gst,
    issuedAt: now,
  });
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="invoice-preview.pdf"',
      "Cache-Control": "no-store",
    },
  });
}
