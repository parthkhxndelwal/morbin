import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminError, addOrgMember, listOrgMembers, requireAdmin } from "@/lib/admin";

const createSchema = z.object({
  email: z.string().email(),
  name: z.string().max(80).optional(),
  /** Only used when the email has no Morbin account yet. */
  password: z.string().optional(),
  // An org has exactly one owner, and ownership is transferred explicitly —
  // so this endpoint can only ever mint plain members.
  role: z.literal("MEMBER").optional(),
});

/** List an organization's members (owner first, then join order). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    return NextResponse.json({ members: await listOrgMembers(id) });
  } catch (error) {
    return membersErrorResponse(error);
  }
}

/**
 * Add a member, provisioning their account when the email is new.
 * The password is only required in that case; the lib enforces its length
 * and answers with a 400 when it is missing.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Check the submitted fields" }, { status: 400 });
    const { member, userCreated } = await addOrgMember(id, parsed.data);
    return NextResponse.json({ member, userCreated }, { status: 201 });
  } catch (error) {
    return membersErrorResponse(error);
  }
}

function membersErrorResponse(error: unknown) {
  if (error instanceof AdminError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[admin/organizations/:id/members]", error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
