import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/email";

/** TEMPORARY staging-only SES smoke test. Sends to our own address. DELETE after verification. */
export async function POST() {
  const to = "no-reply@morbin.space";
  const r = await sendEmail({
    to,
    subject: "Morbin staging SES test",
    html: `<p>SES wiring works. Sent at ${new Date().toISOString()}.</p>`,
  });
  return NextResponse.json({ ok: r.ok, id: r.id ?? null, to });
}
