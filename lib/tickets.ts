import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function makeTicketCode(): string {
  return `MRB-${randomBytes(4).toString("hex").toUpperCase()}`;
}

/**
 * Canonical form of a ticket code — the exact form makeTicketCode emits and
 * therefore the only form the signature is computed over. Codes are always
 * uppercase, so a scanner or a pasted QR payload in any case still verifies.
 */
export function normaliseTicketCode(code: string): string {
  return code.trim().toUpperCase();
}

function ticketSecret(): string {
  const s = process.env.TICKET_SECRET ?? "";
  if (!s) throw new Error("TICKET_SECRET is not configured");
  return s;
}

/** Signed QR payload: code.signature */
export function signTicket(code: string): string {
  const canonical = normaliseTicketCode(code);
  const sig = createHmac("sha256", ticketSecret()).update(canonical).digest("hex").slice(0, 32);
  return `${canonical}.${sig}`;
}

export function verifyTicketPayload(payload: string): string | null {
  const [rawCode, rawSig] = payload.split(".");
  if (!rawCode || !rawSig) return null;
  const code = normaliseTicketCode(rawCode);
  const expected = createHmac("sha256", ticketSecret()).update(code).digest("hex").slice(0, 32);
  // Hex digests are case-insensitive; a scanner may hand back the payload in
  // any case, so compare on normalised bytes in constant time.
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(rawSig.trim().toLowerCase(), "utf8");
  if (a.length !== b.length) return null;
  return timingSafeEqual(a, b) ? code : null;
}

/** QR code as inline SVG (pure JS, Workers-safe). Falls back to null. */
export async function ticketQrSvg(payload: string): Promise<string | null> {
  try {
    const QRCode = (await import("qrcode")).default;
    return await QRCode.toString(payload, { type: "svg", margin: 1, width: 220 });
  } catch {
    return null;
  }
}
