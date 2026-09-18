import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireOwnerOrg } from "@/lib/organizations";
import { orgProfileSchema } from "@/lib/validations";
import { slugify } from "@/lib/slug";

export async function PATCH(request: Request) {
  const ctx = await requireOwnerOrg();
  if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  const parsed = orgProfileSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid profile" }, { status: 400 });
  const db = await getDb();
  const slug = slugify(parsed.data.name) || ctx.org.slug;
  const clash = await db.collection("organizations").findOne({
    slug,
    _id: { $ne: ctx.org._id },
  });
  if (clash) return NextResponse.json({ error: "Name already taken" }, { status: 409 });
  await db.collection("organizations").updateOne(
    { _id: ctx.org._id },
    {
      $set: {
        name: parsed.data.name.trim(),
        slug,
        onboardingStatus:
          ctx.org.onboardingStatus === "STARTED" ? "PROFILE_DONE" : ctx.org.onboardingStatus,
        updatedAt: new Date(),
      },
    },
  );
  return NextResponse.json({ ok: true, slug });
}
