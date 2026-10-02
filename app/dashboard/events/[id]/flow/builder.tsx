"use client";

import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  MailCheckIcon,
  PlusIcon,
  SettingsIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { resolveOffer } from "@/lib/flow-rules";
import { formatINR } from "@/lib/format";
import type { CheckoutFlow, FlowOption, FlowStep, TicketType } from "@/lib/types";

/**
 * Booking rules for one event.
 *
 * The model the organiser sees is deliberately small:
 *
 *   - With no questions, everyone books the same way.
 *   - A question splits buyers into groups; each *answer* is a group with its
 *     own rules (prove who they are, which tickets, how many, seat limit,
 *     which extra details to ask).
 *
 * That is all the checkout actually acts on. Older step kinds (identity,
 * quantity, notes) were placeholders the checkout never rendered, so the editor
 * keeps only questions and drops the rest on save. The preview runs the same
 * `resolveOffer` the checkout uses, so it cannot disagree with it.
 */

export type BuilderTicket = {
  id: string;
  name: string;
  pricePaise: number;
  capacity: number;
  soldCount: number;
  status: string | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  defaultMaxPerOrder: number | null;
  audienceOptionIds: string[] | null;
};

type CheckoutField = { id: string; label: string; required: boolean };

const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Only questions mean anything to the checkout; everything else is dropped. */
function questionsOf(steps: FlowStep[]): FlowStep[] {
  return steps.filter((s) => s.kind === "SINGLE_CHOICE");
}

function newAnswer(label = ""): FlowOption {
  return { id: uid("a_"), label, value: uid("A_").toUpperCase() };
}

function newQuestion(title = ""): FlowStep {
  return { id: uid("q_"), kind: "SINGLE_CHOICE", title, required: true, options: [newAnswer(), newAnswer()] };
}

/** A ready-made split most events with students need. */
function studentsAndGuests(): FlowStep {
  const q = newQuestion("Who's booking?");
  q.description = "Students confirm their college email; everyone else books as a guest.";
  q.options = [
    {
      ...newAnswer("I'm a student"),
      identity: { method: "EMAIL_OTP", emailDomain: "", allowedEmailDomains: null },
      quantityEditable: false,
      maxPerOrder: 1,
    },
    newAnswer("I'm a guest"),
  ];
  return q;
}

/* ── Plain-language summaries ───────────────────────────────────────────── */

function identityText(o: FlowOption): string {
  const m = o.identity?.method ?? "NONE";
  if (m === "EMAIL_OTP") {
    return o.identity?.emailDomain ? `Confirms an @${o.identity.emailDomain} email` : "Confirms their email";
  }
  if (m === "GOOGLE") {
    const d = o.identity?.allowedEmailDomains ?? [];
    return d.length ? `Signs in with Google (@${d.join(", @")})` : "Signs in with Google";
  }
  return "No sign-in";
}

function answerChips(o: FlowOption, tickets: BuilderTicket[], fields: CheckoutField[]): string[] {
  const chips = [identityText(o)];
  if (o.allowedTicketTypeIds?.length) {
    const names = tickets.filter((t) => o.allowedTicketTypeIds!.includes(t.id)).map((t) => t.name);
    chips.push(names.length ? `Only ${names.join(", ")}` : "No tickets selected");
  }
  if (o.quantityEditable === false) chips.push("1 ticket each");
  else if (typeof o.maxPerOrder === "number") chips.push(`Up to ${o.maxPerOrder} each`);
  if (typeof o.capacity === "number") chips.push(`${o.capacity} seats for this group`);
  if (o.showFieldIds && fields.length) chips.push(`Asks ${o.showFieldIds.length} of ${fields.length} details`);
  return chips;
}

/* ── Problems that would confuse buyers or be refused on save ───────────── */

type Problem = { blocking: boolean; text: string };

function findProblems(questions: FlowStep[]): Problem[] {
  const out: Problem[] = [];
  questions.forEach((q, qi) => {
    const name = `Question ${qi + 1}`;
    if (!q.title.trim()) out.push({ blocking: true, text: `${name} has no wording.` });
    const answers = q.options ?? [];
    if (answers.length < 2) out.push({ blocking: true, text: `${name} needs at least two answers to choose from.` });
    answers.forEach((a, ai) => {
      if (!a.label.trim()) out.push({ blocking: true, text: `${name}: answer ${ai + 1} is empty.` });
      if (a.identity?.method === "EMAIL_OTP" && !a.identity.emailDomain) {
        out.push({
          blocking: false,
          text: `${name}: “${a.label || `answer ${ai + 1}`}” confirms an email but doesn't limit the domain, so any address works.`,
        });
      }
      if (a.allowedTicketTypeIds && a.allowedTicketTypeIds.length === 0) {
        out.push({ blocking: true, text: `${name}: “${a.label || `answer ${ai + 1}`}” can't buy any ticket.` });
      }
    });
    const labels = answers.map((a) => a.label.trim().toLowerCase()).filter(Boolean);
    if (new Set(labels).size !== labels.length) out.push({ blocking: true, text: `${name} has two answers with the same wording.` });
  });
  return out;
}

/* ── Main ────────────────────────────────────────────────────────────────── */

export function FlowBuilder({
  eventId,
  ticketTypes,
  customFields,
  published,
  draft,
  eventStatus,
  maxPerType,
  proposeOnly = false,
}: {
  /** Support with the owner's approval switch on: "Publish" becomes "Send to owner". */
  proposeOnly?: boolean;
  eventId: string;
  ticketTypes: BuilderTicket[];
  customFields: CheckoutField[];
  published: { version: number; steps: FlowStep[] };
  draft: { steps: FlowStep[] } | null;
  eventStatus: string;
  maxPerType: number;
}) {
  const router = useRouter();
  const live = useMemo(() => questionsOf(published.steps), [published.steps]);
  const [saved, setSaved] = useState<FlowStep[]>(() => questionsOf(draft?.steps ?? published.steps));
  const [questions, setQuestions] = useState<FlowStep[]>(saved);
  const [editing, setEditing] = useState<{ q: string; a: string } | null>(null);
  const [busy, setBusy] = useState<"" | "save" | "publish">("");

  const same = (a: FlowStep[], b: FlowStep[]) => JSON.stringify(a) === JSON.stringify(b);
  const unsaved = !same(questions, saved);
  const draftPending = !same(saved, live);
  const problems = findProblems(questions);
  const blocked = problems.some((p) => p.blocking);

  function patchQuestion(id: string, patch: Partial<FlowStep>) {
    setQuestions((qs) => qs.map((q) => (q.id === id ? { ...q, ...patch } : q)));
  }

  function patchAnswer(qid: string, aid: string, patch: Partial<FlowOption>) {
    setQuestions((qs) =>
      qs.map((q) =>
        q.id === qid ? { ...q, options: (q.options ?? []).map((a) => (a.id === aid ? { ...a, ...patch } : a)) } : q,
      ),
    );
  }

  function move(id: string, dir: -1 | 1) {
    setQuestions((qs) => {
      const i = qs.findIndex((q) => q.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= qs.length) return qs;
      const copy = [...qs];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  async function save(publish: boolean) {
    setBusy(publish ? "publish" : "save");
    const res = await fetch(`/api/events/${eventId}/flow`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ steps: questions, publish }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy("");
    if (!res.ok) {
      toast.error(body.error ?? "Couldn't save the booking rules.");
      return;
    }
    setSaved(questions);
    if (body.published) router.refresh();
    toast.success(
      body.proposed
        ? "Saved for the owner to review and publish."
        : body.published
          ? "Published. New buyers follow these rules now."
          : "Draft saved. Buyers still follow the published rules.",
    );
  }

  const editingQuestion = editing ? questions.find((q) => q.id === editing.q) : null;
  const editingAnswer = editingQuestion?.options?.find((a) => a.id === editing?.a) ?? null;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Who can book, and how</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            By default anyone can book any ticket. Ask a question before booking when different people need different
            rules — for example, students confirm their college email and get one free ticket, while guests pay.
          </p>
        </div>

        <StatusBar
          unsaved={unsaved}
          draftPending={draftPending}
          eventStatus={eventStatus}
          busy={busy}
          blocked={blocked}
          onSave={() => save(false)}
          onPublish={() => save(true)}
          publishLabel={proposeOnly ? "Send to owner" : "Publish"}
          onDiscard={() => setQuestions(saved)}
        />

        {questions.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Everyone books the same way</CardTitle>
              <CardDescription>
                Buyers pick tickets, pay, and get their tickets by email. No questions, no sign-in.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button onClick={() => setQuestions([newQuestion()])}>
                <PlusIcon data-icon="inline-start" />
                Ask a question first
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  const q = studentsAndGuests();
                  setQuestions([q]);
                  setEditing({ q: q.id, a: q.options![0].id });
                }}
              >
                <UsersIcon data-icon="inline-start" />
                Start from “Students and guests”
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {questions.map((q, i) => (
              <QuestionCard
                key={q.id}
                index={i}
                count={questions.length}
                question={q}
                tickets={ticketTypes}
                fields={customFields}
                onChange={(patch) => patchQuestion(q.id, patch)}
                onMove={(dir) => move(q.id, dir)}
                onRemove={() => setQuestions((qs) => qs.filter((x) => x.id !== q.id))}
                onEditAnswer={(aid) => setEditing({ q: q.id, a: aid })}
              />
            ))}
            {questions.length > 1 && (
              <p className="text-sm text-muted-foreground">
                Buyers answer every question, in this order. When their answers carry different rules, the stricter
                one wins.
              </p>
            )}
            <Button variant="outline" onClick={() => setQuestions((qs) => [...qs, newQuestion()])}>
              <PlusIcon data-icon="inline-start" />
              Add another question
            </Button>
          </>
        )}

        {problems.length > 0 && (
          <Alert variant={blocked ? "destructive" : "default"}>
            <AlertTriangleIcon />
            <AlertTitle>{blocked ? "Fix these before saving" : "Worth a look"}</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {problems.map((p) => (
                  <li key={p.text}>{p.text}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <BuyerPreview eventId={eventId} questions={questions} tickets={ticketTypes} fields={customFields} />
      </aside>

      <Sheet open={!!editingAnswer} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {editingQuestion && editingAnswer && (
            <AnswerRules
              question={editingQuestion}
              answer={editingAnswer}
              tickets={ticketTypes}
              fields={customFields}
              maxPerType={maxPerType}
              onChange={(patch) => patchAnswer(editingQuestion.id, editingAnswer.id, patch)}
              onDone={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ── Status + actions ───────────────────────────────────────────────────── */

function StatusBar({
  unsaved,
  draftPending,
  eventStatus,
  busy,
  blocked,
  onSave,
  onPublish,
  onDiscard,
  publishLabel,
}: {
  unsaved: boolean;
  draftPending: boolean;
  eventStatus: string;
  busy: "" | "save" | "publish";
  blocked: boolean;
  onSave: () => void;
  onPublish: () => void;
  onDiscard: () => void;
  publishLabel: string;
}) {
  const changed = unsaved || draftPending;
  const message = unsaved
    ? "You have changes that aren't saved yet."
    : draftPending
      ? "Draft saved. Buyers still follow the published rules until you publish."
      : "These are the rules buyers follow right now.";
  return (
    <Card size="sm" className={changed ? "border-primary/40" : undefined}>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2 text-sm">
          {changed ? (
            <CircleDotIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          ) : (
            <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div>
            <p>{message}</p>
            {eventStatus !== "PUBLISHED" && (
              <p className="text-muted-foreground">The event isn&apos;t on sale yet, so nobody books until it&apos;s published.</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {unsaved && (
            <Button variant="ghost" size="sm" onClick={onDiscard} disabled={busy !== ""}>
              Discard
            </Button>
          )}
          {unsaved && (
            <Button variant="outline" size="sm" onClick={onSave} disabled={busy !== "" || blocked}>
              {busy === "save" && <Spinner data-icon="inline-start" />}
              Save draft
            </Button>
          )}
          <Button size="sm" onClick={onPublish} disabled={busy !== "" || blocked || !changed}>
            {busy === "publish" && <Spinner data-icon="inline-start" />}
            {publishLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── One question ───────────────────────────────────────────────────────── */

function QuestionCard({
  index,
  count,
  question,
  tickets,
  fields,
  onChange,
  onMove,
  onRemove,
  onEditAnswer,
}: {
  index: number;
  count: number;
  question: FlowStep;
  tickets: BuilderTicket[];
  fields: CheckoutField[];
  onChange: (patch: Partial<FlowStep>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onEditAnswer: (answerId: string) => void;
}) {
  const answers = question.options ?? [];
  const id = (part: string) => `q-${question.id}-${part}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Question {count > 1 ? index + 1 : ""}</CardTitle>
        <CardDescription>Buyers see this first and pick one answer.</CardDescription>
        <CardAction className="flex gap-1">
          {count > 1 && (
            <>
              <Button variant="ghost" size="icon-xs" onClick={() => onMove(-1)} disabled={index === 0} aria-label="Move question up">
                <ArrowUpIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onMove(1)}
                disabled={index === count - 1}
                aria-label="Move question down"
              >
                <ArrowDownIcon />
              </Button>
            </>
          )}
          <Button variant="ghost" size="xs" className="text-muted-foreground hover:text-destructive" onClick={onRemove}>
            <Trash2Icon data-icon="inline-start" />
            Remove
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={id("title")}>What you ask</FieldLabel>
            <Input
              id={id("title")}
              value={question.title}
              onChange={(e) => onChange({ title: e.target.value })}
              placeholder="e.g. Who's booking?"
              maxLength={160}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={id("help")}>Extra explanation (optional)</FieldLabel>
            <Input
              id={id("help")}
              value={question.description ?? ""}
              onChange={(e) => onChange({ description: e.target.value || null })}
              placeholder="Shown under the question"
              maxLength={400}
            />
          </Field>
        </FieldGroup>

        <div className="space-y-2">
          <p className="text-sm font-medium">Answers, and what each one means</p>
          {answers.map((a, ai) => (
            <div key={a.id} className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1 space-y-2">
                <Input
                  value={a.label}
                  onChange={(e) =>
                    onChange({ options: answers.map((x) => (x.id === a.id ? { ...x, label: e.target.value } : x)) })
                  }
                  placeholder={`Answer ${ai + 1}, e.g. “I'm a student”`}
                  aria-label={`Answer ${ai + 1}`}
                  maxLength={120}
                />
                <div className="flex flex-wrap gap-1">
                  {answerChips(a, tickets, fields).map((c) => (
                    <Badge key={c} variant="secondary" className="font-normal">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="outline" size="sm" onClick={() => onEditAnswer(a.id)}>
                  <SettingsIcon data-icon="inline-start" />
                  Rules
                </Button>
                {answers.length > 2 && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => onChange({ options: answers.filter((x) => x.id !== a.id) })}
                    aria-label={`Remove answer ${ai + 1}`}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </div>
            </div>
          ))}
          {answers.length < 20 && (
            <Button variant="ghost" size="sm" onClick={() => onChange({ options: [...answers, newAnswer()] })}>
              <PlusIcon data-icon="inline-start" />
              Add an answer
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Rules for one answer (side panel) ──────────────────────────────────── */

function AnswerRules({
  question,
  answer,
  tickets,
  fields,
  maxPerType,
  onChange,
  onDone,
}: {
  question: FlowStep;
  answer: FlowOption;
  tickets: BuilderTicket[];
  fields: CheckoutField[];
  maxPerType: number;
  onChange: (patch: Partial<FlowOption>) => void;
  onDone: () => void;
}) {
  const method = answer.identity?.method ?? "NONE";
  const oneEach = answer.quantityEditable === false;
  const id = (part: string) => `rules-${answer.id}-${part}`;

  function setMethod(m: "NONE" | "EMAIL_OTP" | "GOOGLE") {
    onChange({
      identity:
        m === "NONE"
          ? { method: "NONE" }
          : m === "EMAIL_OTP"
            ? { method: m, emailDomain: answer.identity?.emailDomain ?? "", allowedEmailDomains: null }
            : { method: m, emailDomain: null, allowedEmailDomains: answer.identity?.allowedEmailDomains ?? null },
    });
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle>Rules for “{answer.label || "this answer"}”</SheetTitle>
        <SheetDescription>
          Applies to everyone who answers “{answer.label || "…"}” to “{question.title || "your question"}”.
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4">
        <FieldSet>
          <FieldLegend variant="label">Do they need to prove who they are?</FieldLegend>
          <RadioGroup value={method} onValueChange={(v) => setMethod(v as typeof method)}>
            <RadioCard id={id("none")} value="NONE" title="No" description="Anyone who picks this answer can book." />
            <RadioCard
              id={id("email")}
              value="EMAIL_OTP"
              title="Yes — confirm an email address"
              description="We email them a one-time link. Their ticket goes to that address."
            />
            <RadioCard
              id={id("google")}
              value="GOOGLE"
              title="Yes — sign in with Google"
              description="Their ticket goes to their Google account's email."
            />
          </RadioGroup>
          {method === "EMAIL_OTP" && (
            <Field>
              <FieldLabel htmlFor={id("domain")}>Only addresses ending in</FieldLabel>
              <Input
                id={id("domain")}
                value={answer.identity?.emailDomain ?? ""}
                onChange={(e) =>
                  onChange({
                    identity: { method, emailDomain: e.target.value.trim().replace(/^@/, "").toLowerCase() || "" },
                  })
                }
                placeholder="krmu.edu.in"
              />
              <FieldDescription>Leave empty to accept any email address.</FieldDescription>
            </Field>
          )}
          {method === "GOOGLE" && (
            <Field>
              <FieldLabel htmlFor={id("gdomains")}>Only Google accounts ending in (optional)</FieldLabel>
              <Input
                id={id("gdomains")}
                value={(answer.identity?.allowedEmailDomains ?? []).join(", ")}
                onChange={(e) =>
                  onChange({
                    identity: {
                      method,
                      allowedEmailDomains: e.target.value
                        .split(",")
                        .map((s) => s.trim().replace(/^@/, "").toLowerCase())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="krmu.edu.in, krmangalam.edu.in"
              />
              <FieldDescription>Separate several with commas. Leave empty to accept any Google account.</FieldDescription>
            </Field>
          )}
        </FieldSet>

        <Separator />

        <FieldSet>
          <FieldLegend variant="label">Which tickets can they buy?</FieldLegend>
          {tickets.length === 0 ? (
            <FieldDescription>You haven&apos;t added any tickets yet — add them under Overview.</FieldDescription>
          ) : (
            <>
              <Field orientation="horizontal">
                <Switch
                  id={id("all")}
                  checked={!answer.allowedTicketTypeIds}
                  onCheckedChange={(on) => onChange({ allowedTicketTypeIds: on ? null : tickets.map((t) => t.id) })}
                />
                <FieldLabel htmlFor={id("all")} className="font-normal">
                  All tickets
                </FieldLabel>
              </Field>
              {answer.allowedTicketTypeIds && (
                <FieldGroup className="gap-2 pl-1">
                  {tickets.map((t) => {
                    const list = answer.allowedTicketTypeIds ?? [];
                    return (
                      <Field key={t.id} orientation="horizontal">
                        <Checkbox
                          id={id(`t-${t.id}`)}
                          checked={list.includes(t.id)}
                          onCheckedChange={(on) =>
                            onChange({ allowedTicketTypeIds: on ? [...list, t.id] : list.filter((x) => x !== t.id) })
                          }
                        />
                        <FieldLabel htmlFor={id(`t-${t.id}`)} className="flex-1 font-normal">
                          {t.name}
                          <span className="ml-auto text-muted-foreground">
                            {t.pricePaise ? formatINR(t.pricePaise) : "Free"}
                          </span>
                        </FieldLabel>
                      </Field>
                    );
                  })}
                </FieldGroup>
              )}
            </>
          )}
        </FieldSet>

        <Separator />

        <FieldSet>
          <FieldLegend variant="label">How many tickets?</FieldLegend>
          <ToggleGroup
            value={[oneEach ? "one" : "choose"]}
            onValueChange={(v: string[]) => {
              const next = v[0];
              if (!next) return;
              onChange(next === "one" ? { quantityEditable: false, maxPerOrder: 1 } : { quantityEditable: null, maxPerOrder: null });
            }}
            variant="outline"
            className="w-full"
          >
            <ToggleGroupItem value="choose" className="flex-1">
              They choose
            </ToggleGroupItem>
            <ToggleGroupItem value="one" className="flex-1">
              One per person
            </ToggleGroupItem>
          </ToggleGroup>
          {oneEach ? (
            <FieldDescription>
              No quantity picker. Each person gets exactly one ticket, and can&apos;t book a second one.
            </FieldDescription>
          ) : (
            <Field>
              <FieldLabel htmlFor={id("max")}>Limit per person (optional)</FieldLabel>
              <Input
                id={id("max")}
                type="number"
                inputMode="numeric"
                min={1}
                max={maxPerType}
                value={answer.maxPerOrder ?? ""}
                onChange={(e) =>
                  onChange({
                    maxPerOrder: e.target.value ? Math.min(maxPerType, Math.max(1, Number(e.target.value))) : null,
                  })
                }
                placeholder={`No limit (up to ${maxPerType} per order)`}
              />
              <FieldDescription>Counts every booking they make, not just one order.</FieldDescription>
            </Field>
          )}
        </FieldSet>

        <Separator />

        <FieldSet>
          <FieldLegend variant="label">Seats for this group</FieldLegend>
          <Field orientation="horizontal">
            <Switch
              id={id("cap-on")}
              checked={typeof answer.capacity === "number"}
              onCheckedChange={(on) => onChange({ capacity: on ? 100 : null })}
            />
            <FieldLabel htmlFor={id("cap-on")} className="font-normal">
              Stop this group after a number of tickets
            </FieldLabel>
          </Field>
          {typeof answer.capacity === "number" && (
            <Field>
              <FieldLabel htmlFor={id("cap")}>Seats</FieldLabel>
              <Input
                id={id("cap")}
                type="number"
                inputMode="numeric"
                min={0}
                value={answer.capacity}
                onChange={(e) => onChange({ capacity: Math.max(0, Number(e.target.value) || 0) })}
              />
              <FieldDescription>Other groups can still book the remaining tickets.</FieldDescription>
            </Field>
          )}
        </FieldSet>

        {fields.length > 0 && (
          <>
            <Separator />
            <FieldSet>
              <FieldLegend variant="label">Extra details to ask</FieldLegend>
              <Field orientation="horizontal">
                <Switch
                  id={id("fields-all")}
                  checked={!answer.showFieldIds}
                  onCheckedChange={(on) => onChange({ showFieldIds: on ? null : fields.map((f) => f.id) })}
                />
                <FieldLabel htmlFor={id("fields-all")} className="font-normal">
                  Ask all of them
                </FieldLabel>
              </Field>
              {answer.showFieldIds && (
                <FieldGroup className="gap-2 pl-1">
                  {fields.map((f) => {
                    const list = answer.showFieldIds ?? [];
                    return (
                      <Field key={f.id} orientation="horizontal">
                        <Checkbox
                          id={id(`f-${f.id}`)}
                          checked={list.includes(f.id)}
                          onCheckedChange={(on) =>
                            onChange({ showFieldIds: on ? [...list, f.id] : list.filter((x) => x !== f.id) })
                          }
                        />
                        <FieldLabel htmlFor={id(`f-${f.id}`)} className="font-normal">
                          {f.label}
                          {f.required ? " (required)" : ""}
                        </FieldLabel>
                      </Field>
                    );
                  })}
                </FieldGroup>
              )}
              <FieldDescription>These are the fields you set up under Appearance.</FieldDescription>
            </FieldSet>
          </>
        )}
      </div>

      <SheetFooter>
        <Button onClick={onDone}>Done</Button>
      </SheetFooter>
    </>
  );
}

function RadioCard({ id, value, title, description }: { id: string; value: string; title: string; description: string }) {
  return (
    <FieldLabel htmlFor={id}>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>{title}</FieldTitle>
          <FieldDescription>{description}</FieldDescription>
        </FieldContent>
        <RadioGroupItem value={value} id={id} />
      </Field>
    </FieldLabel>
  );
}

/* ── Try it as a buyer ──────────────────────────────────────────────────── */

function BuyerPreview({
  eventId,
  questions,
  tickets,
  fields,
}: {
  eventId: string;
  questions: FlowStep[];
  tickets: BuilderTicket[];
  fields: CheckoutField[];
}) {
  const [picked, setPicked] = useState<Record<string, string>>({});

  // Default each question to its first answer so the preview always shows a path.
  const answers = Object.fromEntries(
    questions.map((q) => {
      const options = q.options ?? [];
      const chosen = options.find((o) => o.value === picked[q.id]) ?? options[0];
      return [q.id, chosen?.value ?? ""];
    }),
  );

  const offer = (() => {
    const flow: CheckoutFlow = {
      eventId,
      version: 0,
      status: "DRAFT",
      steps: questions,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const types = tickets.map(
      (t) =>
        ({
          _id: { toString: () => t.id },
          name: t.name,
          description: "",
          pricePaise: t.pricePaise,
          capacity: t.capacity,
          soldCount: t.soldCount,
          status: t.status ?? undefined,
          saleStartsAt: t.saleStartsAt ? new Date(t.saleStartsAt) : null,
          saleEndsAt: t.saleEndsAt ? new Date(t.saleEndsAt) : null,
          defaultMaxPerOrder: t.defaultMaxPerOrder,
          audienceOptionIds: t.audienceOptionIds,
        }) as unknown as TicketType,
    );
    return resolveOffer({
      flow,
      answers,
      identity: { method: "NONE", email: null, verified: false },
      ticketTypes: types,
    });
  })();

  const chosenAnswers = questions
    .map((q) => (q.options ?? []).find((o) => o.value === answers[q.id]))
    .filter((o): o is FlowOption => !!o);
  const identity = offer.identity.method;
  const domain = [...chosenAnswers].reverse().find((o) => o.identity?.method && o.identity.method !== "NONE")?.identity;
  const showFields = (() => {
    let ids: string[] | null = null;
    for (const a of chosenAnswers) {
      if (a.showFieldIds) ids = ids === null ? [...a.showFieldIds] : ids.filter((x) => a.showFieldIds!.includes(x));
    }
    return ids === null ? fields : fields.filter((f) => ids!.includes(f.id));
  })();
  const buyable = offer.ticketTypes.filter((t) => t.maxSelectable > 0);

  let step = 0;
  const n = () => ++step;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Try it as a buyer</CardTitle>
        <CardDescription>Pick answers to see exactly what that person goes through.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <ol className="space-y-4">
          {questions.map((q) => (
            <li key={q.id} className="space-y-2">
              <p className="font-medium">
                {n()}. {q.title || "Untitled question"}
              </p>
              <ToggleGroup
                value={[answers[q.id]]}
                onValueChange={(v: string[]) => v[0] && setPicked((p) => ({ ...p, [q.id]: v[0] }))}
                variant="outline"
                size="sm"
                className="flex-wrap justify-start"
              >
                {(q.options ?? []).map((o) => (
                  <ToggleGroupItem key={o.id} value={o.value}>
                    {o.label || "…"}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </li>
          ))}

          {identity !== "NONE" && (
            <li className="flex gap-2">
              <MailCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
              <p>
                <span className="font-medium">{n()}. </span>
                {identity === "GOOGLE"
                  ? `Signs in with Google${domain?.allowedEmailDomains?.length ? ` using an @${domain.allowedEmailDomains.join(" / @")} account` : ""}.`
                  : `Confirms their email with a one-time link${domain?.emailDomain ? ` — must end in @${domain.emailDomain}` : ""}.`}
              </p>
            </li>
          )}

          <li className="space-y-1.5">
            <p className="font-medium">{n()}. Chooses tickets</p>
            {buyable.length === 0 ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertDescription>
                  {tickets.length === 0 ? "No tickets exist yet." : "Nothing on sale for this person — they'd be stuck here."}
                </AlertDescription>
              </Alert>
            ) : offer.forcedItems ? (
              <p className="text-muted-foreground">
                Gets one {buyable[0].name} ({buyable[0].pricePaise ? formatINR(buyable[0].pricePaise) : "free"}) — no picker.
              </p>
            ) : (
              <ul className="space-y-1 text-muted-foreground">
                {buyable.map((t) => (
                  <li key={t.id} className="flex justify-between gap-2">
                    <span>{t.name}</span>
                    <span>
                      {t.pricePaise ? formatINR(t.pricePaise) : "Free"} · up to {t.maxSelectable}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>

          {showFields.length > 0 && (
            <li>
              <p className="font-medium">{n()}. Fills in</p>
              <p className="text-muted-foreground">{showFields.map((f) => f.label).join(", ")}</p>
            </li>
          )}

          <li>
            <p className="font-medium">
              {n()}.{" "}
              {buyable.length > 0 && buyable.every((t) => t.pricePaise === 0)
                ? "Gets the ticket by email — nothing to pay"
                : "Pays, and gets the ticket by email"}
            </p>
          </li>
        </ol>
      </CardContent>
    </Card>
  );
}
