"use server";

import { revalidatePath } from "next/cache";
import { AdminError, requireAdmin } from "@/lib/admin";
import { completeDataRequest, fulfilAccessRequest, fulfilErasureRequest, PrivacyError, rejectDataRequest } from "@/lib/privacy";
import { err, ok, type Result } from "@/lib/result";

async function run<T>(fn: (adminId: string) => Promise<T>, message: string): Promise<Result<T>> {
  let adminId: string;
  try {
    adminId = (await requireAdmin()).id;
  } catch (error) {
    return err(error instanceof AdminError ? error.message : "Forbidden");
  }
  try {
    const data = await fn(adminId);
    revalidatePath("/dashboard/admin", "layout");
    return ok(data, message);
  } catch (error) {
    if (error instanceof PrivacyError) return err(error.message);
    console.error("[privacy:action]", error);
    return err("Something went wrong. Please try again.");
  }
}

export async function fulfilAccessAction(id: string, note: string): Promise<Result> {
  return run((a) => fulfilAccessRequest(id, a, note.trim().slice(0, 1000)), "Export sent to the requester");
}

export async function fulfilErasureAction(id: string, note: string): Promise<Result> {
  return run(async (a) => void (await fulfilErasureRequest(id, a, note.trim().slice(0, 1000))), "Personal data erased");
}

export async function completeDataRequestAction(id: string, outcome: string): Promise<Result> {
  return run((a) => completeDataRequest(id, a, outcome.slice(0, 2000)), "Marked done and the requester told");
}

export async function rejectDataRequestAction(id: string, reason: string): Promise<Result> {
  return run((a) => rejectDataRequest(id, a, reason.slice(0, 2000)), "Request declined");
}
