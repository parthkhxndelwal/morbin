import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createOrganization, getOrgByOwner } from "@/lib/organizations";
import type { Organization } from "@/lib/types";

const schema = z.object({ name: z.string().min(2).max(80) });

function serialize(org: Organization) {
  return {
    id: org._id?.toString() ?? "",
    name: org.name,
    slug: org.slug,
    onboardingStatus: org.onboardingStatus,
    paymentAccountStatus: org.paymentAccountStatus,
    payoutsEnabled: org.payoutsEnabled,
    chargesEnabled: org.chargesEnabled,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = await getOrgByOwner(session.user.id);
  if (!org) return NextResponse.json({ organization: null });
  return NextResponse.json({ organization: serialize(org) });
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid name" }, { status: 400 });
  const existing = await getOrgByOwner(session.user.id);
  if (existing)
    return NextResponse.json({ error: "Organization already exists" }, { status: 409 });
  const org = await createOrganization(session.user.id, parsed.data.name);
  return NextResponse.json({ organization: serialize(org) }, { status: 201 });
}
