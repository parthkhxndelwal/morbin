import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { formatDateTime } from "@/lib/format";

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

export interface EmailAttachment {
  fileName: string;
  contentType: string;
  body: Buffer;
}

/** RFC 2047 encoded-word, so non-ASCII subjects survive every mail client. */
function encodeHeader(value: string): string {
  return /^[ -~]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Base64 wrapped at 76 characters, as MIME requires. */
function base64Lines(buf: Buffer): string {
  return buf.toString("base64").replace(/.{1,76}/g, "$&\r\n");
}

/**
 * A multipart/mixed message: the HTML body plus attachments. SES's simple
 * content can't carry files, so emails with attachments go out as raw MIME.
 * Header values are ours or validated addresses; CR/LF is stripped regardless
 * so nothing can inject a header.
 */
function buildMime(input: { from: string; to: string; replyTo?: string | null; subject: string; html: string; attachments: EmailAttachment[] }): Buffer {
  const clean = (v: string) => v.replace(/[\r\n]+/g, " ");
  const boundary = `morbin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: ${clean(input.from)}`,
    `To: ${clean(input.to)}`,
    ...(input.replyTo ? [`Reply-To: ${clean(input.replyTo)}`] : []),
    `Subject: ${encodeHeader(clean(input.subject))}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(input.html, "utf8")),
  ];
  for (const a of input.attachments) {
    const name = clean(a.fileName).replace(/"/g, "");
    lines.push(
      `--${boundary}`,
      `Content-Type: ${a.contentType}; name="${name}"`,
      `Content-Disposition: attachment; filename="${name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64Lines(a.body),
    );
  }
  lines.push(`--${boundary}--`, "");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

export async function sendEmail({
  to,
  subject,
  html,
  replyTo,
  attachments = [],
}: {
  to: string;
  subject: string;
  html: string;
  /** Where a reply should go when the From address isn't read by a person. */
  replyTo?: string | null;
  attachments?: EmailAttachment[];
}): Promise<{ ok: boolean; id?: string; dev?: boolean }> {
  const client = sesClient();
  if (!client) {
    console.info("[email:dev] AWS SES not configured; skipping send", {
      to,
      subject,
      attachments: attachments.map((a) => `${a.fileName} (${a.body.length} bytes)`),
    });
    return { ok: true, dev: true };
  }
  try {
    const out = await client.send(
      new SendEmailCommand(
        attachments.length
          ? {
              Destination: { ToAddresses: [to] },
              Content: {
                Raw: { Data: buildMime({ from: fromAddress(), to, replyTo, subject, html, attachments }) },
              },
            }
          : {
              FromEmailAddress: fromAddress(),
              Destination: { ToAddresses: [to] },
              ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
              Content: {
                Simple: {
                  Subject: { Data: subject, Charset: "UTF-8" },
                  Body: { Html: { Data: html, Charset: "UTF-8" } },
                },
              },
            },
      ),
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

/** A big tap-target button. Email clients strip most CSS, so this stays inline. */
function emailButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0">
    <tr><td align="center" bgcolor="#7c3aed" style="border-radius:999px">
      <a href="${href}" style="display:inline-block;padding:13px 28px;color:#fff;
        text-decoration:none;font-weight:bold;font-size:15px">${label}</a>
    </td></tr>
  </table>`;
}

function magicLinkHtml({
  attendeeName,
  eventTitle,
  eventVenue,
  link,
}: {
  attendeeName: string;
  eventTitle: string;
  eventVenue: string;
  link: string;
}): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 4px">Confirm your email to continue</h2>
    <p style="margin:0 0 16px;color:#555">${eventVenue || eventTitle}</p>
    <p>Hi ${attendeeName},</p>
    <p>Tap the button below to confirm this address and pick up your tickets.
       This link works once and expires in 15 minutes.</p>
    ${emailButton(link, "Confirm my email")}
    <p style="color:#777;font-size:12px;word-break:break-all">
      If the button does not work, paste this into your browser:<br>${link}
    </p>
    <p style="color:#777;font-size:12px">If you did not request this, ignore this email.</p>
  </div>`;
}

function verifyEmailHtml({
  link,
  appBase,
}: {
  link: string;
  appBase: string;
}): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 16px">Confirm your email address</h2>
    <p>Tap below to activate your Morbin account.</p>
    ${emailButton(link, "Confirm email")}
    <p style="color:#777;font-size:12px;word-break:break-all">
      If the button does not work, paste this into your browser:<br>${link}
    </p>
    <p style="color:#777;font-size:12px">Book tickets at <a href="${appBase}">${appBase}</a>.</p>
  </div>`;
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

/** Escape text interpolated into email HTML (names and titles are user input). */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function rupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}

function refundHtml(m: {
  attendeeName: string;
  eventTitle: string;
  amountPaise: number;
  stage: "SENT" | "COMPLETED" | "APPROVED_ORG";
  arn: string | null;
  speed: "NORMAL" | "INSTANT";
}): string {
  const amount = rupees(m.amountPaise);
  const body =
    m.stage === "APPROVED_ORG"
      ? `<p>Your refund of <strong>${amount}</strong> for ${m.eventTitle} has been approved. The organiser will
         contact you to send it directly.</p>`
      : m.stage === "SENT"
        ? `<p>We've started a refund of <strong>${amount}</strong> for ${m.eventTitle} to your original payment
           method. ${m.speed === "INSTANT" ? "It should arrive within minutes." : "It usually arrives within 5–7 working days."}</p>`
        : `<p>Your refund of <strong>${amount}</strong> for ${m.eventTitle} has been completed.</p>
           ${m.arn ? `<p>Bank reference (ARN/RRN): <strong>${m.arn}</strong> — your bank can use this to trace it.</p>` : ""}`;
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 16px">Refund update</h2>
    <p>Hi ${m.attendeeName},</p>
    ${body}
    <p style="color:#555">The refunded tickets are no longer valid for entry. Convenience fees are non-refundable.</p>
  </div>`;
}

function teamHtml(m: {
  kind: "TEAM_INVITE" | "TEAM_ADDED";
  name: string;
  organizationName: string;
  inviterName: string;
  link: string;
}): string {
  const invite = m.kind === "TEAM_INVITE";
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 16px">${invite ? `Join ${m.organizationName} on Morbin` : `You've been added to ${m.organizationName}`}</h2>
    <p>Hi ${m.name},</p>
    <p>${m.inviterName} ${invite ? "has invited you to" : "has added you to"} <strong>${m.organizationName}</strong> on Morbin,
       where you can see its events and check tickets in at the door.</p>
    ${
      invite
        ? `<p>Choose a password to set up your account. This link works once and expires in 7 days.</p>
           ${emailButton(m.link, "Accept the invite")}
           <p style="color:#777;font-size:12px;word-break:break-all">
             If the button does not work, paste this into your browser:<br>${m.link}
           </p>`
        : `${emailButton(m.link, "Open the dashboard")}`
    }
    <p style="color:#777;font-size:12px">If you weren't expecting this, you can ignore this email${
      invite ? " and no account will be created" : ""
    }.</p>
  </div>`;
}

function ticketPdfHtml(m: {
  attendeeName: string;
  eventTitle: string;
  venue: string;
  startsAt: string;
  count: number;
  link: string | null;
}): string {
  const when = m.startsAt ? esc(formatDateTime(m.startsAt)) : "";
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <h2 style="margin:0 0 4px">You're going to ${m.eventTitle}</h2>
    <p style="margin:0 0 16px;color:#555">${[when, m.venue].filter(Boolean).join(" · ")}</p>
    <p>Hi ${m.attendeeName},</p>
    <p>Your ${m.count === 1 ? "ticket is" : `${m.count} tickets are`} attached as a PDF. Show the QR code on each ticket at
       the entrance — on your phone or printed. If you paid a convenience fee, its tax invoice is the last page.</p>
    ${m.link ? emailButton(m.link, "View my tickets") : ""}
    <p style="color:#777;font-size:12px">Each QR code is admitted once. Don't share it publicly.</p>
  </div>`;
}

/** Attempts before a delivery is given up as FAILED (≈ 1 + 2 + 4 + 8 + 16 min). */
const MAX_ATTEMPTS = 6;
/** A claim older than this is assumed abandoned (process crashed mid-send). */
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * Send due QUEUED emails. Safe to run concurrently and repeatedly: each job is
 * claimed atomically (QUEUED → SENDING) before sending, so two flushers never
 * send the same email; failures back off exponentially and give up after
 * MAX_ATTEMPTS. The QR image is dropped from the record once sent.
 */
export async function flushEmailQueue(limit = 20): Promise<{ sent: number; failed: number }> {
  const { getDb } = await import("@/lib/db");
  const db = await getDb();
  const now = new Date();
  await db
    .collection("emailDeliveries")
    .updateMany(
      { status: "SENDING", claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
      { $set: { status: "QUEUED" } },
    );

  let sent = 0;
  let failed = 0;
  for (let i = 0; i < limit; i++) {
    const job = await db.collection("emailDeliveries").findOneAndUpdate(
      {
        status: "QUEUED",
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }],
      },
      { $set: { status: "SENDING", claimedAt: new Date() } },
      { sort: { _id: 1 }, returnDocument: "after" },
    );
    if (!job) break;
    try {
      const meta = (job.meta ?? {}) as NonNullable<import("@/lib/types").EmailRecord["meta"]>;
      const eventTitle = esc(meta.eventTitle ?? "Morbin event");
      const attendeeName = esc(meta.attendeeName ?? "there");
      let subject: string;
      let html: string;
      let attachments: EmailAttachment[] = [];
      if (job.kind === "TICKET_PDF") {
        const { getOrderTicketPdf } = await import("@/lib/ticket-documents");
        const pdf = job.orderId ? await getOrderTicketPdf(job.orderId) : null;
        if (!pdf) throw new Error("ticket PDF not ready");
        attachments = [{ fileName: pdf.fileName, contentType: "application/pdf", body: pdf.body }];
        const count = Number(meta.ticketCode ?? "1") || 1;
        subject = `Your ${count === 1 ? "ticket" : `${count} tickets`} — ${meta.eventTitle ?? "Morbin event"}`;
        html = ticketPdfHtml({
          attendeeName,
          eventTitle,
          venue: esc(meta.eventVenue ?? ""),
          startsAt: meta.eventStartsAt ?? "",
          count,
          link: meta.link ? esc(appUrl(meta.link)) : null,
        });
      } else if (job.kind === "TICKET") {
        subject = `Your ticket — ${meta.eventTitle ?? "Morbin event"}`;
        html = ticketHtml({
          attendeeName,
          eventTitle,
          venue: esc(meta.eventVenue ?? ""),
          startsAt: meta.eventStartsAt ?? "",
          code: esc(meta.ticketCode ?? ""),
          qrSvg: meta.qrSvg ?? null,
        });
      } else if (job.kind === "FLOW_MAGIC_LINK") {
        // `ticketCode` carries the link for this kind.
        subject = `Confirm your email to book — ${meta.eventTitle ?? "Morbin event"}`;
        html = magicLinkHtml({
          attendeeName,
          eventTitle,
          eventVenue: esc(meta.eventVenue ?? ""),
          link: meta.ticketCode ?? "",
        });
      } else if (job.kind === "EMAIL_VERIFY") {
        subject = "Confirm your Morbin email address";
        html = verifyEmailHtml({ link: meta.ticketCode ?? "", appBase: appUrl() });
      } else if (job.kind === "REFUND") {
        subject =
          meta.refundStage === "COMPLETED"
            ? `Refund completed — ${meta.eventTitle ?? "your event"}`
            : `Refund update — ${meta.eventTitle ?? "your event"}`;
        html = refundHtml({
          attendeeName,
          eventTitle,
          amountPaise: meta.refundAmountPaise ?? 0,
          stage: meta.refundStage ?? "SENT",
          arn: meta.refundArn ? esc(meta.refundArn) : null,
          speed: meta.refundSpeed ?? "NORMAL",
        });
      } else if (job.kind === "APPLICATION") {
        const org = esc(meta.organizationName ?? "your organisation");
        const note = meta.message ? `<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #7c3aed;background:#f6f3ff">${esc(meta.message).replace(/\n/g, "<br>")}</blockquote>` : "";
        const stage = meta.applicationStage ?? "RECEIVED";
        subject = {
          RECEIVED: `We've received your application — ${meta.organizationName ?? "Morbin"}`,
          INFO_REQUESTED: `A question about your Morbin application`,
          APPROVED: `You're on Morbin — ${meta.organizationName ?? ""}`,
          REJECTED: `Your Morbin application`,
        }[stage];
        const body = {
          RECEIVED: `<p>Thanks for applying to sell tickets for <strong>${org}</strong> on Morbin. We review every application by hand and usually reply within two working days.</p>`,
          INFO_REQUESTED: `<p>We're reviewing the application for <strong>${org}</strong> and need a little more information:</p>${note}<p>Just reply to this email.</p>`,
          APPROVED: `<p>Good news: <strong>${org}</strong> is approved. Sign in with your existing Morbin account to create your first event.</p>${emailButton(esc(meta.link ?? appUrl("/auth")), "Sign in")}`,
          REJECTED: `<p>Thank you for your interest in Morbin. We're not able to approve <strong>${org}</strong> at the moment.</p>${note}<p>You're welcome to reply to this email if you have questions.</p>`,
        }[stage];
        html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
          <p>Hi ${attendeeName},</p>${body}</div>`;
      } else if (job.kind === "ACCOUNT_SETUP") {
        const organizationName = esc(meta.organizationName ?? "your organisation");
        subject = `Set up your Morbin account for ${meta.organizationName ?? "your organisation"}`;
        html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
          <h2 style="margin:0 0 16px">Welcome to Morbin</h2>
          <p>Hi ${attendeeName},</p>
          <p>${esc(meta.inviterName ?? "Morbin")} has set up <strong>${organizationName}</strong> on Morbin with you as its owner.
             Choose a password to sign in and start creating events. This link works once and expires in 7 days.</p>
          ${emailButton(esc(meta.link ?? appUrl("/auth")), "Choose a password")}
          <p style="color:#777;font-size:12px;word-break:break-all">If the button does not work, paste this into your browser:<br>${esc(meta.link ?? "")}</p>
        </div>`;
      } else if (job.kind === "TEAM_INVITE" || job.kind === "TEAM_ADDED") {
        const organizationName = meta.organizationName ?? "an organisation";
        subject =
          job.kind === "TEAM_INVITE"
            ? `You're invited to join ${organizationName} on Morbin`
            : `You've been added to ${organizationName} on Morbin`;
        html = teamHtml({
          kind: job.kind,
          name: attendeeName,
          organizationName: esc(organizationName),
          inviterName: esc(meta.inviterName ?? "The owner"),
          link: esc(meta.link ?? appUrl("/dashboard")),
        });
      } else if (job.kind === "EVENT_UPDATE" && meta.ticketCode?.startsWith("cancelled:")) {
        subject = `Cancelled: ${meta.eventTitle ?? "your event"}`;
        html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#111">
          <h2 style="margin:0 0 16px">${eventTitle} has been cancelled</h2>
          <p>Hi ${attendeeName},</p>
          <p>The organiser has cancelled this event. Your tickets are being refunded to your original
             payment method — we'll email you again when the refund is on its way.</p>
          <p style="color:#555">Convenience fees are non-refundable.</p>
        </div>`;
      } else {
        subject = `Update about ${meta.eventTitle ?? "your event"}`;
        html = `<p>There is an update about ${eventTitle}. Please check your tickets page.</p>`;
      }
      const r = await sendEmail({
        to: job.recipient,
        subject,
        html,
        attachments,
        replyTo: job.kind === "APPLICATION" ? (process.env.SUPPORT_EMAIL ?? null) : null,
      });
      if (!r.ok) throw new Error("send failed");
      await db.collection("emailDeliveries").updateOne(
        { _id: job._id },
        {
          $set: {
            status: "SENT",
            sentAt: new Date(),
            providerMessageId: r.dev ? "dev-skip" : (r.id ?? null),
            "meta.qrSvg": null,
            // A join link is a credential; once delivered it has no reason to stay here.
            "meta.link": null,
          },
          $inc: { attempts: 1 },
        },
      );
      sent++;
    } catch (error) {
      const attempts = (job.attempts ?? 0) + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db.collection("emailDeliveries").updateOne(
        { _id: job._id },
        {
          $set: {
            status: giveUp ? "FAILED" : "QUEUED",
            lastError: error instanceof Error ? error.message : "unknown",
            nextAttemptAt: giveUp ? null : new Date(Date.now() + 2 ** (attempts - 1) * 60_000),
          },
          $inc: { attempts: 1 },
        },
      );
      failed++;
    }
  }
  return { sent, failed };
}
