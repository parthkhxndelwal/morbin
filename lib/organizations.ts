import { getDb } from "@/lib/db";
import type { Organization } from "@/lib/types";

export async function getOrgByOwner(ownerId: string): Promise<Organization | null> {
  const db = await getDb();
  return db.collection<Organization>("organizations").findOne({ ownerId });
}
