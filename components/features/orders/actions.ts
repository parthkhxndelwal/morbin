"use server";

import { revalidatePath } from "next/cache";
import { orgActor } from "@/lib/action-guards";
import { getOrderDetail, type OrderDetail } from "@/lib/order-detail";
import type { RefundSpeed } from "@/lib/pricing";
import { quoteRefund, requestRefund, type RefundQuote } from "@/lib/refunds";
import { err, ok, type Result } from "@/lib/result";
import { TxAbort } from "@/lib/tx";

/** Order details for the side panel. Any member may view. */
export async function getOrderDetailAction(orderId: string): Promise<Result<OrderDetail>> {
  const guard = await orgActor("view", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  const detail = await getOrderDetail(orderId, guard.actor.orgId);
  return detail ? ok(detail) : err("Order not found.");
}

export interface RefundSelection {
  orderId: string;
  ticketIds: string[];
  speed: RefundSpeed;
  settledBy: "MORBIN" | "ORGANISATION";
}

/** Live preview of what a refund request would cost. Owner only. */
export async function quoteRefundAction(sel: RefundSelection): Promise<Result<RefundQuote>> {
  const guard = await orgActor("refund", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  try {
    return ok(await quoteRefund({ organizationId: guard.actor.orgId, ...sel }));
  } catch (error) {
    if (error instanceof TxAbort) return err(error.message);
    console.error("[orders:quote]", error);
    return err("Couldn't work out the refund. Try again.");
  }
}

/** Raise a refund request for Morbin to approve. Owner only. */
export async function requestRefundAction(sel: RefundSelection, reason: string): Promise<Result> {
  const guard = await orgActor("refund", { allowSuspended: true });
  if ("error" in guard) return err(guard.error);
  if (reason.trim().length < 5) return err("Give a reason (at least 5 characters).");
  try {
    await requestRefund({
      organizationId: guard.actor.orgId,
      ...sel,
      reason: reason.trim().slice(0, 500),
      requestedBy: guard.actor.userId,
    });
    revalidatePath("/dashboard", "layout");
    return ok(undefined, "Refund requested — Morbin will review it shortly");
  } catch (error) {
    if (error instanceof TxAbort) return err(error.message);
    console.error("[orders:refund]", error);
    return err("Couldn't request the refund. Try again.");
  }
}
