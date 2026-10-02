import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FieldErrors } from "@/components/patterns/form-dialog";

export interface EventFieldValues {
  title?: string;
  description?: string;
  venue?: string;
  /** datetime-local strings, IST */
  startsAt?: string;
  endsAt?: string;
}

/** The event detail fields, shared by "New event" and "Edit details". */
export function EventFields({
  errors,
  defaults = {},
}: {
  errors: FieldErrors;
  defaults?: EventFieldValues;
}) {
  return (
    <FieldGroup>
      <Field data-invalid={!!errors.title || undefined}>
        <FieldLabel htmlFor="event-title">Title</FieldLabel>
        <Input
          id="event-title"
          name="title"
          defaultValue={defaults.title}
          placeholder="e.g. Ideas 4.0 — Annual Tech Fest"
          aria-invalid={!!errors.title || undefined}
          required
        />
        <FieldError>{errors.title}</FieldError>
      </Field>
      <Field data-invalid={!!errors.description || undefined}>
        <FieldLabel htmlFor="event-description">Description</FieldLabel>
        <Textarea
          id="event-description"
          name="description"
          defaultValue={defaults.description}
          rows={4}
          placeholder="What is it, who is it for, what should people know?"
          aria-invalid={!!errors.description || undefined}
          required
        />
        <FieldError>{errors.description}</FieldError>
      </Field>
      <Field data-invalid={!!errors.venue || undefined}>
        <FieldLabel htmlFor="event-venue">Venue</FieldLabel>
        <Input
          id="event-venue"
          name="venue"
          defaultValue={defaults.venue}
          placeholder="e.g. KRMU Auditorium, Gurugram"
          aria-invalid={!!errors.venue || undefined}
          required
        />
        <FieldError>{errors.venue}</FieldError>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={!!errors.startsAt || undefined}>
          <FieldLabel htmlFor="event-starts">Starts (IST)</FieldLabel>
          <Input
            id="event-starts"
            name="startsAt"
            type="datetime-local"
            defaultValue={defaults.startsAt}
            aria-invalid={!!errors.startsAt || undefined}
            required
          />
          <FieldError>{errors.startsAt}</FieldError>
        </Field>
        <Field data-invalid={!!errors.endsAt || undefined}>
          <FieldLabel htmlFor="event-ends">Ends (IST)</FieldLabel>
          <Input
            id="event-ends"
            name="endsAt"
            type="datetime-local"
            defaultValue={defaults.endsAt}
            aria-invalid={!!errors.endsAt || undefined}
            required
          />
          <FieldError>{errors.endsAt}</FieldError>
        </Field>
      </div>
    </FieldGroup>
  );
}
