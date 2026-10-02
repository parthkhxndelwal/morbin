"use server";

import { submitApplication } from "@/lib/applications";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { err, ok, zodFieldErrors, type Result } from "@/lib/result";
import { TxAbort } from "@/lib/tx";
import { applicationSchema } from "@/lib/validations";

/**
 * Public, unauthenticated: rate-limited per IP and per email, with a honeypot
 * field that real people never see. A bot that fills it is told it succeeded.
 */
export async function submitApplicationAction(formData: FormData): Promise<Result> {
  if (String(formData.get("website") ?? "")) return ok(undefined);

  const ip = await clientIp();
  if (!(await rateLimit("apply:ip", ip, 5, 60 * 60 * 1000))) {
    return err("Too many applications from this connection. Try again in an hour.");
  }
  const parsed = applicationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  if (!(await rateLimit("apply:email", parsed.data.email, 3, 24 * 60 * 60 * 1000))) {
    return err("We've already received applications from this email today.");
  }
  try {
    // Consent is recorded as the application's consentAt timestamp.
    const { organizationName, type, contactName, email, phone, city, eventsPerYear, ticketsPerEvent, gstin, about } =
      parsed.data;
    await submitApplication({ organizationName, type, contactName, email, phone, city, eventsPerYear, ticketsPerEvent, gstin, about });
    return ok(undefined, "Application sent");
  } catch (error) {
    if (error instanceof TxAbort) return err(error.message);
    console.error("[apply]", error);
    return err("Something went wrong. Please try again.");
  }
}
