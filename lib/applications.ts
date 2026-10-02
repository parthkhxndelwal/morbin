import "server-only";

import { createOrganization } from "@/lib/admin-orgs";
import { audit, notify } from "@/lib/audit";
import { getDb, toObjectId } from "@/lib/db";
import { appUrl } from "@/lib/email";
import { TxAbort } from "@/lib/tx";
import type { EmailRecord, OrgApplication, User } from "@/lib/types";

/**
 * "List your event" applications. Anyone may apply; a Morbin admin approves
 * (which creates the organisation and emails the owner a set-password link),
 * asks for more information, or rejects. The applicant hears about each step
 * by email; nothing about an application is ever shown publicly.
 */

type NewApplication = Omit<
  OrgApplication,
  "_id" | "status" | "consentAt" | "decisionNote" | "decidedBy" | "decidedAt" | "organizationId" | "createdAt" | "updatedAt"
>;

async function emailApplicant(
  app: Pick<OrgApplication, "email" | "contactName" | "organizationName">,
  stage: NonNullable<NonNullable<EmailRecord["meta"]>["applicationStage"]>,
  message: string | null,
): Promise<void> {
  const db = await getDb();
  await db.collection<EmailRecord>("emailDeliveries").insertOne({
    orderId: null,
    ticketId: null,
    recipient: app.email,
    kind: "APPLICATION",
    status: "QUEUED",
    attempts: 0,
    lastError: null,
    meta: {
      attendeeName: app.contactName,
      organizationName: app.organizationName,
      applicationStage: stage,
      message,
      link: stage === "APPROVED" ? appUrl("/auth") : null,
    },
  });
  try {
    const { flushEmailQueue } = await import("@/lib/email");
    await flushEmailQueue(5);
  } catch {
    /* the scheduler retries */
  }
}

export async function submitApplication(input: NewApplication): Promise<void> {
  const db = await getDb();
  const now = new Date();
  try {
    await db.collection<OrgApplication>("applications").insertOne({
      ...input,
      status: "NEW",
      consentAt: now,
      decisionNote: null,
      decidedBy: null,
      decidedAt: null,
      organizationId: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    // The partial unique index: one open application per email.
    if ((error as { code?: number }).code === 11000) {
      throw new TxAbort("We already have an application from this email address. We'll be in touch soon.", 409);
    }
    throw error;
  }
  await emailApplicant(input, "RECEIVED", null);
  await notify({
    organizationId: null,
    audience: "ADMIN",
    kind: "APPLICATION_NEW",
    title: `New application: ${input.organizationName}`,
    body: `${input.contactName} · ${input.city} · ${input.eventsPerYear} events a year`,
    link: "/dashboard/admin/applications",
  });
}

export interface ApplicationRow {
  id: string;
  status: OrgApplication["status"];
  organizationName: string;
  type: string;
  contactName: string;
  email: string;
  phone: string;
  city: string;
  eventsPerYear: string;
  ticketsPerEvent: string;
  gstin: string | null;
  about: string;
  decisionNote: string | null;
  organizationId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export async function listApplications(): Promise<ApplicationRow[]> {
  const db = await getDb();
  const docs = await db.collection<OrgApplication>("applications").find({}).sort({ createdAt: -1 }).limit(1000).toArray();
  return docs.map((a) => ({
    id: a._id!.toString(),
    status: a.status,
    organizationName: a.organizationName,
    type: a.type,
    contactName: a.contactName,
    email: a.email,
    phone: a.phone,
    city: a.city,
    eventsPerYear: a.eventsPerYear,
    ticketsPerEvent: a.ticketsPerEvent,
    gstin: a.gstin,
    about: a.about,
    decisionNote: a.decisionNote,
    organizationId: a.organizationId,
    createdAt: a.createdAt.toISOString(),
    decidedAt: a.decidedAt?.toISOString() ?? null,
  }));
}

async function openApplication(id: string): Promise<OrgApplication & { _id: NonNullable<OrgApplication["_id"]> }> {
  const _id = toObjectId(id);
  const db = await getDb();
  const app = _id ? await db.collection<OrgApplication>("applications").findOne({ _id }) : null;
  if (!app) throw new TxAbort("Application not found.", 404);
  if (app.status === "APPROVED" || app.status === "REJECTED") throw new TxAbort("This application has already been decided.", 409);
  return app as OrgApplication & { _id: NonNullable<OrgApplication["_id"]> };
}

export async function approveApplication(id: string, admin: { id: string; email: string }): Promise<{ organizationId: string }> {
  const app = await openApplication(id);
  const db = await getDb();
  const hadPassword = !!(await db.collection<User>("users").findOne({ email: app.email, passwordHash: { $exists: true } }));
  const { id: organizationId } = await createOrganization(
    { name: app.organizationName, type: app.type, ownerEmail: app.email, ownerName: app.contactName },
    admin,
  );
  await db.collection<OrgApplication>("applications").updateOne(
    { _id: app._id },
    { $set: { status: "APPROVED", organizationId, decidedBy: admin.id, decidedAt: new Date(), updatedAt: new Date() } },
  );
  // A new owner already got the set-password email from createOrganization.
  if (hadPassword) await emailApplicant(app, "APPROVED", null);
  // Copy what the applicant told us onto the organisation's profile.
  await db.collection("organizations").updateOne(
    { _id: toObjectId(organizationId)! },
    { $set: { contactEmail: app.email, contactPhone: app.phone, gstin: app.gstin } },
  );
  await audit({
    actorId: admin.id,
    actorRole: "ADMIN",
    action: "application.approved",
    targetType: "application",
    targetId: id,
    organizationId,
    meta: {},
  });
  return { organizationId };
}

export async function rejectApplication(id: string, reason: string, adminId: string): Promise<void> {
  const app = await openApplication(id);
  const db = await getDb();
  await db.collection<OrgApplication>("applications").updateOne(
    { _id: app._id },
    { $set: { status: "REJECTED", decisionNote: reason, decidedBy: adminId, decidedAt: new Date(), updatedAt: new Date() } },
  );
  await emailApplicant(app, "REJECTED", reason);
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: "application.rejected",
    targetType: "application",
    targetId: id,
    organizationId: null,
    meta: {},
  });
}

export async function requestApplicationInfo(id: string, message: string, adminId: string): Promise<void> {
  const app = await openApplication(id);
  const db = await getDb();
  await db.collection<OrgApplication>("applications").updateOne(
    { _id: app._id },
    { $set: { status: "INFO_REQUESTED", decisionNote: message, updatedAt: new Date() } },
  );
  await emailApplicant(app, "INFO_REQUESTED", message);
  await audit({
    actorId: adminId,
    actorRole: "ADMIN",
    action: "application.info_requested",
    targetType: "application",
    targetId: id,
    organizationId: null,
    meta: {},
  });
}
