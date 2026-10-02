"use server";

import { err, ok, zodFieldErrors, type Result } from "@/lib/result";
import { acceptInvite } from "@/lib/team";
import { TxAbort } from "@/lib/tx";
import { joinTeamSchema } from "@/lib/validations";

/**
 * Accept a team invite. The token is the only authority: it is re-checked and
 * spent inside `acceptInvite`'s transaction, so a reused, revoked or expired
 * link creates nothing.
 */
export async function acceptInviteAction(token: string, formData: FormData): Promise<Result<{ email: string }>> {
  const parsed = joinTeamSchema.safeParse({
    name: formData.get("name") ?? "",
    password: formData.get("password") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    const data = await acceptInvite(token, { name: parsed.data.name, password: parsed.data.password });
    return ok(data, "Welcome aboard");
  } catch (error) {
    if (error instanceof TxAbort) return err(error.message);
    console.error("[join:action]", error);
    return err("Something went wrong. Please try again.");
  }
}
