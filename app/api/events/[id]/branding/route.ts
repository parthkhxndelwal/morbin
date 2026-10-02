import { NextResponse } from "next/server";
import { z } from "zod";
import { getBranding, saveBranding } from "@/lib/branding";
import {
  ALLOWED,
  MAX_BYTES,
  extensionFor,
  isAllowedImageType,
  mediaBucket,
  mediaUrl,
} from "@/lib/media";
import { eventApiAccess } from "@/lib/event-access";
import { recordSupportChange } from "@/lib/support";
import { can } from "@/lib/permissions";
import type { CustomFieldType } from "@/lib/types";

/**
 * Organizer-controlled appearance for one event.
 *
 * `POST` accepts an upload and returns a key; `PUT` saves the non-file settings.
 * Split because a multipart upload and a JSON patch are different failure modes,
 * and a failed save should not require re-uploading a poster.
 */

const fieldSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  type: z.enum(["TEXT", "TEL", "EMAIL", "TEXTAREA", "SELECT", "MULTI_SELECT"]),
  required: z.boolean(),
  options: z.array(z.string().max(120)).max(40).nullish(),
  placeholder: z.string().max(120).nullish(),
  maxLength: z.number().int().min(1).max(2000).nullish(),
  // PER_TICKET is not yet collectable by the public flow, so it is not accepted
  // here either — a setting the buyer cannot honour is worse than no setting.
  collectOn: z.literal("CHECKOUT_FORM").default("CHECKOUT_FORM"),
});

const bodySchema = z.object({
  bannerKey: z.string().max(200).nullish(),
  socialImageKey: z.string().max(200).nullish(),
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #7c3aed")
    .default("#7c3aed"),
  ctaLabel: z.string().min(1).max(40).default("Book Tickets Now"),
  showDescription: z.boolean().default(true),
  showVenue: z.boolean().default(true),
  showDate: z.boolean().default(true),
  showTicketPreview: z.boolean().default(true),
  theme: z.enum(["dark", "light"]).default("dark"),
  customFields: z.array(fieldSchema).max(20).default([]),
});

async function guard(eventId: string) {
  const r = await eventApiAccess(eventId);
  if ("error" in r) return r;
  if (!can(r.access.role, "manageEvents")) {
    return { error: "Only the organization owner can change this", status: 403 } as const;
  }
  return { org: r.access.org, event: r.access.event, access: r.access } as const;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });

  const bucket = mediaBucket();

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const kind = form?.get("kind");
  if (!(file instanceof File) || (kind !== "banner" && kind !== "social")) {
    return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Images must be under 5 MB" }, { status: 413 });
  }
  if (!isAllowedImageType(file.type)) {
    return NextResponse.json(
      { error: `Use one of: ${Object.keys(ALLOWED).join(", ")}` },
      { status: 415 },
    );
  }

  const buffer = await file.arrayBuffer();
  // The declared content type is the organizer's word. The magic bytes are the
  // server's, and they are what gets stored — otherwise a script or an HTML file
  // could be served from our media domain.
  const sniffed = sniffImage(buffer);
  if (!sniffed) {
    return NextResponse.json({ error: "That file is not a real image" }, { status: 415 });
  }

  const key = `events/${g.event._id!.toString()}/${kind}-${crypto.randomUUID()}.${extensionFor(sniffed)}`;
  await bucket.put(key, buffer);

  // Replace the stored key, then remove the superseded file so re-uploads do
  // not accumulate orphaned images on disk.
  const field = kind === "banner" ? "bannerKey" : "socialImageKey";
  const previous = (await getBranding(id))[field];
  await saveBranding(id, { [field]: key } as never);
  if (previous && previous !== key) await bucket.delete(previous);

  return NextResponse.json({ key, url: mediaUrl(key) }, { status: 201 });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first ? `${first.path.join(".") || "field"}: ${first.message}` : "Invalid settings" },
      { status: 400 },
    );
  }

  for (const f of parsed.data.customFields) {
    if ((f.type === "SELECT" || f.type === "MULTI_SELECT") && !f.options?.length) {
      return NextResponse.json({ error: `"${f.label}" needs at least one option` }, { status: 400 });
    }
  }

  const saved = await saveBranding(id, {
    ...parsed.data,
    customFields: parsed.data.customFields.map((f) => ({
      ...f,
      type: f.type as CustomFieldType,
    })),
  });
  if (g.access.support) {
    await recordSupportChange({
      adminId: g.access.userId,
      organizationId: g.access.org._id.toString(),
      eventId: id,
      action: "event.appearance.updated",
      summary: `The look of "${g.event.title}" and its checkout questions were updated.`,
    });
  }
  return NextResponse.json({
    ok: true,
    branding: {
      bannerKey: saved.bannerKey,
      accentColor: saved.accentColor,
      ctaLabel: saved.ctaLabel,
    },
  });
}

/**
 * Identify an image from its leading bytes.
 *
 * A browser-reported `type` is attacker-controlled, and a media domain we control
 * serving an HTML or SVG payload is a stored-XSS primitive. Checking magic bytes
 * closes it, and the sniffed type — not the declared one — is what gets stored.
 */
function sniffImage(buf: ArrayBuffer): string | null {
  const b = new Uint8Array(buf);
  if (b.length < 12) return null;
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  // JPEG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  // GIF
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  // WEBP: "RIFF" .... "WEBP"
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  // AVIF/HEIF: ftyp box at offset 4
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "image/avif";
  return null;
}
