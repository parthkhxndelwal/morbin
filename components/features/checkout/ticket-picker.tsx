"use client";

import { MinusIcon, PlusIcon } from "lucide-react";
import { Money } from "@/components/patterns/money";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { CheckoutCustomField, CheckoutState } from "./types";

/** Ticket choice: a fixed single ticket when the rules decide it, otherwise steppers. */
export function TicketPicker({
  state,
  qty,
  onQty,
}: {
  state: CheckoutState;
  qty: Record<string, number>;
  onQty: (ticketTypeId: string, n: number) => void;
}) {
  const forced = state.offer.forcedItems;
  if (!state.offer.quantityRequired && forced) {
    const type = state.offer.ticketTypes.find((t) => t.id === forced[0].ticketTypeId);
    return (
      <div className="rounded-lg border p-4">
        <p className="font-medium">{type?.name ?? "Ticket"}</p>
        <p className="text-sm text-muted-foreground">
          1 × <Money paise={type?.pricePaise ?? 0} />
        </p>
        <p className="mt-1 text-xs text-muted-foreground">One ticket per verified person.</p>
      </div>
    );
  }
  if (state.offer.ticketTypes.length === 0) {
    return <p className="text-sm text-muted-foreground">There are no tickets you can book right now.</p>;
  }
  return (
    <ul className="divide-y rounded-lg border" aria-label="Tickets">
      {state.offer.ticketTypes.map((t) => {
        const n = qty[t.id] ?? 0;
        return (
          <li key={t.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-muted-foreground">
                {t.pricePaise === 0 ? "Free" : <Money paise={t.pricePaise} />} ·{" "}
                {t.left === 0 ? "Sold out" : t.maxSelectable === 0 ? "Not available for you" : `${t.left} left`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={n === 0}
                onClick={() => onQty(t.id, n - 1)}
                aria-label={`Remove one ${t.name}`}
              >
                <MinusIcon />
              </Button>
              <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">
                {n}
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={n >= t.maxSelectable}
                onClick={() => onQty(t.id, n + 1)}
                aria-label={`Add one ${t.name}`}
              >
                <PlusIcon />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The organiser's extra questions (Appearance → fields). */
export function DetailsFields({
  fields,
  values,
  onChange,
}: {
  fields: CheckoutCustomField[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <FieldGroup>
      {fields.map((f) => {
        const id = `cf-${f.id}`;
        const label = (
          <FieldLabel htmlFor={id}>
            {f.label}
            {f.required ? <span aria-hidden> *</span> : null}
          </FieldLabel>
        );
        return (
          <Field key={f.id}>
            {label}
            {f.type === "TEXTAREA" ? (
              <Textarea
                id={id}
                rows={2}
                value={values[f.id] ?? ""}
                onChange={(e) => onChange(f.id, e.target.value)}
                placeholder={f.placeholder ?? undefined}
                required={f.required}
              />
            ) : f.type === "SELECT" ? (
              <NativeSelect
                id={id}
                className="w-full"
                value={values[f.id] ?? ""}
                onChange={(e) => onChange(f.id, e.target.value)}
                required={f.required}
              >
                <NativeSelectOption value="">Select…</NativeSelectOption>
                {(f.options ?? []).map((o) => (
                  <NativeSelectOption key={o} value={o}>
                    {o}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : (
              <Input
                id={id}
                type={f.type === "TEL" ? "tel" : f.type === "EMAIL" ? "email" : "text"}
                value={values[f.id] ?? ""}
                onChange={(e) => onChange(f.id, e.target.value)}
                placeholder={f.placeholder ?? undefined}
                required={f.required}
              />
            )}
          </Field>
        );
      })}
    </FieldGroup>
  );
}
