import { createHmac, timingSafeEqual } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RzpInstance = any;

let cached: RzpInstance | null = null;

function env(key: string): string {
  const v = process.env[key] ?? "";
  if (!v) throw new Error(`${key} is not configured`);
  return v;
}

/** Lazy Razorpay SDK client (server-only). */
export async function getRazorpay(): Promise<RzpInstance> {
  if (cached) return cached;
  const { default: Razorpay } = await import("razorpay");
  cached = new Razorpay({ key_id: env("RAZORPAY_KEY_ID"), key_secret: env("RAZORPAY_KEY_SECRET") });
  return cached;
}

/**
 * Create the Razorpay order a buyer pays against. Only ids go in `notes` —
 * never names, emails or phone numbers (DPDP minimisation).
 */
export async function createTicketOrder({
  amountPaise,
  receipt,
  notes,
}: {
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}) {
  const rzp = await getRazorpay();
  return (await rzp.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt,
    notes,
  })) as { id: string; amount: number; currency: string; status: string };
}

export interface RazorpayPayment {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: string;
  captured: boolean;
  method: string | null;
  /** Razorpay's fee for this payment in paise, including `tax`. */
  fee: number | null;
  tax: number | null;
}

export async function fetchPayment(paymentId: string): Promise<RazorpayPayment> {
  const rzp = await getRazorpay();
  return (await rzp.payments.fetch(paymentId)) as RazorpayPayment;
}

/** Verify webhook signature over the RAW request body. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: "pending" | "processed" | "failed";
  speed_processed?: string | null;
  acquirer_data?: { arn?: string | null; rrn?: string | null } | null;
  notes?: Record<string, string> | null;
}

/**
 * Refund part of a captured payment to the customer's original method.
 *
 * `refundCaseItemId` goes into the refund's notes and is looked up first, so a
 * retry after a timeout finds the refund the first attempt created instead of
 * refunding twice.
 */
export async function refundPayment(input: {
  paymentId: string;
  amountPaise: number;
  speed: "normal" | "optimum";
  refundCaseId: string;
}): Promise<RazorpayRefund> {
  const rzp = await getRazorpay();
  const existing = await findRefundForCase(input.paymentId, input.refundCaseId);
  if (existing) return existing;
  return (await rzp.payments.refund(input.paymentId, {
    amount: input.amountPaise,
    speed: input.speed,
    receipt: input.refundCaseId.slice(0, 40),
    notes: { refundCaseId: input.refundCaseId },
  })) as RazorpayRefund;
}

export async function findRefundForCase(
  paymentId: string,
  refundCaseId: string,
): Promise<RazorpayRefund | null> {
  const rzp = await getRazorpay();
  const list = (await rzp.payments.fetchMultipleRefund(paymentId, { count: 100 })) as {
    items: RazorpayRefund[];
  };
  return list.items.find((r) => r.notes?.refundCaseId === refundCaseId) ?? null;
}

export type RazorpayBalance =
  | { available: true; balancePaise: number; currency: string; fetchedAt: string }
  | { available: false; reason: string };

const BALANCE_TTL_MS = 60_000;

declare global {
  var __morbin_rzp_balance: { at: number; value: RazorpayBalance } | undefined;
}

/**
 * Morbin's Razorpay account balance, which refunds are paid from. Cached for
 * 60s server-side so the refunds queue doesn't call Razorpay on every render.
 *
 * Razorpay documents a balance API only for RazorpayX accounts; for payment
 * gateway accounts `GET /v1/balance` answers when the account has it enabled.
 * Anything else — keys missing, the endpoint not enabled, a timeout — comes
 * back as `available: false` with a reason to show, never as an error.
 */
export async function fetchBalance(now = Date.now()): Promise<RazorpayBalance> {
  const hit = globalThis.__morbin_rzp_balance;
  if (hit && now - hit.at < BALANCE_TTL_MS) return hit.value;
  const value = await loadBalance();
  globalThis.__morbin_rzp_balance = { at: now, value };
  return value;
}

async function loadBalance(): Promise<RazorpayBalance> {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !secret) return { available: false, reason: "Razorpay keys aren't configured" };
  try {
    const res = await fetch("https://api.razorpay.com/v1/balance", {
      headers: { Authorization: `Basic ${Buffer.from(`${keyId}:${secret}`).toString("base64")}` },
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as
      | { balance?: number; currency?: string; error?: { description?: string } }
      | null;
    if (!res.ok || typeof body?.balance !== "number") {
      const why = body?.error?.description;
      return {
        available: false,
        reason: why ? `Razorpay: ${why}` : `Razorpay didn't return a balance for this account (HTTP ${res.status})`,
      };
    }
    return { available: true, balancePaise: body.balance, currency: body.currency ?? "INR", fetchedAt: new Date().toISOString() };
  } catch (error) {
    return {
      available: false,
      reason: (error as Error)?.name === "TimeoutError" ? "Razorpay didn't answer in time" : "Couldn't reach Razorpay",
    };
  }
}
