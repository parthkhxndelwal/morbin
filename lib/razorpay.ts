import { createHmac } from "node:crypto";

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

export async function fetchPayment(paymentId: string) {
  const rzp = await getRazorpay();
  return (await rzp.payments.fetch(paymentId)) as {
    id: string;
    order_id: string | null;
    amount: number;
    currency: string;
    status: string;
    captured: boolean;
  };
}

/** Verify checkout success signature: HMAC(orderId|paymentId). */
export function verifyPaymentSignature({
  orderId,
  paymentId,
  signature,
}: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const expected = createHmac("sha256", env("RAZORPAY_KEY_SECRET"))
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return expected === signature;
}

/** Verify webhook signature over the RAW request body. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return expected === signature;
}

/** Create a Route transfer of captured funds to the organizer's linked account. */
export async function createOrganizerTransfer({
  account,
  amountPaise,
  notes,
}: {
  account: string;
  amountPaise: number;
  notes: Record<string, string>;
}) {
  const rzp = await getRazorpay();
  return (await rzp.transfers.create({
    account,
    amount: amountPaise,
    currency: "INR",
    notes,
  })) as { id: string; status: string };
}

/** Refund a captured payment (optionally reversing transfers). */
export async function refundPayment(
  paymentId: string,
  amountPaise: number,
  reverseAll = true,
) {
  const rzp = await getRazorpay();
  return (await rzp.payments.refund(paymentId, {
    amount: amountPaise,
    reverse_all: reverseAll,
  })) as { id: string; status: string };
}
