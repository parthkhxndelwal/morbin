import { NextResponse } from "next/server";
import { flushEmailQueue } from "@/lib/email";

/** Retry QUEUED/failed email deliveries. Protect with CRON_SECRET in production use. */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await flushEmailQueue(50);
  // Re-queue recent failures for another attempt (cap attempts at 5).
  return NextResponse.json({ ok: true, ...result });
}
