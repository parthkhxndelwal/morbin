import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

/**
 * `<input type="datetime-local">` sends wall-clock time with no offset
 * ("2026-10-02T19:30"). Events are organised in India, so it is read as IST.
 * Returns null for anything that is not a real date.
 */
export function parseLocalDateTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(`${value.length === 16 ? `${value}:00` : value}+05:30`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a Date for a datetime-local input, in IST. */
export function toLocalDateTimeInput(date: Date | string): string {
  const d = new Date(new Date(date).getTime() + 5.5 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16);
}

const localDateTime = z
  .string()
  .min(1, "Required")
  .transform((v, ctx) => {
    const d = parseLocalDateTime(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date and time" });
      return z.NEVER;
    }
    return d;
  });

/** Event details as an organiser edits them. */
export const eventDetailsSchema = z
  .object({
    title: z.string().trim().min(3, "At least 3 characters").max(120, "At most 120 characters"),
    description: z
      .string()
      .trim()
      .min(10, "Tell buyers a little more (at least 10 characters)")
      .max(5000, "At most 5,000 characters"),
    venue: z.string().trim().min(2, "Where is it?").max(200),
    startsAt: localDateTime,
    endsAt: localDateTime,
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: "The event must end after it starts",
    path: ["endsAt"],
  });
