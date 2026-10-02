"use server";

import { completeAccountSetup } from "@/lib/account-setup";
import { err, ok, zodFieldErrors, type Result } from "@/lib/result";
import { TxAbort } from "@/lib/tx";
import { joinTeamSchema } from "@/lib/validations";

/** Spend a set-password link. The token is the only authority, checked and claimed atomically. */
export async function setPasswordAction(token: string, formData: FormData): Promise<Result<{ email: string }>> {
  const parsed = joinTeamSchema.safeParse({
    name: formData.get("name") ?? "",
    password: formData.get("password") ?? "",
    confirm: formData.get("confirm") ?? "",
  });
  if (!parsed.success) return err("Check the highlighted fields.", zodFieldErrors(parsed.error.issues));
  try {
    return ok(await completeAccountSetup(token, { name: parsed.data.name, password: parsed.data.password }), "Password set");
  } catch (error) {
    if (error instanceof TxAbort) return err(error.message);
    console.error("[set-password]", error);
    return err("Something went wrong. Please try again.");
  }
}
