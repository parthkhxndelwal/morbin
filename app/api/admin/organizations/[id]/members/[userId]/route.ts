import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminError, removeOrgMember, requireAdmin, updateOrgMember } from "@/lib/admin";

const patchSchema = z.object({
  name: z.string().max(80).optional(),
  role: z.enum(["OWNER", "MEMBER"]).optional(),
  /** Omit to leave the password alone; any value resets it. */
  password: z.string().optional(),
});

/**
 * Update a member's name or role, or reset their password. The lib refuses to
 * lower the owner's role or to promote someone else to owner.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    await requireAdmin();
    const { id, userId } = await params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Check the submitted fields" }, { status: 400 });
    const member = await updateOrgMember(id, userId, parsed.data);
    return NextResponse.json({ member });
  } catch (error) {
    return memberErrorResponse(error);
  }
}

/**
 * Remove someone from the organization. Their account, orders and issued
 * tickets are kept; only the membership goes. The owner cannot be removed.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    await requireAdmin();
    const { id, userId } = await params;
    await removeOrgMember(id, userId);
    return NextResponse.json({ removed: true });
  } catch (error) {
    return memberErrorResponse(error);
  }
}

function memberErrorResponse(error: unknown) {
  if (error instanceof AdminError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[admin/organizations/:id/members/:userId]", error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
