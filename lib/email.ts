import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

function sesClient(): SESv2Client | null {
  const region = process.env.AWS_REGION ?? "";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "";
  if (!region || !accessKeyId || !secretAccessKey) return null;
  return new SESv2Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function fromAddress(): string {
  return process.env.EMAIL_FROM ?? "Morbin <no-reply@morbin.space>";
}

export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; id?: string }> {
  const client = sesClient();
  if (!client) {
    console.info("[email:dev] AWS SES not configured; skipping send", { to, subject });
    return { ok: true };
  }
  try {
    const out = await client.send(
      new SendEmailCommand({
        FromEmailAddress: fromAddress(),
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: "UTF-8" },
            Body: { Html: { Data: html, Charset: "UTF-8" } },
          },
        },
      }),
    );
    return { ok: true, id: out.MessageId };
  } catch (error) {
    console.error("[email] SES send error", error);
    return { ok: false };
  }
}

export function appUrl(path = ""): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function ticketHtml({
  attendeeName,
  eventTitle,
  venue,
  startsAt,
  code,
  qrSvg,
}: {
  attendeeName: string;
  eventTitle: string;
  venue: string;
  startsAt: string;
  code: string;
  qrSvg: string | null;
}): string {
  const when = startsAt ? new Date(startsAt).toLocaleString("en-IN") : "";
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 4px">Your ticket — ${eventTitle}</h2>
    <p style="margin:0 0 16px;color:#555">${venue}${when ? ` · ${when}` : ""}</p>
    <p>Hi ${attendeeName},</p>
    <p>Show this QR code at the entrance. Each code admits one person.</p>
    ${qrSvg ? `<div style="margin:16px 0">${qrSvg}</div>` : ""}
    <p style="font-size:20px;font-weight:bold;letter-spacing:2px">${code}</p>
    <p style="color:#777;font-size:12px">Order via Morbin. Do not forward this email.</p>
  </div>`;
}

/** Send all QUEUED ticket/refund emails. Safe to run repeatedly (marks SENT/FAILED). */
export async function flushEmailQueue(limit = 20): Promise<{ sent: number; failed: number }> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  const queued = await db
    .collection("emailDeliveries")
    .find({ status: "QUEUED" })
    .limit(limit)
    .toArray();
  let sent = 0;
  let failed = 0;
  for (const job of queued) {
    try {
      const meta = (job.meta ?? {}) as {
        eventTitle?: string;
        eventVenue?: string;
        eventStartsAt?: string;
        attendeeName?: string;
        ticketCode?: string;
        qrSvg?: string | null;
      };
      let subject = "Your Morbin tickets";
      let html = "";
      if (job.kind === "TICKET") {
        subject = `Your ticket — ${meta.eventTitle ?? "Morbin event"}`;
        html = ticketHtml({
          attendeeName: meta.attendeeName ?? "Guest",
          eventTitle: meta.eventTitle ?? "Morbin event",
          venue: meta.eventVenue ?? "",
          startsAt: meta.eventStartsAt ?? "",
          code: meta.ticketCode ?? "",
          qrSvg: meta.qrSvg ?? null,
        });
      } else if (job.kind === "REFUND") {
        subject = "Your Morbin refund is on its way";
        html = `<p>Your order has been refunded. The amount should reach your account in 5–7 business days.</p>`;
      } else {
        subject = "Update about your event";
        html = `<p>There is an update about your event. Please check your tickets page.</p>`;
      }
      const r = await sendEmail({ to: job.recipient, subject, html });
      if (!r.ok) throw new Error("send failed");
      await db.collection("emailDeliveries").updateOne(
        { _id: job._id },
        {
          $set: { status: "SENT", sentAt: new Date(), providerMessageId: r.id ?? null },
          $inc: { attempts: 1 },
        },
      );
      sent++;
    } catch (error) {
      await db.collection("emailDeliveries").updateOne(
        { _id: job._id },
        {
          $set: {
            status: "FAILED",
            lastError: error instanceof Error ? error.message : "unknown",
          },
          $inc: { attempts: 1 },
        },
      );
      failed++;
    }
  }
  return { sent, failed };
}
