import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getOrgByOwner } from "@/lib/organizations";
import { fetchLinkedAccountStatus } from "@/lib/razorpay-accounts";

/** Re-sync Razorpay linked-account status into the org record. */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getOrgByOwner(session.user.id);
  if (!org || !org._id)
    return NextResponse.json({ error: "Create an organization first" }, { status: 404 });
  if (!org.razorpayAccountId)
    return NextResponse.json({ error: "Verification not started" }, { status: 400 });

  try {
    const status = await fetchLinkedAccountStatus(org.razorpayAccountId);
    const verified = status === "VERIFIED";
    const db = await getDb();
    await db.collection("organizations").updateOne(
      { _id: org._id },
      {
        $set: {
          paymentAccountStatus: status,
          payoutsEnabled: verified,
          chargesEnabled: verified,
          onboardingStatus: verified ? "ACTIVE" : org.onboardingStatus,
          updatedAt: new Date(),
        },
      },
    );
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    console.error("[onboarding/payment/sync]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to sync status" },
      { status: 502 },
    );
  }
}
