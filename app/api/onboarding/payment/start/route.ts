import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getOrgByOwner } from "@/lib/organizations";
import { createLinkedAccount } from "@/lib/razorpay-accounts";

/** Start Razorpay linked-account onboarding for the caller's org. */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id || !session.user.email)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getOrgByOwner(session.user.id);
  if (!org || !org._id)
    return NextResponse.json({ error: "Create an organization first" }, { status: 404 });
  if (org.paymentAccountStatus === "VERIFIED")
    return NextResponse.json({ ok: true, status: "VERIFIED" });

  try {
    let accountId = org.razorpayAccountId;
    if (!accountId) {
      accountId = await createLinkedAccount({
        name: org.name,
        email: session.user.email,
      });
    }
    const db = await getDb();
    await db.collection("organizations").updateOne(
      { _id: org._id },
      {
        $set: {
          razorpayAccountId: accountId,
          paymentAccountStatus: "PENDING",
          onboardingStatus:
            org.onboardingStatus === "ACTIVE" ? "ACTIVE" : "PAYMENT_PENDING",
          updatedAt: new Date(),
        },
      },
    );
    return NextResponse.json({
      ok: true,
      status: "PENDING",
      message:
        "Payment account created. Complete verification in the Razorpay dashboard, then sync status.",
    });
  } catch (error) {
    console.error("[onboarding/payment/start]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to start verification" },
      { status: 502 },
    );
  }
}
