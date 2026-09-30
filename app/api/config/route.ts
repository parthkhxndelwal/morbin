import { NextResponse } from "next/server";
import { isGoogleConfigured } from "@/lib/config";

/** Non-sensitive integration flags for the UI (no secrets exposed). */
export async function GET() {
  return NextResponse.json({
    google: isGoogleConfigured(),
  });
}
