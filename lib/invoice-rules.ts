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
