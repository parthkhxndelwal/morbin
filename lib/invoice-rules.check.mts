/**
 * Checks for the pure invoicing rules and the ticket PDF builder.
 *
 *   npm run check:invoice
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { amountInWords, financialYear, invoiceNumber, splitTax } from "./invoice-rules.ts";
import { buildTicketPdf } from "./ticket-pdf.ts";

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

await check("financial year turns over on 1 April, IST", () => {
  // 31 Mar 23:59 IST is 31 Mar 18:29 UTC; 1 Apr 00:01 IST is 31 Mar 18:31 UTC.
  assert.equal(financialYear(new Date("2027-03-31T18:29:00Z")), "26-27");
  assert.equal(financialYear(new Date("2027-03-31T18:31:00Z")), "27-28");
  assert.equal(financialYear(new Date("2026-10-02T10:00:00Z")), "26-27");
  assert.equal(financialYear(new Date("2099-06-01T00:00:00Z")), "99-00");
});

await check("invoice numbers never exceed 16 characters", () => {
  assert.equal(invoiceNumber("MRB", "26-27", 123), "MRB/26-27/000123");
  for (const prefix of ["M", "MR", "MRB"]) {
    for (const seq of [1, 999, 999999]) assert.ok(invoiceNumber(prefix, "26-27", seq).length <= 16, prefix);
  }
  assert.equal(invoiceNumber("M", "26-27", 7), "M/26-27/00000007");
  assert.throws(() => invoiceNumber("MRB", "26-27", 1_000_000), /16 characters/);
});

await check("CGST + SGST add back to the GST, odd paise included", () => {
  for (const gst of [0, 1, 534, 535, 99999]) {
    const t = splitTax(gst, "SUPPLIER_STATE");
    assert.equal(t.cgstPaise + t.sgstPaise, gst);
    assert.equal(t.igstPaise, 0);
  }
  assert.deepEqual(splitTax(534, "ALWAYS_IGST"), { cgstPaise: 0, sgstPaise: 0, igstPaise: 534 });
});

await check("amount in words uses Indian grouping", () => {
  assert.equal(amountInWords(3500), "Rupees Thirty Five Only");
  assert.equal(amountInWords(3540), "Rupees Thirty Five and Paise Forty Only");
  assert.equal(amountInWords(12345678900), "Rupees Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only");
  assert.equal(amountInWords(0), "Rupees Zero Only");
});

await check("ticket PDF builds, including a name the font can't encode", async () => {
  const bytes = await buildTicketPdf({
    event: { title: "Ideas 4.0 — Annual Tech Fest", venue: "KRMU Auditorium, Gurugram", startsAt: new Date("2026-11-20T12:30:00Z"), timezone: "Asia/Kolkata" },
    organizationName: "K.R. Mangalam University",
    orderRef: "ORDER 4574ADB5",
    tickets: [
      { code: "MRB-A9CF2D21", qrPayload: "MRB-A9CF2D21.f73d1e4f4850598d6702f91f27f584f2", attendeeName: "Asha Verma", ticketTypeName: "Guest" },
      { code: "MRB-2B3F68A7", qrPayload: "MRB-2B3F68A7.7fbc0f9a35ffe637eac2b72d5b50b90b", attendeeName: "आशा वर्मा", ticketTypeName: "Guest" },
    ],
    invoice: {
      number: "MRB/26-27/000001",
      financialYear: "26-27",
      kind: "CUSTOMER_FEE",
      orderId: "x",
      organizationId: "y",
      recipient: { name: "Asha Verma", email: "asha@example.com" },
      placeOfSupply: "Haryana (06)",
      sac: "998599",
      description: "Convenience fee — order 4574ADB5, Ideas 4.0 — Annual Tech Fest",
      taxablePaise: 5932,
      cgstPaise: 534,
      sgstPaise: 534,
      igstPaise: 0,
      totalPaise: 7000,
      rateBps: 1800,
      supplier: {
        legalName: "Morbin Technologies Private Limited",
        tradeName: "Morbin",
        gstin: "06AAPFU0939F1ZV",
        pan: "AAPFU0939F",
        address: "Plot 1, Sector 44, Gurugram, Haryana 122003",
        state: "Haryana",
        stateCode: "06",
        sac: "998599",
        rateBps: 1800,
        splitRule: "SUPPLIER_STATE",
        invoicePrefix: "MRB",
        footerText: "This is a computer-generated invoice and does not require a signature.",
      },
      issuedAt: new Date("2026-10-02T10:00:00Z"),
    },
  });
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
  assert.ok(bytes.length > 2000);
  if (process.env.WRITE_SAMPLE) writeFileSync(process.env.WRITE_SAMPLE, bytes);
});

console.log(`\n${passed} invoice checks passed`);
