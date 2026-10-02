import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Textarea } from "@/components/ui/textarea";
import type { FieldErrors } from "@/components/patterns/form-dialog";

export interface TicketTypeFieldValues {
  name?: string;
  description?: string;
  /** Rupees as typed, e.g. "499" */
  price?: string;
  capacity?: string;
  maxPerOrder?: string;
  saleStartsAt?: string;
  saleEndsAt?: string;
}

export function TicketTypeFields({
  errors,
  defaults = {},
  priceLocked = false,
  soldCount = 0,
}: {
  errors: FieldErrors;
  defaults?: TicketTypeFieldValues;
  /** True once tickets of this type are sold. */
  priceLocked?: boolean;
  soldCount?: number;
}) {
  const invalid = (k: string) => !!errors[k] || undefined;
  return (
    <FieldGroup>
      <Field data-invalid={invalid("name")}>
        <FieldLabel htmlFor="tt-name">Name</FieldLabel>
        <Input id="tt-name" name="name" defaultValue={defaults.name} placeholder="e.g. General admission" aria-invalid={invalid("name")} required />
        <FieldError>{errors.name}</FieldError>
      </Field>
      <Field data-invalid={invalid("description")}>
        <FieldLabel htmlFor="tt-description">Description (optional)</FieldLabel>
        <Textarea id="tt-description" name="description" defaultValue={defaults.description} rows={2} placeholder="What's included" aria-invalid={invalid("description")} />
        <FieldError>{errors.description}</FieldError>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={invalid("price")}>
          <FieldLabel htmlFor="tt-price">Price</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>₹</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id="tt-price"
              name="price"
              inputMode="decimal"
              defaultValue={defaults.price}
              placeholder="0 for free"
              aria-invalid={invalid("price")}
              readOnly={priceLocked}
              required
            />
          </InputGroup>
          <FieldDescription>
            {priceLocked ? "Locked — tickets have been sold at this price." : "The ticket price, before any convenience fee."}
          </FieldDescription>
          <FieldError>{errors.price}</FieldError>
        </Field>
        <Field data-invalid={invalid("capacity")}>
          <FieldLabel htmlFor="tt-capacity">Capacity</FieldLabel>
          <Input id="tt-capacity" name="capacity" inputMode="numeric" defaultValue={defaults.capacity} placeholder="e.g. 200" aria-invalid={invalid("capacity")} required />
          {soldCount > 0 && <FieldDescription>{soldCount} already sold — can’t go below that.</FieldDescription>}
          <FieldError>{errors.capacity}</FieldError>
        </Field>
      </div>
      <Field data-invalid={invalid("maxPerOrder")}>
        <FieldLabel htmlFor="tt-max">Max per order (optional)</FieldLabel>
        <Input id="tt-max" name="maxPerOrder" inputMode="numeric" defaultValue={defaults.maxPerOrder} placeholder="Default: 10" aria-invalid={invalid("maxPerOrder")} />
        <FieldError>{errors.maxPerOrder}</FieldError>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={invalid("saleStartsAt")}>
          <FieldLabel htmlFor="tt-sale-start">Sales open (optional, IST)</FieldLabel>
          <Input id="tt-sale-start" name="saleStartsAt" type="datetime-local" defaultValue={defaults.saleStartsAt} aria-invalid={invalid("saleStartsAt")} />
          <FieldError>{errors.saleStartsAt}</FieldError>
        </Field>
        <Field data-invalid={invalid("saleEndsAt")}>
          <FieldLabel htmlFor="tt-sale-end">Sales close (optional, IST)</FieldLabel>
          <Input id="tt-sale-end" name="saleEndsAt" type="datetime-local" defaultValue={defaults.saleEndsAt} aria-invalid={invalid("saleEndsAt")} />
          <FieldError>{errors.saleEndsAt}</FieldError>
        </Field>
      </div>
    </FieldGroup>
  );
}
