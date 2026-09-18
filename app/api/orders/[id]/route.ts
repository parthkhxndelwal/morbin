import { ObjectId } from "mongodb";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Order } from "@/lib/types";

function oid(id: string): ObjectId | null {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
}

/** Order status polling for checkout completion UI. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const _id = oid(id);
  if (!_id) return NextResponse.json({ error: "Invalid order" }, { status: 400 });
  const db = await getDb();
  const order = await db.collection<Order>("orders").findOne({ _id });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    status: order.status,
    totalPaise: order.totalPaise,
    eventId: order.eventId,
  });
}
