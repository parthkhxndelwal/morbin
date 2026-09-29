import { NextResponse } from "next/server";
import { z } from "zod";
import { AdminError, requireAdmin, updateOrganizationAsAdmin } from "@/lib/admin";

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  razorpayAccountId: z.string().max(80).nullable().optional(),
  paymentAccountStatus: z
    .enum(["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED", "RESTRICTED"])
    .optional(),
});

/** Rename an org, re-point its Razorpay account, or change its approval status. */
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
    const org = await updateOrganizationAsAdmin(id, parsed.data);
    return NextResponse.json({ organization: org });
  } catch (error) {
    if (error instanceof AdminError)
      return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[admin/organizations/:id]", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
