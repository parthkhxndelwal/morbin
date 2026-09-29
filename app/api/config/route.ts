import { NextResponse } from "next/server";

/** Non-sensitive integration flags for the UI (no secrets exposed). */
export async function GET() {
  return NextResponse.json({
    google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  });
}
