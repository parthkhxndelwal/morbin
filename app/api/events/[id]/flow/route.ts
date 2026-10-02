import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveFlow, getFlowDraft, publishFlow, saveFlowDraft } from "@/lib/flows";
import { eventApiAccess } from "@/lib/event-access";
import { lookupProblems } from "@/lib/lookups";
import { can } from "@/lib/permissions";
import { recordSupportChange, supportNeedsApproval } from "@/lib/support";
import type { FlowStep } from "@/lib/types";

/**
 * Read and edit an event's booking flow.
 *
 * The event's owner, or Morbin support (logged, and the owner notified; with the
 * owner's approval switch on, a support "publish" is saved as a draft for the
 * owner to publish). Publishing bumps
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

const lookupSchema = z.object({
  datasetId: z.string().min(1).max(60),
  matchColumn: z.string().min(1).max(60),
  inputHint: z.string().max(80).nullish(),
  emailTemplate: z.string().max(200).nullish(),
  identityMethod: z.enum(["EMAIL_OTP"]).nullish(),
  oneTicketPerRow: z.boolean(),
});

const stepSchema = z.object({
  id: z.string().min(1).max(60),
  kind: z.enum(["SINGLE_CHOICE", "IDENTITY", "QUANTITY", "INFO", "LOOKUP"]),
  title: z.string().min(1).max(160),
  description: z.string().max(400).nullish(),
  required: z.boolean().optional(),
  options: z.array(optionSchema).max(20).nullish(),
  lookup: lookupSchema.nullish(),
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
  for (const s of flow.steps) {
    if (s.kind === "LOOKUP" && !s.lookup) return `"${s.title}" needs a dataset to check against.`;
  }
  if (flow.steps.filter((s) => s.kind === "LOOKUP" && s.lookup?.identityMethod === "EMAIL_OTP").length > 1) {
    return "Only one ID question can decide which email is confirmed.";
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
  const { id } = await params;
  const r = await eventApiAccess(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!can(r.access.role, "manageEvents")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const eventId = r.access.event._id.toString();
  const [published, draft] = await Promise.all([getActiveFlow(eventId), getFlowDraft(eventId)]);
  return NextResponse.json({ published, draft });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await eventApiAccess(id);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { access } = r;
  if (!can(access.role, "manageEvents")) {
    return NextResponse.json({ error: "Only the owner can change who can book" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid flow" }, { status: 400 });
  }
  const problem =
    validate(parsed.data) ?? (await lookupProblems(access.org._id.toString(), parsed.data.steps as FlowStep[]));
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const eventId = access.event._id.toString();
  // With the owner's approval switch on, support prepares and the owner publishes.
  const proposed = access.support && !!parsed.data.publish && supportNeedsApproval(access.org);
  const publish = !!parsed.data.publish && !proposed;
  const flow = publish
    ? await publishFlow(eventId, parsed.data.steps)
    : await saveFlowDraft(eventId, parsed.data.steps);

  if (access.support) {
    await recordSupportChange({
      adminId: access.userId,
      organizationId: access.org._id.toString(),
      eventId,
      action: publish ? "event.flow.published" : "event.flow.draft_saved",
      summary: proposed
        ? `Booking rules for "${access.event.title}" were prepared for you. Review and publish them under Booking rules.`
        : publish
          ? `Booking rules for "${access.event.title}" were changed and published.`
          : `A draft of the booking rules for "${access.event.title}" was saved.`,
    });
  }
  return NextResponse.json({ flow, published: publish, proposed });
}
