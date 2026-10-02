import { z } from "zod";
import { MIN_PASSWORD_LENGTH } from "@/lib/admin-bootstrap-plan";
import { GST_STATES, gstStateName } from "@/lib/invoice-rules";

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

const optionalLocalDateTime = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = parseLocalDateTime(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "Enter a valid date and time" });
      return z.NEVER;
    }
    return d;
  });

/** "₹499.50" / "499.5" / "0" → paise. */
const rupees = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const cleaned = v.replace(/[₹,\s]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      ctx.addIssue({ code: "custom", message: "Enter a price like 499 or 499.50 (0 for free)" });
      return z.NEVER;
    }
    return Math.round(Number(cleaned) * 100);
  })
  .pipe(z.number().int().min(0).max(10_000_000, "That price is too high"));

const positiveInt = (label: string, max: number) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (!/^\d+$/.test(v)) {
        ctx.addIssue({ code: "custom", message: `${label} must be a whole number` });
        return z.NEVER;
      }
      return Number(v);
    })
    .pipe(z.number().int().min(1, `${label} must be at least 1`).max(max, `${label} is too large`));

export const ticketTypeSchema = z
  .object({
    name: z.string().trim().min(2, "Name it (at least 2 characters)").max(80),
    description: z.string().trim().max(500).default(""),
    price: rupees,
    capacity: positiveInt("Capacity", 1_000_000),
    maxPerOrder: z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > 50) {
          ctx.addIssue({ code: "custom", message: "Between 1 and 50, or leave empty" });
          return z.NEVER;
        }
        return n;
      }),
    saleStartsAt: optionalLocalDateTime,
    saleEndsAt: optionalLocalDateTime,
  })
  .refine((v) => !v.saleStartsAt || !v.saleEndsAt || v.saleEndsAt > v.saleStartsAt, {
    message: "Sales must end after they start",
    path: ["saleEndsAt"],
  });

/* ────────────────────────────────────────────────────────────────────────────
 * Organisation settings
 *
 * FormData always delivers strings, so every optional field below is written
 * as "blank means unset": the box is trimmed, a format is checked only when
 * something was typed, and an empty result becomes `null` for the database.
 * ──────────────────────────────────────────────────────────────────────────── */

/** The GSTIN shape: 2-digit state code, 10-char PAN, entity code, 'Z', checksum. */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** IFSC: 4 letters (bank), '0' (reserved), 6 alphanumeric (branch). */
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * An optional field: an empty box clears it, anything else must satisfy
 * `schema`. The inner schema's own message is replaced with `error` so the
 * inline error is written in the app's voice — a union of "blank or valid"
 * would only ever surface zod's generic "invalid input".
 */
const optionalField = (
  schema: z.ZodType,
  error: string,
  normalise: (v: string) => string = (v) => v,
) =>
  z
    .string()
    .transform(normalise)
    .refine((v) => v.length === 0 || schema.safeParse(v).success, error)
    .transform((v) => (v.length > 0 ? v : null));

export const orgProfileSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(120, "At most 120 characters"),
  contactEmail: optionalField(z.string().email(), "Enter a valid email address", (v) =>
    v.trim().toLowerCase(),
  ),
  contactPhone: optionalField(
    z.string().regex(/^\+?[\d\s-]{7,18}$/, ""),
    "Enter a valid phone number",
    (v) => v.trim(),
  ),
  gstin: optionalField(
    z.string().regex(GSTIN_RE, ""),
    "A GSTIN looks like 27AAPFU0939F1ZV",
    (v) => v.trim().toUpperCase(),
  ),
  address: optionalField(
    z.string().max(500, "At most 500 characters"),
    "At most 500 characters",
    (v) => v.trim(),
  ),
  stateCode: z
    .string()
    .trim()
    .refine((v) => v === "" || GST_STATES.some((s) => s.code === v), "Choose a state from the list")
    .transform((v) => v || null)
    .optional()
    .transform((v) => v ?? null),
}).superRefine((v, ctx) => {
  // A GSTIN's first two digits are its state; the two must agree.
  const fromGstin = v.gstin ? String(v.gstin).slice(0, 2) : null;
  if (fromGstin && v.stateCode && fromGstin !== v.stateCode) {
    ctx.addIssue({
      code: "custom",
      path: ["stateCode"],
      message: `Your GSTIN is registered in ${gstStateName(fromGstin) ?? `state ${fromGstin}`}`,
    });
  }
});

/** Who pays the convenience fee. The rate itself is admin-set and not here. */
export const feeBearerSchema = z.object({
  feeBearer: z.enum(["CUSTOMER", "ORGANISER"], { error: "Choose who pays the convenience fee" }),
});

/**
 * Payout bank details. `accountNumber` is optional: a blank box keeps whatever is
 * already stored, so an owner can correct a name or IFSC without the number
 * ever having to travel back through the browser.
 */
export const payoutAccountSchema = z.object({
  accountName: z.string().trim().min(2, "At least 2 characters").max(120, "At most 120 characters"),
  ifsc: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .refine((v) => IFSC_RE.test(v), "An IFSC looks like HDFC0001234"),
  accountNumber: optionalField(
    z.string().regex(/^[0-9]{9,18}$/, ""),
    "Enter the account number — 9 to 18 digits",
    (v) => v.replace(/[\s-]/g, ""),
  ),
});

/** Owner inviting someone to the team. Name is optional: the invitee can set it. */
export const teamInviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email("Enter a valid email address").max(254, "That email is too long")),
  name: z
    .string()
    .trim()
    .max(80, "At most 80 characters")
    .transform((v) => v || null),
});

/** Someone accepting a team invite: their name and a new password. */
/** What a password must contain — shown wherever one is chosen, enforced by joinTeamSchema. */
export const PASSWORD_RULES = [`At least ${MIN_PASSWORD_LENGTH} characters`, "an uppercase letter", "a number"] as const;
export const PASSWORD_RULES_TEXT = `${PASSWORD_RULES[0]}, with ${PASSWORD_RULES[1]} and ${PASSWORD_RULES[2]}.`;

export const joinTeamSchema = z
  .object({
    name: z.string().trim().min(2, "At least 2 characters").max(80, "At most 80 characters"),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters`)
      .max(128, "At most 128 characters")
      .regex(/[A-Z]/, "Include an uppercase letter")
      .regex(/[0-9]/, "Include a number"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The passwords don't match" });

const ORG_TYPES = ["EVENT", "INSTITUTION", "CORPORATE"] as const;
const PAYMENT_STATUSES = ["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED", "RESTRICTED"] as const;

/** Admin creating an organisation for someone. */
export const adminCreateOrgSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(120, "At most 120 characters"),
  type: z.enum(ORG_TYPES, { error: "Choose a type" }),
  ownerEmail: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.string().email("Enter a valid email address")),
  ownerName: z.string().trim().max(80, "At most 80 characters"),
});

/** Admin editing an organisation's identity and payment status. */
export const adminOrgBasicsSchema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(120, "At most 120 characters"),
  type: z.enum(ORG_TYPES),
  paymentAccountStatus: z.enum(PAYMENT_STATUSES),
});

/** A percentage typed by a person ("7", "7.5"), returned in basis points. Empty = platform default. */
export const feePercentSchema = z.object({
  fee: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{1,2}(\.\d{1,2})?$/.test(v), "Enter a percentage like 5 or 7.5")
    .transform((v) => (v === "" ? null : Math.round(Number(v) * 100))),
  note: z
    .string()
    .trim()
    .max(300, "At most 300 characters")
    .transform((v) => v || null),
});

/** Public "List your event" form. */
export const applicationSchema = z.object({
  organizationName: z.string().trim().min(2, "At least 2 characters").max(120, "At most 120 characters"),
  type: z.enum(["EVENT", "INSTITUTION", "CORPORATE"], { error: "Choose what describes you best" }),
  contactName: z.string().trim().min(2, "At least 2 characters").max(80, "At most 80 characters"),
  email: z.string().trim().toLowerCase().pipe(z.string().email("Enter a valid email address").max(254)),
  phone: z.string().trim().regex(/^\+?[\d\s-]{7,18}$/, "Enter a valid phone number"),
  city: z.string().trim().min(2, "Which city are you in?").max(80, "At most 80 characters"),
  eventsPerYear: z.enum(["1", "2-5", "6-20", "20+"], { error: "Choose one" }),
  ticketsPerEvent: z.enum(["<100", "100-500", "500-2000", "2000+"], { error: "Choose one" }),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || GSTIN_RE.test(v), "A GSTIN looks like 27AAPFU0939F1ZV")
    .transform((v) => v || null),
  about: z.string().trim().min(20, "Tell us a little more (at least 20 characters)").max(2000, "At most 2000 characters"),
  consent: z.literal("on", { error: "We need your consent to contact you about this application" }),
});

/** Admin → Settings: platform defaults and Morbin's GST identity for invoices. */
export const platformSettingsSchema = z.object({
  defaultFee: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, "Enter a percentage like 5 or 7.5")
    .transform((v) => Math.round(Number(v) * 100))
    .refine((v) => v <= 3000, "At most 30%"),
  defaultRetentionMonths: z.coerce.number().int("Whole months").min(1, "At least 1").max(120, "At most 120"),
  legalName: z.string().trim().max(160),
  tradeName: z.string().trim().max(160),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || GSTIN_RE.test(v), "A GSTIN looks like 27AAPFU0939F1ZV"),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), "A PAN looks like AAPFU0939F"),
  address: z.string().trim().max(500),
  state: z.string().trim().max(60),
  stateCode: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{2}$/.test(v), "Two digits, e.g. 07 for Delhi"),
  sac: z
    .string()
    .trim()
    .refine((v) => v === "" || /^\d{6}$/.test(v), "Six digits, e.g. 998599"),
  gstRate: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,2})?$/, "Enter a rate like 18")
    .transform((v) => Math.round(Number(v) * 100)),
  splitRule: z.enum(["SUPPLIER_STATE", "ALWAYS_IGST"]),
  // GST invoice numbers are at most 16 characters: PREFIX/26-27/NNNN…
  invoicePrefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,3}$/, "Up to 3 letters or digits"),
  footerText: z.string().trim().max(300),
});
