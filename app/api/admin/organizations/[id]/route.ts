import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AdminError,
  deleteOrganization,
  forceDeleteOrganization,
  requireAdmin,
  setOrganizationStatus,
  updateOrganizationAsAdmin,
} from "@/lib/admin";

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  type: z.enum(["EVENT", "INSTITUTION", "CORPORATE"]).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  paymentAccountStatus: z
    .enum(["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED", "RESTRICTED"])
    .optional(),
});

/**
 * Rename an org, re-point its Razorpay account, change its type, or change
 * its approval / suspension status.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: "Check the submitted fields" }, { status: 400 });
    // Suspension is not a generic field patch — it goes through the dedicated
    // helper so the "suspend instead of delete" semantics stay in one place.
    const { status, ...fields } = parsed.data;
    const org = await updateOrganizationAsAdmin(id, fields);
    const updated = status ? await setOrganizationStatus(id, status) : org;
    return NextResponse.json({ organization: updated });
  } catch (error) {
    return orgErrorResponse(error);
  }
}

/**
 * Delete an organization.
 *
 * The default is the safe, non-cascading delete: refused with a 409 when the org
 * has orders or members, because the admin should suspend it instead so the
 * history survives.
 *
 * `?force=1` cascades instead, for the case where the org genuinely has to go.
 * It is a separate opt-in rather than a fallback on 409 so that a force delete
 * is always something the operator asked for by name. It still refuses on
 * unrefunded captured payments and on orders inside their checkout hold — see
 * `forceDeleteOrganization` for why each one costs someone money.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const force = new URL(request.url).searchParams.get("force") === "1";
    if (force) {
      const result = await forceDeleteOrganization(id);
      return NextResponse.json(result);
    }
    await deleteOrganization(id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return orgErrorResponse(error);
  }
}

function orgErrorResponse(error: unknown) {
  if (error instanceof AdminError)
    return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[admin/organizations/:id]", error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}
