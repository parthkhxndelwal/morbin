"use server";

import { revalidatePath } from "next/cache";
import { datasetActor } from "@/lib/action-guards";
import {
  createDataset,
  DatasetError,
  deleteDataset,
  deleteRow,
  inspectCsv,
  renameDataset,
  runImport,
  saveRow,
  validateImport,
  type CsvInspection,
  type DatasetActor,
  type ImportReport,
  type ImportResult,
  type ImportSpec,
} from "@/lib/datasets";
import { MAX_CSV_BYTES } from "@/lib/dataset-rules";
import { err, ok, type Result } from "@/lib/result";

/**
 * Dataset actions, shared by the owner pages and Admin → Organisations →
 * Datasets. `supportOrgId` is null for the owner; for a Morbin admin it names
 * the organisation being supported (and is ignored for anyone else). Every
 * call re-authorises.
 */

async function run<T>(
  supportOrgId: string | null,
  fn: (actor: DatasetActor) => Promise<T>,
  message?: string,
): Promise<Result<T>> {
  const guard = await datasetActor(supportOrgId);
  if ("error" in guard) return err(guard.error);
  try {
    const data = await fn(guard.actor);
    revalidatePath("/dashboard", "layout");
    return ok(data, message);
  } catch (error) {
    if (error instanceof DatasetError) return err(error.message, error.field ? { [error.field]: error.message } : undefined);
    console.error("[datasets:action]", error);
    return err("Something went wrong. Please try again.");
  }
}

export async function createDatasetAction(supportOrgId: string | null, formData: FormData): Promise<Result<{ id: string }>> {
  const name = String(formData.get("name") ?? "");
  return run(supportOrgId, async (a) => ({ id: (await createDataset(a, name)).id }), "Dataset created");
}

export async function renameDatasetAction(supportOrgId: string | null, id: string, name: string): Promise<Result> {
  return run(supportOrgId, (a) => renameDataset(a, id, name), "Dataset renamed");
}

export async function deleteDatasetAction(supportOrgId: string | null, id: string): Promise<Result> {
  return run(supportOrgId, (a) => deleteDataset(a, id), "Dataset deleted");
}

export async function saveRowAction(
  supportOrgId: string | null,
  datasetId: string,
  rowId: string | null,
  formData: FormData,
): Promise<Result> {
  const values: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && k.startsWith("col:")) values[k.slice(4)] = v;
  return run(supportOrgId, (a) => saveRow(a, datasetId, rowId, values), rowId ? "Row saved" : "Row added");
}

export async function deleteRowAction(supportOrgId: string | null, datasetId: string, rowId: string): Promise<Result> {
  return run(supportOrgId, (a) => deleteRow(a, datasetId, rowId), "Row deleted");
}

async function fileBytes(formData: FormData): Promise<Uint8Array | string> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return "Choose a CSV file.";
  if (file.size > MAX_CSV_BYTES) return "The file must be 5 MB or smaller.";
  return new Uint8Array(await file.arrayBuffer());
}

function specFrom(formData: FormData): ImportSpec | null {
  try {
    const spec = JSON.parse(String(formData.get("spec") ?? "")) as ImportSpec;
    if (!spec || !Array.isArray(spec.columns) || typeof spec.keyIndex !== "number") return null;
    return spec;
  } catch {
    return null;
  }
}

/** Step 1: headers, the first rows, and a suggested mapping. Nothing written. */
export async function inspectCsvAction(
  supportOrgId: string | null,
  datasetId: string,
  formData: FormData,
): Promise<Result<CsvInspection>> {
  const bytes = await fileBytes(formData);
  if (typeof bytes === "string") return err(bytes, { file: bytes });
  return run(supportOrgId, (a) => inspectCsv(a.orgId, datasetId, bytes));
}

/** Step 2: the validation report and counts for a mapping. Nothing written. */
export async function validateImportAction(
  supportOrgId: string | null,
  datasetId: string,
  formData: FormData,
): Promise<Result<ImportReport>> {
  const bytes = await fileBytes(formData);
  if (typeof bytes === "string") return err(bytes, { file: bytes });
  const spec = specFrom(formData);
  if (!spec) return err("The mapping is out of date. Start the import again.");
  return run(supportOrgId, (a) => validateImport(a.orgId, datasetId, bytes, spec));
}

/** Step 3: write it. */
export async function runImportAction(
  supportOrgId: string | null,
  datasetId: string,
  formData: FormData,
): Promise<Result<ImportResult>> {
  const bytes = await fileBytes(formData);
  if (typeof bytes === "string") return err(bytes, { file: bytes });
  const spec = specFrom(formData);
  if (!spec) return err("The mapping is out of date. Start the import again.");
  return run(supportOrgId, (a) => runImport(a, datasetId, bytes, spec));
}
