"use server";

import { z } from "zod";
import { createDataRequest, verifyDataRequest } from "@/lib/privacy";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { err, ok, zodFieldErrors, type Result } from "@/lib/result";

const schema = z.object({
  type: z.enum(["ACCESS", "CORRECTION", "ERASURE"], { message: "Choose what you'd like us to do." }),
  email: z.string().trim().email("Enter the email address you booked with.").max(200),
  details: z.string().max(2000).default(""),
});

/**
 * Public and unauthenticated, so it says the same thing whether or not Morbin
 * holds anything for the address; rate-limited per IP and per address, with a
 * honeypot field real people never see.
 */
export async function submitDataRequestAction(formData: FormData): Promise<Result> {
  if (String(formData.get("website") ?? "")) return ok(undefined);
  if (!(await rateLimit("privacy:ip", await clientIp(), 5, 60 * 60 * 1000))) {
    return err("Too many requests from this connection. Try again in an hour.");
  }
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  if (parsed.data.type === "CORRECTION" && parsed.data.details.trim().length < 5) {
    return err("Tell us what should be corrected.", { details: "Tell us what should be corrected." });
  }
  // Over the per-address limit, pretend: a different answer would confirm the address is in use.
  if (!(await rateLimit("privacy:email", parsed.data.email.toLowerCase(), 3, 24 * 60 * 60 * 1000))) return ok(undefined);
  try {
    await createDataRequest(parsed.data);
    return ok(undefined);
  } catch (error) {
    console.error("[privacy:request]", error);
    return err("Something went wrong. Please try again.");
  }
}

export async function confirmDataRequestAction(token: string): Promise<Result<{ dueAt: string }>> {
  if (!(await rateLimit("privacy:verify", await clientIp(), 20, 60 * 60 * 1000))) {
    return err("Too many attempts. Try again in an hour.");
  }
  const result = await verifyDataRequest(token);
  if (!result.ok) {
    return err(result.reason === "expired" ? "This link has expired. Please make the request again." : "This link isn't valid, or was already used.");
  }
  return ok({ dueAt: result.dueAt.toISOString() });
}
