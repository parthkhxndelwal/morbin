import { createHmac, randomBytes } from "node:crypto";

export function makeTicketCode(): string {
  return `MRB-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function ticketSecret(): string {
  const s = process.env.TICKET_SECRET ?? "";
  if (!s) throw new Error("TICKET_SECRET is not configured");
  return s;
}

/** Signed QR payload: code.signature */
export function signTicket(code: string): string {
  const sig = createHmac("sha256", ticketSecret()).update(code).digest("hex").slice(0, 32);
  return `${code}.${sig}`;
}

export function verifyTicketPayload(payload: string): string | null {
  const [code, sig] = payload.split(".");
  if (!code || !sig) return null;
  const expected = createHmac("sha256", ticketSecret())
    .update(code)
    .digest("hex")
    .slice(0, 32);
  return expected === sig ? code : null;
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
