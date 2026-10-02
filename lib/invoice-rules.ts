import type { GstSettings } from "@/lib/types";

/**
 * The pure parts of invoicing — numbering, tax split, amount in words — with
 * no database or server imports, so the PDF builder and check scripts can use
 * them directly.
 */

/** Indian financial year (April–March) in IST, as "26-27". */
export function financialYear(at: Date): string {
  const ist = new Date(at.getTime() + 5.5 * 60 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/**
 * `PREFIX/26-27/000123`. GST caps invoice numbers at 16 characters, so a
 * prefix of at most 3 leaves six digits: 999,999 invoices per financial year.
 * Throws rather than ever issuing a non-compliant number.
 */
export function invoiceNumber(prefix: string, fy: string, seq: number): string {
  const head = `${prefix}/${fy}/`;
  const number = `${head}${String(seq).padStart(Math.max(1, 16 - head.length), "0")}`;
  if (number.length > 16) throw new Error(`Invoice number ${number} exceeds 16 characters`);
  return number;
}

/** Split GST into CGST + SGST (intra-state) or IGST, per the platform setting. */
export function splitTax(gstPaise: number, rule: GstSettings["splitRule"]) {
  if (rule === "ALWAYS_IGST") return { cgstPaise: 0, sgstPaise: 0, igstPaise: gstPaise };
  const cgstPaise = Math.floor(gstPaise / 2);
  return { cgstPaise, sgstPaise: gstPaise - cgstPaise, igstPaise: 0 };
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? belowHundred(r) : ""].filter(Boolean).join(" ");
}

/** "Rupees Thirty Five and Paise Forty Only" — Indian grouping (lakh, crore). */
export function amountInWords(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const p = paise % 100;
  const parts: string[] = [];
  let n = rupees;
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  const words = parts.join(" ") || "Zero";
  return `Rupees ${words}${p ? ` and Paise ${belowHundred(p)}` : ""} Only`;
}

/**
 * GST state codes (the first two digits of a GSTIN), for place of supply.
 * Includes union territories and the "Other Territory" / "Centre
 * Jurisdiction" codes the GST portal uses.
 */
export const GST_STATES: readonly { code: string; name: string }[] = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
  { code: "99", name: "Centre Jurisdiction" },
];

export function gstStateName(code: string | null | undefined): string | null {
  return GST_STATES.find((s) => s.code === code)?.name ?? null;
}

export interface PlaceOfSupplyInput {
  supplier: Pick<GstSettings, "state" | "stateCode" | "splitRule">;
  recipient: { gstin?: string | null; state?: string | null; stateCode?: string | null };
}

export interface PlaceOfSupply {
  state: string;
  stateCode: string;
  /** IGST when true; CGST + SGST when false. */
  interState: boolean;
}

/**
 * Place of supply for a B2B service invoice to an organisation (IGST Act
 * s.12(2)): a registered recipient's location, else the recipient's address
 * when known, else the supplier's location. Supply is intra-state (CGST + SGST)
 * only when that place is the supplier's own state. A registered recipient's
 * state is read from its GSTIN, which is authoritative over the profile field.
 * `ALWAYS_IGST` forces IGST regardless.
 */
export function orgPlaceOfSupply({ supplier, recipient }: PlaceOfSupplyInput): PlaceOfSupply {
  const gstinCode = recipient.gstin?.trim().slice(0, 2) || null;
  const code = gstinCode ?? (recipient.stateCode || null) ?? supplier.stateCode;
  const known = code === supplier.stateCode ? supplier.state : (gstStateName(code) ?? recipient.state ?? code);
  return {
    state: known,
    stateCode: code,
    interState: supplier.splitRule === "ALWAYS_IGST" || code !== supplier.stateCode,
  };
}

/** GST split for a known place of supply. */
export function splitTaxFor(gstPaise: number, interState: boolean) {
  return splitTax(gstPaise, interState ? "ALWAYS_IGST" : "SUPPLIER_STATE");
}
