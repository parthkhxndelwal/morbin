import type { PaymentAccountStatus } from "@/lib/types";

function credentials(): { id: string; secret: string } {
  const id = process.env.RAZORPAY_KEY_ID ?? "";
  const secret = process.env.RAZORPAY_KEY_SECRET ?? "";
  if (!id || !secret) throw new Error("Razorpay is not configured");
  return { id, secret };
}

async function rzp(path: string, init?: RequestInit) {
  const { id, secret } = credentials();
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      `Razorpay ${path} failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return body as Record<string, unknown>;
}

/** Create a Route linked account for an organizer. Returns the account id. */
export async function createLinkedAccount({
  name,
  email,
  orgId,
}: {
  name: string;
  email: string;
  orgId?: string;
}): Promise<string> {
  let body: Record<string, unknown>;
  try {
    body = await rzp("/accounts", {
      method: "POST",
      body: JSON.stringify({
        email,
        phone: process.env.RAZORPAY_ACCOUNT_PHONE ?? "9000090000",
        type: "route",
        reference_id: `org-${orgId ?? Date.now()}-${Date.now()}`,
        legal_business_name: name,
        business_type: "individual",
        contact_name: name,
      }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // The common case: standard Razorpay keys without the Route product. The
    // raw "URL not found / BAD_REQUEST_ERROR" is unactionable, so translate it.
    if (message.includes("/accounts") && (message.includes("400") || message.includes("404"))) {
      throw new Error(
        "Razorpay Route is not enabled for these API keys (POST /v1/accounts failed). " +
          "Enable Route in the Razorpay dashboard, use keys from a Route-enabled account, " +
          "or verify the organizer manually. Original: " +
          message.slice(0, 200),
      );
    }
    throw error;
  }
  if (typeof body.id !== "string") throw new Error("Razorpay did not return an account id");
  return body.id;
}

function mapStatus(raw: unknown): PaymentAccountStatus {
  const s = String(raw ?? "").toLowerCase();
  if (["activated", "active", "verified", "approved"].includes(s)) return "VERIFIED";
  if (["rejected", "suspended", "terminated"].includes(s)) return "REJECTED";
  if (["restricted", "under_review", "on_hold"].includes(s)) return "RESTRICTED";
  return "PENDING";
}

/** Fetch linked-account status from Razorpay and map it to our enum. */
export async function fetchLinkedAccountStatus(
  razorpayAccountId: string,
): Promise<PaymentAccountStatus> {
  const body = await rzp(`/accounts/${razorpayAccountId}`);
  return mapStatus(body.status ?? body.account_status);
}
