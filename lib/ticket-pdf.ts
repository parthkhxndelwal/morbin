import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import { formatDateTime } from "@/lib/format";
import { amountInWords } from "@/lib/invoice-rules";
import type { Invoice } from "@/lib/types";

/**
 * The ticket document: one A4 page per ticket (event, attendee, ticket type,
 * QR code) and, when the buyer paid a convenience fee, the GST tax invoice as
 * the last page. Pure — data in, bytes out — so it is testable and has no
 * external service.
 *
 * Text uses the standard PDF fonts, which only encode Latin text (WinAnsi):
 * anything else is replaced rather than crashing the document. Amounts are
 * written "Rs." because the rupee sign is not in those fonts.
 */

export interface TicketPdfInput {
  event: { title: string; venue: string; startsAt: Date; timezone?: string | null };
  organizationName: string;
  orderRef: string;
  tickets: { code: string; qrPayload: string; attendeeName: string; ticketTypeName: string }[];
  invoice: Invoice | null;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 48;
const INK = rgb(0.07, 0.07, 0.09);
const MUTED = rgb(0.42, 0.42, 0.47);
const ACCENT = rgb(0.486, 0.227, 0.929);
const RULE = rgb(0.86, 0.86, 0.89);

function rs(paise: number): string {
  return `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Keep only what the font can encode, so a name in another script can't break the PDF. */
function safeText(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/** Greedy word wrap to a width, at most `maxLines` lines (the last gets an ellipsis). */
function wrap(font: PDFFont, text: string, size: number, width: number, maxLines = 3): string[] {
  const words = safeText(font, text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width) line = next;
    else {
      if (line) lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S*$/, "")}...`;
    return kept;
  }
  return lines;
}

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

function text(page: PDFPage, f: PDFFont, s: string, x: number, y: number, size: number, color = INK) {
  page.drawText(safeText(f, s), { x, y, size, font: f, color });
}

function rightText(page: PDFPage, f: PDFFont, s: string, xRight: number, y: number, size: number, color = INK) {
  const t = safeText(f, s);
  page.drawText(t, { x: xRight - f.widthOfTextAtSize(t, size), y, size, font: f, color });
}

/** Draw a QR code as vector squares: sharp at any zoom, no image decoding. */
function drawQr(page: PDFPage, payload: string, x: number, y: number, size: number) {
  const qr = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2;
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.modules.get(r, c)) continue;
      page.drawRectangle({
        x: x + (c + quiet) * cell,
        y: y + size - (r + quiet + 1) * cell,
        width: cell + 0.2,
        height: cell + 0.2,
        color: INK,
      });
    }
  }
}

function ticketPage(doc: PDFDocument, fonts: Fonts, input: TicketPdfInput, t: TicketPdfInput["tickets"][number], i: number) {
  const page = doc.addPage(A4);
  const [w, h] = A4;
  const inner = w - MARGIN * 2;
  let y = h - MARGIN;

  page.drawRectangle({ x: 0, y: h - 8, width: w, height: 8, color: ACCENT });
  text(page, fonts.bold, "MORBIN", MARGIN, y - 10, 10, ACCENT);
  rightText(page, fonts.regular, `Ticket ${i + 1} of ${input.tickets.length}`, w - MARGIN, y - 10, 10, MUTED);
  y -= 48;

  for (const line of wrap(fonts.bold, input.event.title, 26, inner)) {
    text(page, fonts.bold, line, MARGIN, y, 26);
    y -= 32;
  }
  text(page, fonts.regular, formatDateTime(input.event.startsAt, input.event.timezone ?? undefined), MARGIN, y, 13);
  y -= 18;
  for (const line of wrap(fonts.regular, input.event.venue, 13, inner, 2)) {
    text(page, fonts.regular, line, MARGIN, y, 13, MUTED);
    y -= 18;
  }
  y -= 18;

  const rows: [string, string][] = [
    ["Attendee", t.attendeeName],
    ["Ticket", t.ticketTypeName],
    ["Organised by", input.organizationName],
    ["Order", input.orderRef],
  ];
  for (const [label, value] of rows) {
    text(page, fonts.regular, label.toUpperCase(), MARGIN, y, 9, MUTED);
    text(page, fonts.bold, value, MARGIN + 110, y, 12);
    y -= 22;
  }

  const qrSize = 240;
  const qrY = Math.min(y - 24, 360) - qrSize;
  const qrX = (w - qrSize) / 2;
  page.drawRectangle({ x: qrX - 12, y: qrY - 12, width: qrSize + 24, height: qrSize + 24, borderColor: RULE, borderWidth: 1 });
  drawQr(page, t.qrPayload, qrX, qrY, qrSize);
  const code = safeText(fonts.bold, t.code);
  page.drawText(code, { x: (w - fonts.bold.widthOfTextAtSize(code, 16)) / 2, y: qrY - 40, size: 16, font: fonts.bold, color: INK });

  const note = "Show this QR code at the entrance. Each ticket is admitted once.";
  const noteText = safeText(fonts.regular, note);
  page.drawText(noteText, { x: (w - fonts.regular.widthOfTextAtSize(noteText, 10)) / 2, y: qrY - 62, size: 10, font: fonts.regular, color: MUTED });
  text(page, fonts.regular, "Sold through Morbin · morbin.space", MARGIN, MARGIN - 12, 8, MUTED);
}

function invoicePage(doc: PDFDocument, fonts: Fonts, inv: Invoice) {
  const page = doc.addPage(A4);
  const [w, h] = A4;
  const right = w - MARGIN;
  let y = h - MARGIN - 10;
  const s = inv.supplier;

  text(page, fonts.bold, "TAX INVOICE", MARGIN, y, 20);
  rightText(page, fonts.regular, "Original for recipient", right, y + 4, 9, MUTED);
  y -= 34;

  text(page, fonts.bold, s.legalName, MARGIN, y, 12);
  y -= 15;
  if (s.tradeName && s.tradeName !== s.legalName) {
    text(page, fonts.regular, `Trading as ${s.tradeName}`, MARGIN, y, 10, MUTED);
    y -= 14;
  }
  for (const line of wrap(fonts.regular, s.address, 10, 300, 3)) {
    text(page, fonts.regular, line, MARGIN, y, 10);
    y -= 14;
  }
  text(page, fonts.regular, `GSTIN: ${s.gstin}${s.pan ? `   PAN: ${s.pan}` : ""}`, MARGIN, y, 10);
  y -= 14;
  text(page, fonts.regular, `State: ${s.state} (${s.stateCode})`, MARGIN, y, 10);

  let ry = h - MARGIN - 44;
  const meta: [string, string][] = [
    ["Invoice no.", inv.number],
    ["Invoice date", formatDateTime(inv.issuedAt).split(",").slice(0, 1).join("")],
    ["Place of supply", inv.placeOfSupply],
  ];
  for (const [label, value] of meta) {
    rightText(page, fonts.regular, label, right - 130, ry, 9, MUTED);
    rightText(page, fonts.bold, value, right, ry, 10);
    ry -= 16;
  }
  y -= 34;

  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: RULE });
  y -= 20;
  text(page, fonts.regular, "BILLED TO", MARGIN, y, 9, MUTED);
  y -= 16;
  text(page, fonts.bold, inv.recipient.name, MARGIN, y, 11);
  y -= 14;
  text(page, fonts.regular, inv.recipient.email, MARGIN, y, 10);
  y -= 14;
  text(page, fonts.regular, "Unregistered (no GSTIN)", MARGIN, y, 10, MUTED);
  y -= 30;

  // Line items.
  page.drawRectangle({ x: MARGIN, y: y - 6, width: right - MARGIN, height: 22, color: rgb(0.96, 0.96, 0.98) });
  text(page, fonts.bold, "Description", MARGIN + 8, y, 9);
  text(page, fonts.bold, "SAC", MARGIN + 300, y, 9);
  rightText(page, fonts.bold, "Taxable value", right - 8, y, 9);
  y -= 26;
  const desc = wrap(fonts.regular, inv.description, 10, 280, 3);
  desc.forEach((line, i) => text(page, fonts.regular, line, MARGIN + 8, y - i * 13, 10));
  text(page, fonts.regular, inv.sac, MARGIN + 300, y, 10);
  rightText(page, fonts.regular, rs(inv.taxablePaise), right - 8, y, 10);
  y -= desc.length * 13 + 16;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 1, color: RULE });
  y -= 20;

  const pct = (bps: number) => `${(bps / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
  const totals: [string, string][] = [["Taxable value", rs(inv.taxablePaise)]];
  if (inv.igstPaise) totals.push([`IGST @ ${pct(inv.rateBps)}`, rs(inv.igstPaise)]);
  else {
    totals.push([`CGST @ ${pct(inv.rateBps / 2)}`, rs(inv.cgstPaise)]);
    totals.push([`SGST @ ${pct(inv.rateBps / 2)}`, rs(inv.sgstPaise)]);
  }
  for (const [label, value] of totals) {
    rightText(page, fonts.regular, label, right - 140, y, 10, MUTED);
    rightText(page, fonts.regular, value, right - 8, y, 10);
    y -= 16;
  }
  y -= 4;
  page.drawLine({ start: { x: right - 260, y: y + 8 }, end: { x: right, y: y + 8 }, thickness: 1, color: RULE });
  rightText(page, fonts.bold, "Total", right - 140, y - 6, 11);
  rightText(page, fonts.bold, rs(inv.totalPaise), right - 8, y - 6, 11);
  y -= 36;

  for (const line of wrap(fonts.regular, `Amount in words: ${amountInWords(inv.totalPaise)}`, 10, right - MARGIN, 2)) {
    text(page, fonts.regular, line, MARGIN, y, 10);
    y -= 14;
  }
  y -= 10;
  text(page, fonts.regular, "Tax payable on reverse charge: No", MARGIN, y, 9, MUTED);

  for (const [i, line] of wrap(fonts.regular, s.footerText, 9, right - MARGIN, 3).entries()) {
    text(page, fonts.regular, line, MARGIN, MARGIN + 20 - i * 12, 9, MUTED);
  }
}

export async function buildTicketPdf(input: TicketPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Tickets — ${input.event.title}`);
  doc.setAuthor("Morbin");
  doc.setCreator("Morbin");
  doc.setProducer("Morbin");
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  input.tickets.forEach((t, i) => ticketPage(doc, fonts, input, t, i));
  if (input.invoice) invoicePage(doc, fonts, input.invoice);
  return doc.save();
}

/** A standalone invoice PDF (Admin → Settings preview). */
export async function buildInvoicePdf(invoice: Invoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Invoice ${invoice.number}`);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  invoicePage(doc, fonts, invoice);
  return doc.save();
}
