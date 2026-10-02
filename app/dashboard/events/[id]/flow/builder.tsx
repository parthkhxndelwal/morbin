"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  InfoIcon,
  ListChecksIcon,
  PlusIcon,
  RocketIcon,
  SaveIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UserCheckIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/format";
import type { FlowOption, FlowStep } from "@/lib/types";

/**
 * The flow builder.
 *
 * Edits the flow document and nothing else. The rules live in `lib/flows.ts` and
 * are applied server-side; this component's only job is to make the resulting
 * document easy to assemble and to show what it will mean for a buyer.
 *
 * The preview is intentionally a *narrative* rather than a second render of the
 * drawer. Re-implementing the drawer's decision logic here would be a second
 * source of truth, and the two would disagree within a release.
 */

type TicketLite = {
  id: string;
  name: string;
  pricePaise: number;
  capacity: number;
  soldCount: number;
};

/** Organiser-facing names for the step kinds, same words as the add buttons. */
const KIND_LABEL: Record<FlowStep["kind"], string> = {
  SINGLE_CHOICE: "Question",
  IDENTITY: "Confirm identity",
  QUANTITY: "Quantity",
  INFO: "Note",
};

/** A fresh option for a branching step: empty label, unique id and value. */
function blankOption(stepId: string): FlowOption {
  return {
    id: `${stepId}_${Math.random().toString(36).slice(2, 7)}`,
    label: "",
    value: `OPT_${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  };
}

const BLANK_STEP = (id: string): FlowStep => ({
  id,
  kind: "SINGLE_CHOICE",
  title: "",
  required: true,
  options: [
    { id: `${id}_a`, label: "", value: "A" },
    { id: `${id}_b`, label: "", value: "B" },
  ],
});

export function FlowBuilder({
  eventId,
  ticketTypes,
  customFields,
  published,
  draft,
  eventStatus,
  maxPerType,
}: {
  eventId: string;
  ticketTypes: TicketLite[];
  customFields: { id: string; label: string; required: boolean }[];
  /** The live flow, as plain data. */
  published: { version: number; steps: FlowStep[] };
  /** The saved working copy, if any. */
  draft: { steps: FlowStep[] } | null;
  eventStatus: string;
  maxPerType: number;
}) {
  const router = useRouter();
  // What the server holds for this editor: the saved draft, else the live flow.
  // Moved forward on every successful save/publish, so the badges never go stale.
  const [saved, setSaved] = useState<FlowStep[]>(
    draft?.steps?.length ? draft.steps : published.steps,
  );
  const [steps, setSteps] = useState<FlowStep[]>(saved);
  const [busy, setBusy] = useState<"" | "save" | "publish">("");
  const [error, setError] = useState("");
  const [inspect, setInspect] = useState<string | null>(null);

  const unsaved = JSON.stringify(steps) !== JSON.stringify(saved);
  const unpublished = !unsaved && JSON.stringify(saved) !== JSON.stringify(published.steps);

  function update(id: string, patch: Partial<FlowStep>) {
    setSteps((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  function addStep(kind: FlowStep["kind"]) {
    const id = `s${Date.now().toString(36)}`;
    setSteps((s) =>
      kind === "SINGLE_CHOICE"
        ? [...s, BLANK_STEP(id)]
        : [
            ...s,
            {
              id,
              kind,
              title:
                kind === "IDENTITY"
                  ? "Confirm it's you"
                  : kind === "QUANTITY"
                    ? "How many tickets?"
                    : "Information",
              required: true,
            },
          ],
    );
    setInspect(id);
  }

  function remove(id: string) {
    // Any option pointing at the removed step has to forget its jump, or the
    // server will reject the flow as structurally impossible.
    setSteps((s) =>
      s
        .filter((x) => x.id !== id)
        .map((x) => ({
          ...x,
          options: x.options?.map((o) => (o.nextStepId === id ? { ...o, nextStepId: null } : o)),
        })),
    );
    setInspect(null);
  }

  function move(id: string, dir: -1 | 1) {
    setSteps((s) => {
      const i = s.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const copy = [...s];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  /** Appends a blank option to a branching step, so the value stays unique. */
  function appendOption(step: FlowStep) {
    update(step.id, { options: [...(step.options ?? []), blankOption(step.id)] });
  }

  function updateOption(stepId: string, optionId: string, patch: Partial<FlowOption>) {
    setSteps((s) =>
      s.map((x) =>
        x.id === stepId
          ? { ...x, options: x.options?.map((o) => (o.id === optionId ? { ...o, ...patch } : o)) }
          : x,
      ),
    );
  }

  async function save(publish: boolean) {
    setBusy(publish ? "publish" : "save");
    setError("");
    const res = await fetch(`/api/events/${eventId}/flow`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps, publish }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      const message = body.error ?? "Could not save the flow.";
      setError(message);
      toast.error(message);
      return;
    }
    setSaved(steps);
    // The live version and step count above come from the server.
    if (publish) router.refresh();
    toast.success(
      publish
        ? "Published. Anyone mid-checkout on the old rules is asked to reopen it."
        : "Draft saved. Nothing changed for buyers yet.",
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        {/* Live version, so it is always obvious what buyers are sold against. */}
        <Card size="sm" className="bg-muted/40">
          <CardContent className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <Badge variant="secondary">Live: v{published.version}</Badge>
            {published.steps.length} step{published.steps.length === 1 ? "" : "s"} ·{" "}
            {eventStatus === "PUBLISHED" ? "event is published" : "event is not published yet"}
          </CardContent>
        </Card>

        {steps.map((step, i) => (
          <Card key={step.id}>
            <CardHeader>
              <CardTitle>
                {i + 1}. {KIND_LABEL[step.kind]}
              </CardTitle>
              {step.kind === "IDENTITY" && (
                <CardDescription>
                  Leave this as it is. <strong>What gets asked depends on the answer above</strong>{" "}
                  — Google for one audience, an email link for another.
                </CardDescription>
              )}
              <CardAction>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => move(step.id, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => move(step.id, 1)}
                  disabled={i === steps.length - 1}
                  aria-label="Move down"
                >
                  <ArrowDownIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove(step.id)}
                >
                  <Trash2Icon data-icon="inline-start" />
                  Remove
                </Button>
              </CardAction>
            </CardHeader>

            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`flow-step-${step.id}-title`} className="text-xs">
                    Prompt
                  </FieldLabel>
                  <Input
                    id={`flow-step-${step.id}-title`}
                    value={step.title}
                    onChange={(e) => update(step.id, { title: e.target.value })}
                    placeholder="What the buyer is asked"
                  />
                </Field>

                {step.kind === "SINGLE_CHOICE" && step.options && (
                  <div className="space-y-3">
                    {step.options.map((o) => (
                      <OptionEditor
                        key={o.id}
                        option={o}
                        steps={steps}
                        stepId={step.id}
                        ticketTypes={ticketTypes}
                        customFields={customFields}
                        maxPerType={maxPerType}
                        onChange={(patch) => updateOption(step.id, o.id, patch)}
                        onRemove={() =>
                          update(step.id, {
                            options: (step.options ?? []).filter((x) => x.id !== o.id),
                          })
                        }
                        canRemove={(step.options ?? []).length > 1}
                        open={inspect === `${step.id}:${o.id}`}
                        onToggle={() =>
                          setInspect((v) =>
                            v === `${step.id}:${o.id}` ? null : `${step.id}:${o.id}`,
                          )
                        }
                      />
                    ))}
                    {(step.options ?? []).length < 20 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        onClick={() => appendOption(step)}
                      >
                        <PlusIcon data-icon="inline-start" />
                        Add option
                      </Button>
                    )}
                  </div>
                )}

                {step.kind === "INFO" && (
                  <Field>
                    <FieldLabel htmlFor={`flow-step-${step.id}-note`} className="text-xs">
                      Shown to the buyer
                    </FieldLabel>
                    <Textarea
                      id={`flow-step-${step.id}-note`}
                      rows={2}
                      value={step.description ?? ""}
                      onChange={(e) => update(step.id, { description: e.target.value })}
                      placeholder="Shown to the buyer, never used for a decision"
                    />
                    <FieldDescription>
                      Static copy — it never gates anything, it just tells the buyer what is coming.
                    </FieldDescription>
                  </Field>
                )}
              </FieldGroup>
            </CardContent>
          </Card>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => addStep("SINGLE_CHOICE")}>
            <PlusIcon data-icon="inline-start" />
            Question
          </Button>
          <Button variant="outline" size="sm" onClick={() => addStep("IDENTITY")}>
            <UserCheckIcon data-icon="inline-start" />
            Confirm identity
          </Button>
          <Button variant="outline" size="sm" onClick={() => addStep("QUANTITY")}>
            <ListChecksIcon data-icon="inline-start" />
            Quantity
          </Button>
          <Button variant="outline" size="sm" onClick={() => addStep("INFO")}>
            <InfoIcon data-icon="inline-start" />
            Note
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            onClick={() => save(false)}
            disabled={busy !== "" || !steps.length}
          >
            {busy === "save" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <SaveIcon data-icon="inline-start" />
            )}
            {busy === "save" ? "Saving…" : "Save draft"}
          </Button>
          <Button onClick={() => save(true)} disabled={busy !== "" || !steps.length}>
            {busy === "publish" ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RocketIcon data-icon="inline-start" />
            )}
            {busy === "publish" ? "Publishing…" : "Publish flow"}
          </Button>
          {unsaved && <Badge variant="outline">Unsaved changes</Badge>}
          {unpublished && <Badge variant="outline">Draft not published</Badge>}
        </div>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>What the buyer sees</CardTitle>
            <CardDescription>
              A read-through of the funnel, in order. The buyer&apos;s own drawer is the real check.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JourneyPreview steps={steps} />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function OptionEditor({
  option,
  steps,
  stepId,
  ticketTypes,
  customFields,
  maxPerType,
  onChange,
  onRemove,
  canRemove,
  open,
  onToggle,
}: {
  option: FlowOption;
  steps: FlowStep[];
  stepId: string;
  ticketTypes: TicketLite[];
  customFields: { id: string; label: string; required: boolean }[];
  maxPerType: number;
  onChange: (patch: Partial<FlowOption>) => void;
  onRemove: () => void;
  canRemove: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const method = option.identity?.method ?? "NONE";
  const canSetQuantity = option.quantityEditable !== false;
  const fieldId = (part: string) => `flow-option-${stepId}-${option.id}-${part}`;

  return (
    <Card size="sm" className="bg-muted/30">
      <CardHeader>
        <Input
          id={fieldId("label")}
          value={option.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Option the buyer picks"
          aria-label="Option the buyer picks"
        />
        <CardAction>
          <Button variant="outline" size="sm" onClick={onToggle} aria-expanded={open}>
            <SlidersHorizontalIcon data-icon="inline-start" />
            {open ? "Less" : "Rules"}
          </Button>
          {canRemove && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Remove option ${option.label || ""}`}
            >
              <Trash2Icon />
            </Button>
          )}
        </CardAction>
      </CardHeader>

      {open && (
        <CardContent>
          <FieldGroup className="text-sm">
            <Field>
              <FieldLabel htmlFor={fieldId("identity")}>Confirm who they are</FieldLabel>
              <NativeSelect
                id={fieldId("identity")}
                value={method}
                onChange={(e) => {
                  const m = e.target.value as NonNullable<FlowOption["identity"]>["method"];
                  onChange({
                    identity:
                      m === "NONE"
                        ? { method: "NONE" }
                        : {
                            method: m,
                            emailDomain:
                              m === "EMAIL_OTP" ? (option.identity?.emailDomain ?? "") : null,
                            allowedEmailDomains:
                              m === "GOOGLE"
                                ? (option.identity?.allowedEmailDomains ?? null)
                                : null,
                          },
                  });
                }}
                className="w-full"
              >
                <NativeSelectOption value="NONE">No sign-in</NativeSelectOption>
                <NativeSelectOption value="GOOGLE">Continue with Google</NativeSelectOption>
                <NativeSelectOption value="EMAIL_OTP">
                  Email them a one-time link
                </NativeSelectOption>
              </NativeSelect>
            </Field>

            {method === "EMAIL_OTP" && (
              <Field>
                <FieldLabel htmlFor={fieldId("domain")}>College email domain</FieldLabel>
                <Input
                  id={fieldId("domain")}
                  value={option.identity?.emailDomain ?? ""}
                  onChange={(e) =>
                    onChange({
                      identity: { method, emailDomain: e.target.value.trim() || null },
                    })
                  }
                  placeholder="krmu.edu.in"
                />
                <FieldDescription>
                  Checked on the server. Buyers with any other address get nothing — no error, just
                  no ticket.
                </FieldDescription>
              </Field>
            )}

            {method === "GOOGLE" && (
              <Field>
                <FieldLabel htmlFor={fieldId("domains")}>Restrict Google accounts</FieldLabel>
                <Input
                  id={fieldId("domains")}
                  value={(option.identity?.allowedEmailDomains ?? []).join(", ")}
                  onChange={(e) =>
                    onChange({
                      identity: {
                        method,
                        allowedEmailDomains: e.target.value
                          .split(",")
                          .map((s) => s.trim().replace(/^@/, ""))
                          .filter(Boolean),
                      },
                    })
                  }
                  placeholder="krmu.edu.in"
                />
                <FieldDescription>Leave empty to allow any address.</FieldDescription>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor={fieldId("next")}>Then jump to</FieldLabel>
              <NativeSelect
                id={fieldId("next")}
                value={option.nextStepId ?? ""}
                onChange={(e) => onChange({ nextStepId: e.target.value || null })}
                className="w-full"
              >
                <NativeSelectOption value="">Continue to next step</NativeSelectOption>
                {steps
                  .filter((s) => s.id !== stepId)
                  .map((s) => (
                    <NativeSelectOption key={s.id} value={s.id}>
                      {s.title || "(untitled step)"}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
              <FieldDescription>Leave as continue to move to the next step.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Can buy</FieldLabel>
              <FieldDescription>Leave all unticked to allow every ticket type.</FieldDescription>
              <FieldGroup className="gap-2">
                {ticketTypes.map((t) => {
                  const list = option.allowedTicketTypeIds ?? [];
                  const on = list.includes(t.id);
                  return (
                    <Field key={t.id} orientation="horizontal">
                      <Checkbox
                        id={fieldId(`ticket-${t.id}`)}
                        checked={on}
                        onCheckedChange={(checked) => {
                          const next = checked ? [...list, t.id] : list.filter((x) => x !== t.id);
                          onChange({
                            allowedTicketTypeIds: next.length ? next : null,
                          });
                        }}
                      />
                      <FieldLabel
                        htmlFor={fieldId(`ticket-${t.id}`)}
                        className="flex-1 cursor-pointer font-normal"
                      >
                        {t.name} · {formatINR(t.pricePaise)} · {t.capacity - t.soldCount} left
                      </FieldLabel>
                    </Field>
                  );
                })}
                {ticketTypes.length === 0 && (
                  <p className="text-sm text-muted-foreground">Add a ticket type first.</p>
                )}
              </FieldGroup>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={fieldId("max")}>Max per order (max {maxPerType})</FieldLabel>
                <Input
                  id={fieldId("max")}
                  type="number"
                  min={1}
                  max={maxPerType}
                  value={option.maxPerOrder ?? ""}
                  onChange={(e) =>
                    onChange({
                      maxPerOrder: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  placeholder="any"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={fieldId("seats")}>Seats for this audience</FieldLabel>
                <Input
                  id={fieldId("seats")}
                  type="number"
                  min={0}
                  value={option.capacity ?? ""}
                  onChange={(e) =>
                    onChange({ capacity: e.target.value ? Number(e.target.value) : null })
                  }
                  placeholder="unlimited"
                />
              </Field>
            </div>

            <Field orientation="horizontal">
              <FieldLabel
                htmlFor={fieldId("quantity")}
                className="flex-1 cursor-pointer font-normal"
              >
                <Switch
                  id={fieldId("quantity")}
                  checked={canSetQuantity}
                  onCheckedChange={(v) => onChange({ quantityEditable: !!v })}
                />
                Let them pick a quantity
              </FieldLabel>
            </Field>
            {!canSetQuantity && (
              <FieldDescription>
                The quantity step disappears entirely for this audience. Their ticket is issued to
                the address they confirmed.
              </FieldDescription>
            )}

            {customFields.length > 0 && (
              <Field>
                <FieldLabel>Ask for these details</FieldLabel>
                <FieldDescription>Leave all unticked to ask for everything.</FieldDescription>
                <FieldGroup className="gap-2">
                  {customFields.map((f) => {
                    const list = option.showFieldIds ?? [];
                    const on = list.includes(f.id);
                    return (
                      <Field key={f.id} orientation="horizontal">
                        <Checkbox
                          id={fieldId(`field-${f.id}`)}
                          checked={on}
                          onCheckedChange={(checked) => {
                            const next = checked ? [...list, f.id] : list.filter((x) => x !== f.id);
                            onChange({ showFieldIds: next.length ? next : null });
                          }}
                        />
                        <FieldLabel
                          htmlFor={fieldId(`field-${f.id}`)}
                          className="flex-1 cursor-pointer font-normal"
                        >
                          {f.label}
                          {f.required ? " *" : ""}
                        </FieldLabel>
                      </Field>
                    );
                  })}
                </FieldGroup>
              </Field>
            )}
          </FieldGroup>
        </CardContent>
      )}
    </Card>
  );
}

/**
 * A readable trace of the funnel.
 *
 * Deliberately narrative rather than a live render: the authoritative check is
 * the buyer's own drawer, and duplicating its decision logic here would create
 * the second source of truth this design exists to avoid.
 */
function JourneyPreview({ steps }: { steps: FlowStep[] }) {
  if (steps.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No steps yet. Buyers will go straight to choosing tickets.
      </p>
    );
  }
  return (
    <ol className="space-y-2 text-sm">
      {steps.map((s, i) => (
        <li key={s.id}>
          <Card size="sm" className="bg-muted/30">
            <CardHeader>
              <CardTitle className="text-sm">
                {i + 1}. {s.title || "(untitled)"}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {s.kind === "SINGLE_CHOICE" && s.options && (
                <ul className="space-y-1.5">
                  {s.options.map((o) => (
                    <li key={o.id}>
                      <span className="text-foreground">{o.label || "(untitled)"}</span>
                      {" → "}
                      {o.identity?.method === "GOOGLE" ? (
                        <em className="not-italic text-primary">Google popup</em>
                      ) : o.identity?.method === "EMAIL_OTP" ? (
                        <em className="not-italic text-primary">
                          email link{o.identity.emailDomain ? ` (@${o.identity.emailDomain})` : ""}
                        </em>
                      ) : o.nextStepId ? (
                        <em className="not-italic">
                          → {steps.find((x) => x.id === o.nextStepId)?.title || "another step"}
                        </em>
                      ) : (
                        <em className="not-italic">next step</em>
                      )}
                      {o.quantityEditable === false && (
                        <Badge variant="outline" className="ml-1 align-middle text-xs font-normal">
                          1 ticket only
                        </Badge>
                      )}
                      {typeof o.maxPerOrder === "number" && (
                        <Badge variant="outline" className="ml-1 align-middle text-xs font-normal">
                          max {o.maxPerOrder}
                        </Badge>
                      )}
                      {Array.isArray(o.allowedTicketTypeIds) &&
                        o.allowedTicketTypeIds.length > 0 && (
                          <Badge
                            variant="outline"
                            className="ml-1 align-middle text-xs font-normal"
                          >
                            restricted types
                          </Badge>
                        )}
                    </li>
                  ))}
                </ul>
              )}
              {s.kind === "IDENTITY" && <p>Buyer confirms their identity.</p>}
              {s.kind === "QUANTITY" && <p>Buyer chooses how many.</p>}
              {s.kind === "INFO" && s.description && <p>{s.description}</p>}
            </CardContent>
          </Card>
        </li>
      ))}
      <li>
        <Card size="sm" className="bg-muted/30">
          <CardHeader>
            <CardTitle className="text-sm">Pay with Razorpay → ticket by email</CardTitle>
          </CardHeader>
        </Card>
      </li>
    </ol>
  );
}
