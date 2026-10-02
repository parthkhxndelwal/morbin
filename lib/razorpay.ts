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
