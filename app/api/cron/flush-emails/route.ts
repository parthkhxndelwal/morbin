import { NextResponse } from "next/server";
import { flushEmailQueue } from "@/lib/email";
import { expireStaleOrders } from "@/lib/orders";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  // Fail closed: an unset secret must not leave the endpoint open.
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

/** Retry QUEUED email deliveries + expire stale CREATED orders. Guarded by CRON_SECRET. */
async function handle(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const expired = await expireStaleOrders();
  const result = await flushEmailQueue(50);
  return NextResponse.json({ ok: true, expiredOrders: expired, ...result });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
