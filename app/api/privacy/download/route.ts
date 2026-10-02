import { NextResponse } from "next/server";
import { appUrl } from "@/lib/email";
import { downloadExport } from "@/lib/privacy";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** POST — spend a one-time export link and return the file. */
export async function POST(request: Request) {
  const back = (error: string) =>
    NextResponse.redirect(appUrl(`/privacy/request/download?error=${error}`), { status: 303 });
  if (!(await rateLimit("privacy:download", await clientIp(), 20, 60 * 60 * 1000))) return back("limit");
  const form = await request.formData().catch(() => null);
  const token = String(form?.get("token") ?? "");
  const result = await downloadExport(token);
  if (!result.ok) return back(result.reason);
  return new NextResponse(new Uint8Array(result.body), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
