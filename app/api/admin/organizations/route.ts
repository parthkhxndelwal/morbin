import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AdminError,
  createOrganizationForOwner,
  listOrganizations,
  requireAdmin,
} from "@/lib/admin";

const createSchema = z.object({
  name: z.string().min(2).max(80),
  ownerName: z.string().max(80).default(""),
  ownerEmail: z.string().email(),
  ownerPassword: z.string().optional(),
  type: z.enum(["EVENT", "INSTITUTION", "CORPORATE"]).optional(),
  paymentAccountStatus: z
    .enum(["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED", "RESTRICTED"])
    .optional(),
});

/** List every organization with its owner and event count. */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ organizations: await listOrganizations() });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

/** Create an organization (and its owner account if needed). */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Check the submitted fields" }, { status: 400 });
    const { org, ownerCreated } = await createOrganizationForOwner(parsed.data);
    return NextResponse.json({ organization: org, ownerCreated }, { status: 201 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

/**
 * Shared 4xx/5xx mapper: an AdminError carries the status it wants, anything
 * else is an unexpected failure that must not leak its message.
 */
export function adminErrorResponse(error: unknown, tag = "[admin]") {
  if (error instanceof AdminError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(tag, error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
