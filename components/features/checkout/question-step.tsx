"use client";

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { CheckoutState, CheckoutStep } from "./types";

/**
 * The next unanswered question, by kind. A new step kind gets its own branch
 * here (the server lists it in `missingRequiredSteps` until answered).
 */
export function QuestionStep({
  state,
  onAnswer,
}: {
  state: CheckoutState;
  onAnswer: (stepId: string, value: string) => Promise<void>;
}) {
  const step = state.flow.steps.find((s) => s.id === state.offer.missingRequiredSteps[0]);
  if (!step) return null;
  const number = state.flow.steps.findIndex((s) => s.id === step.id) + 1;
  return (
    <div className="space-y-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Step {number}</p>
      {step.kind === "LOOKUP" ? (
        <LookupQuestion key={step.id} step={step} initial={state.answers[step.id] ?? ""} onAnswer={onAnswer} />
      ) : (
        <ChoiceQuestion step={step} onAnswer={onAnswer} />
      )}
    </div>
  );
}

function ChoiceQuestion({ step, onAnswer }: { step: CheckoutStep; onAnswer: (stepId: string, value: string) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{step.title}</h3>
        {step.description && <p className="text-sm text-muted-foreground">{step.description}</p>}
      </div>
      <div className="grid gap-2" role="group" aria-label={step.title}>
        {(step.options ?? []).map((o) => (
          <Button
            key={o.id}
            variant="outline"
            size="lg"
            className="h-auto justify-between py-3 text-left whitespace-normal"
            disabled={busy !== null}
            onClick={async () => {
              setBusy(o.id);
              await onAnswer(step.id, o.value);
              setBusy(null);
            }}
          >
            {o.label}
            {busy === o.id ? <Spinner /> : <ChevronRightIcon className="text-muted-foreground" />}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** "Enter your roll number": checked on the server, which only ever says match or not. */
function LookupQuestion({
  step,
  initial,
  onAnswer,
}: {
  step: CheckoutStep;
  initial: string;
  onAnswer: (stepId: string, value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const id = `lookup-${step.id}`;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim() || busy) return;
        setBusy(true);
        await onAnswer(step.id, value.trim());
        setBusy(false);
      }}
    >
      <Field>
        <FieldLabel htmlFor={id} className="text-base font-semibold">
          {step.title}
        </FieldLabel>
        {step.description && <FieldDescription>{step.description}</FieldDescription>}
        <Input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={step.inputHint ?? undefined}
          autoComplete="off"
          maxLength={100}
          autoFocus
        />
      </Field>
      <Button type="submit" size="lg" className="w-full" disabled={busy || !value.trim()}>
        {busy && <Spinner data-icon="inline-start" />}
        {busy ? "Checking…" : "Continue"}
      </Button>
    </form>
  );
}
