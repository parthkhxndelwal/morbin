import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getEventById } from "@/lib/events";
import { getActiveFlow, getFlowDraft, publishFlow, saveFlowDraft } from "@/lib/flows";
import { getOrgForUser } from "@/lib/organizations";
import { can } from "@/lib/permissions";
import type { FlowStep } from "@/lib/types";

/**
 * Read and edit an event's booking flow.
 *
 * Owner-only, matching every other organizer write in this app. Publishing bumps
 * the version rather than mutating the live document, so a buyer mid-checkout is
 * never moved to new rules underneath.
 */

const identitySchema = z.object({
  method: z.enum(["NONE", "GOOGLE", "EMAIL_OTP"]),
  emailDomain: z.string().max(120).nullish(),
  allowedEmailDomains: z.array(z.string().max(120)).max(20).nullish(),
});

const optionSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(60),
  nextStepId: z.string().max(60).nullish(),
  identity: identitySchema.nullish(),
  allowedTicketTypeIds: z.array(z.string().max(60)).max(50).nullish(),
  maxPerOrder: z.number().int().min(1).max(50).nullish(),
  quantityEditable: z.boolean().nullish(),
  capacity: z.number().int().min(0).max(100000).nullish(),
  showFieldIds: z.array(z.string().max(60)).max(50).nullish(),
});

const stepSchema = z.object({
  id: z.string().min(1).max(60),
  kind: z.enum(["SINGLE_CHOICE", "IDENTITY", "QUANTITY", "INFO"]),
  title: z.string().min(1).max(160),
  description: z.string().max(400).nullish(),
  required: z.boolean().optional(),
  options: z.array(optionSchema).max(20).nullish(),
});

const bodySchema = z.object({
  steps: z.array(stepSchema).max(12),
  publish: z.boolean().optional(),
});

/** Reject structurally impossible flows before they reach the evaluator. */
function validate(flow: { steps: FlowStep[] }): string | null {
  const ids = new Set<string>();
  for (const s of flow.steps) {
    if (ids.has(s.id)) return `Duplicate step id "${s.id}".`;
    ids.add(s.id);
  }
  const values = new Set<string>();
  for (const s of flow.steps) {
    if (s.kind !== "SINGLE_CHOICE") continue;
    if (!s.options?.length) return `"${s.title}" needs at least one option.`;
    for (const o of s.options) {
      if (values.has(o.value)) return `The answer "${o.value}" is used twice.`;
      values.add(o.value);
      if (o.nextStepId && !flow.steps.some((t) => t.id === o.nextStepId)) {
        return `"${o.label}" jumps to a step that does not exist.`;
      }
    }
  }
  // Identity is derived from a chosen option, so a flow with an IDENTITY step but
  // no branching question above it could never know what to ask.
  if (flow.steps.some((s) => s.kind === "IDENTITY")) {
    const hasBranch = flow.steps.some(
      (s) => s.kind === "SINGLE_CHOICE" && s.options?.some((o) => o.identity?.method !== "NONE"),
    );
    if (!hasBranch) {
      return "To confirm emails, add a question with a 'Continue with Google' or 'Email link' option.";
    }
  }
  return null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const resolved = await getOrgForUser(session.user.id);
  const org = resolved?.org;
  const event = await getEventById(id);
  if (!org?._id || !event || event.organizationId !== org._id.toString()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [published, draft] = await Promise.all([getActiveFlow(event._id!.toString()), getFlowDraft(event._id!.toString())]);
  return NextResponse.json({ published, draft });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const resolved = await getOrgForUser(session.user.id);
  const org = resolved?.org;
  if (!org?._id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!can(resolved?.role, "manageEvents")) {
    return NextResponse.json({ error: "Only the owner can change the booking flow" }, { status: 403 });
  }
  const event = await getEventById(id);
  if (!event || event.organizationId !== org._id.toString()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid flow" }, { status: 400 });
  }
  const problem = validate(parsed.data);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const eventId = event._id!.toString();
  const flow = parsed.data.publish
    ? await publishFlow(eventId, parsed.data.steps)
    : await saveFlowDraft(eventId, parsed.data.steps);
  return NextResponse.json({ flow, published: !!parsed.data.publish });
}
