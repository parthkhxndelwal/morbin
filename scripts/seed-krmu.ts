/**
 * Seed the KRMU scenario so the real funnel can be exercised end to end.
 *
 * Creates a published event whose flow is exactly the one from the plan:
 *
 *   "Are you a KRMU student?"
 *     yes → college email → one-time link → 1 free student ticket, no stepper
 *     no  → Google popup → any quantity, outsider tickets only
 *
 * Idempotent: re-running reuses the same event. Safe to run against a dev
 * database.
 *
 *   node --experimental-strip-types --env-file=.env.local scripts/seed-krmu.ts
 */
import { MongoClient } from "mongodb";
import type {
  CheckoutFlow,
  Event,
  EventBranding,
  Organization,
  TicketType,
} from "../lib/types.ts";

// This script talks to MongoDB directly rather than importing lib/*, because
// those modules use the `@/` path alias and Node cannot resolve it without the
// Next.js loader. The only rule it needs from the app — that a branch's
// `quantityEditable: false` hides the stepper — is asserted by `npm run
// test:flow` against the real evaluator, so nothing here can drift silently.

const SLUG = "krmu-ideas-4-0";
const now = new Date();

const client = new MongoClient(process.env.MONGODB_URI ?? "");
await client.connect();
const db = client.db(process.env.MORBIN_DB ?? "morbin");

// Attach to the existing organization; there is exactly one in this database.
const org = (await db
  .collection<Organization>("organizations")
  .findOne({}, { sort: { createdAt: 1 } })) as Organization | null;
if (!org) {
  console.error("No organization exists. Sign in to Morbin and create one first.");
  process.exit(1);
}

const existing = await db.collection<Event>("events").findOne({ slug: SLUG });
let eventId: string;

if (existing?._id) {
  eventId = existing._id.toString();
  console.log(`Reusing event /event/${SLUG} (${eventId})`);
} else {
  const startsAt = new Date(now.getTime() + 21 * 86_400_000);
  const endsAt = new Date(startsAt.getTime() + 8 * 3_600_000);
  const event: Event = {
    organizationId: org._id!.toString(),
    title: "KRMU Ideas 4.0",
    slug: SLUG,
    description:
      "Ideas 4.0 is KRMU's annual flagship showcase for student builders.\n\n" +
      "Bring the thing you have been building. Talks on the main stage, a demo " +
      "floor for everything else, and students from across the state.",
    venue: "Koteshwaram auditorium, KRMU",
    timezone: "Asia/Kolkata",
    startsAt,
    endsAt,
    status: "PUBLISHED",
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await db.collection<Event>("events").insertOne(event);
  eventId = insertedId.toString();
  console.log(`Created event /event/${SLUG} (${eventId})`);

  // Free for students, paid for everyone else.
  await db.collection<TicketType>("ticketTypes").insertMany([
    {
      eventId,
      name: "Student",
      description: "Free entry. KRMU students only, one per person.",
      pricePaise: 0,
      capacity: 300,
      soldCount: 0,
      // Closed to every audience but the student branch.
      audienceOptionIds: ["o_student"],
    },
    {
      eventId,
      name: "General admission",
      description: "Open to everyone, KRMU students included.",
      pricePaise: 49900,
      capacity: 200,
      soldCount: 0,
      audienceOptionIds: null,
    },
  ] satisfies TicketType[]);
  console.log("  student ticket: free, closed to o_student");
  console.log("  general admission: ₹499, open to all");
}

const flow: CheckoutFlow = {
  eventId,
  version: 1,
  status: "PUBLISHED",
  steps: [
    {
      id: "s1_audience",
      kind: "SINGLE_CHOICE",
      required: true,
      title: "Are you a KRMU student?",
      description: "This decides which tickets you can get.",
      options: [
        {
          id: "o_student",
          label: "Yes, I'm a KRMU student",
          value: "STUDENT",
          nextStepId: "s2_identity",
          identity: { method: "EMAIL_OTP", emailDomain: "krmu.edu.in" },
          allowedTicketTypeIds: null,
          maxPerOrder: 1,
          quantityEditable: false,
          capacity: 300,
        },
        {
          id: "o_outsider",
          label: "No, I'm an outsider",
          value: "OUTSIDER",
          nextStepId: "s2_identity",
          identity: { method: "GOOGLE" },
          allowedTicketTypeIds: null,
          quantityEditable: true,
          capacity: 200,
        },
      ],
    },
    {
      id: "s2_identity",
      kind: "IDENTITY",
      required: true,
      title: "Confirm your email",
    },
    { id: "s3_quantity", kind: "QUANTITY", required: true, title: "How many tickets?" },
  ],
  createdAt: now,
  updatedAt: now,
};
// One published version per event: replace rather than accumulate, so re-running
// this script cannot leave two live flows.
await db
  .collection<CheckoutFlow>("checkoutFlows")
  .deleteMany({ eventId, version: 1 });
await db.collection<CheckoutFlow>("checkoutFlows").insertOne(flow);
await db.collection<Event>("events").updateOne({ slug: SLUG }, { $set: { flowVersion: 1 } });
console.log("  flow v1 published");

// `createdAt` only on insert — setting it in `$set` too would collide with
// `$setOnInsert` and Mongo rejects the write.
const branding: Omit<EventBranding, "createdAt"> = {
  eventId,
  bannerKey: null,
  socialImageKey: null,
  accentColor: "#7c3aed",
  ctaLabel: "Book Tickets Now",
  showDescription: true,
  showVenue: true,
  showDate: true,
  showTicketPreview: true,
  theme: "dark",
  customFields: [
    { id: "cf_name", label: "Full name", type: "TEXT", required: true, collectOn: "CHECKOUT_FORM" },
    { id: "cf_dept", label: "Department", type: "TEXT", required: false, collectOn: "CHECKOUT_FORM" },
  ],
  updatedAt: now,
};
await db
  .collection<EventBranding>("eventBranding")
  .updateOne(
    { eventId },
    { $set: branding, $setOnInsert: { createdAt: now } },
    { upsert: true },
  );
console.log("  custom fields: Full name (required), Department");

console.log(`
Ready. The funnel is live at:

  /event/${SLUG}

Two paths to try:
  student  → any name@krmu.edu.in  (the link appears in the server log; SES is
                                   dev-skipped without AWS credentials)
  outsider → a Google account      (any address)
`);

await client.close();
process.exit(0);
