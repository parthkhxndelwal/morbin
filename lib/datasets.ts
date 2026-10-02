import "server-only";

import { ObjectId, type AnyBulkWriteOperation } from "mongodb";
import { audit } from "@/lib/audit";
import { getDb, toObjectId } from "@/lib/db";
import {
  cellProblem,
  columnKey,
  decodeUtf8,
  keyPrefixRegex,
  MAX_COLUMNS,
  MAX_CSV_BYTES,
  MAX_DATASETS_PER_ORG,
  MAX_ROWS_PER_DATASET,
  normaliseKey,
  parseCsv,
  planImport,
  PREVIEW_ROWS,
  suggestColumns,
  suggestSources,
  validateRows,
  type ColumnMapping,
  type DatasetColumn,
  type DatasetColumnType,
  type ImportMode,
  type ImportPlan,
  type RowProblem,
} from "@/lib/dataset-rules";
import { recordSupportChange } from "@/lib/support";
import type { Dataset, DatasetRow } from "@/lib/types";

/**
 * Organisation datasets: reusable lists (roll numbers, staff) that booking
 * questions validate answers against. Read-only to checkout — bookings never
 * write back here.
 *
 * Every function takes the organisation id from an already-authorised actor
 * and scopes every query by it, so a dataset id from another organisation
 * simply isn't found. Audit entries carry counts and column names, never cell
 * values: rows are personal data.
 */

export class DatasetError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export interface DatasetActor {
  userId: string;
  orgId: string;
  /** SUPPORT = a Morbin admin acting for the organisation; the owner is notified. */
  role: "OWNER" | "SUPPORT";
}

/* ── DTOs ─────────────────────────────────────────────────────────────── */

export interface DatasetSummary {
  id: string;
  name: string;
  columns: DatasetColumn[];
  keyColumn: string | null;
  rowCount: number;
  updatedAt: string;
}

export interface DatasetRowView {
  id: string;
  values: Record<string, string>;
  updatedAt: string;
}

export interface RowsPage {
  rows: DatasetRowView[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
  query: string;
}

const PAGE_SIZE = 50;

function toSummary(d: Dataset): DatasetSummary {
  return {
    id: d._id!.toString(),
    name: d.name,
    columns: d.columns,
    keyColumn: d.keyColumn,
    rowCount: d.rowCount,
    updatedAt: d.updatedAt.toISOString(),
  };
}

/* ── Reading ──────────────────────────────────────────────────────────── */

export async function listDatasets(orgId: string): Promise<DatasetSummary[]> {
  const db = await getDb();
  const docs = await db.collection<Dataset>("datasets").find({ organizationId: orgId }).sort({ name: 1 }).toArray();
  return docs.map(toSummary);
}

async function findDataset(orgId: string, id: string): Promise<Dataset & { _id: ObjectId }> {
  const _id = toObjectId(id);
  if (!_id) throw new DatasetError("Dataset not found.");
  const db = await getDb();
  const d = await db.collection<Dataset>("datasets").findOne({ _id, organizationId: orgId });
  if (!d) throw new DatasetError("Dataset not found.");
  return d as Dataset & { _id: ObjectId };
}

export async function getDataset(orgId: string, id: string): Promise<DatasetSummary | null> {
  try {
    return toSummary(await findDataset(orgId, id));
  } catch (error) {
    if (error instanceof DatasetError) return null;
    throw error;
  }
}

/** One page of rows, optionally filtered by a key prefix. Server-side: never all rows. */
export async function listRows(orgId: string, datasetId: string, opts: { q?: string; page?: number }): Promise<RowsPage> {
  const dataset = await findDataset(orgId, datasetId);
  const db = await getDb();
  const query = (opts.q ?? "").slice(0, 100);
  const prefix = keyPrefixRegex(query);
  const filter = { datasetId: dataset._id.toString(), ...(prefix ? { keyNormalised: prefix } : {}) };
  const total = await db.collection<DatasetRow>("datasetRows").countDocuments(filter);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), pageCount);
  const rows = await db
    .collection<DatasetRow>("datasetRows")
    .find(filter)
    .sort({ keyNormalised: 1 })
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();
  return {
    rows: rows.map((r) => ({ id: r._id!.toString(), values: r.values, updatedAt: r.updatedAt.toISOString() })),
    total,
    page,
    pageCount,
    pageSize: PAGE_SIZE,
    query,
  };
}

/**
 * Booking questions that reference a dataset, as "event title" strings. A
 * dataset in use can't be deleted. Lookup questions (the next phase) store
 * `datasetId` on flow steps; until then this finds nothing.
 */
export async function datasetReferences(orgId: string, datasetId: string): Promise<string[]> {
  const db = await getDb();
  const flows = await db
    .collection<{ eventId: string }>("checkoutFlows")
    .find({ "steps.datasetId": datasetId, status: { $in: ["DRAFT", "PUBLISHED"] } }, { projection: { eventId: 1 } })
    .toArray();
  if (flows.length === 0) return [];
  const ids = [...new Set(flows.map((f) => f.eventId))].map((id) => toObjectId(id)).filter((x): x is ObjectId => !!x);
  const events = await db
    .collection<{ title: string }>("events")
    .find({ _id: { $in: ids }, organizationId: orgId }, { projection: { title: 1 } })
    .toArray();
  return events.map((e) => e.title);
}

/* ── Recording ────────────────────────────────────────────────────────── */

async function record(
  actor: DatasetActor,
  dataset: { id: string; name: string },
  action: string,
  summary: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  if (actor.role === "SUPPORT") {
    await recordSupportChange({
      adminId: actor.userId,
      organizationId: actor.orgId,
      action,
      summary,
      meta,
      target: {
        type: "dataset",
        id: dataset.id,
        link: `/dashboard/datasets/${dataset.id}`,
        title: `Morbin support updated the dataset “${dataset.name}”`,
      },
    });
    return;
  }
  await audit({
    actorId: actor.userId,
    actorRole: "OWNER",
    action,
    targetType: "dataset",
    targetId: dataset.id,
    organizationId: actor.orgId,
    meta,
  });
}

async function refreshRowCount(datasetId: ObjectId): Promise<number> {
  const db = await getDb();
  const rowCount = await db.collection<DatasetRow>("datasetRows").countDocuments({ datasetId: datasetId.toString() });
  await db.collection<Dataset>("datasets").updateOne({ _id: datasetId }, { $set: { rowCount, updatedAt: new Date() } });
  return rowCount;
}

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n.length < 2) throw new DatasetError("Give the dataset a name (at least 2 characters).", "name");
  if (n.length > 80) throw new DatasetError("Keep the name under 80 characters.", "name");
  return n;
}

/* ── Datasets ─────────────────────────────────────────────────────────── */

export async function createDataset(actor: DatasetActor, name: string): Promise<DatasetSummary> {
  const db = await getDb();
  const count = await db.collection<Dataset>("datasets").countDocuments({ organizationId: actor.orgId });
  if (count >= MAX_DATASETS_PER_ORG) {
    throw new DatasetError(`An organisation can have up to ${MAX_DATASETS_PER_ORG} datasets. Delete one you no longer need.`);
  }
  const now = new Date();
  const doc: Dataset = {
    organizationId: actor.orgId,
    name: cleanName(name),
    columns: [],
    keyColumn: null,
    rowCount: 0,
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now,
  };
  const { insertedId } = await db.collection<Dataset>("datasets").insertOne(doc);
  const summary = toSummary({ ...doc, _id: insertedId });
  await record(actor, summary, "dataset.created", `Created the dataset “${summary.name}”.`);
  return summary;
}

export async function renameDataset(actor: DatasetActor, id: string, name: string): Promise<void> {
  const dataset = await findDataset(actor.orgId, id);
  const next = cleanName(name);
  const db = await getDb();
  await db.collection<Dataset>("datasets").updateOne({ _id: dataset._id }, { $set: { name: next, updatedAt: new Date() } });
  await record(actor, { id, name: next }, "dataset.renamed", `Renamed the dataset “${dataset.name}” to “${next}”.`);
}

export async function deleteDataset(actor: DatasetActor, id: string): Promise<void> {
  const dataset = await findDataset(actor.orgId, id);
  const usedBy = await datasetReferences(actor.orgId, id);
  if (usedBy.length > 0) {
    throw new DatasetError(`Booking questions use this dataset (${usedBy.slice(0, 3).join(", ")}). Remove them first.`);
  }
  const db = await getDb();
  const { deletedCount } = await db.collection<DatasetRow>("datasetRows").deleteMany({ datasetId: id, organizationId: actor.orgId });
  await db.collection<Dataset>("datasets").deleteOne({ _id: dataset._id });
  await record(actor, { id, name: dataset.name }, "dataset.deleted", `Deleted the dataset “${dataset.name}”.`, {
    rows: deletedCount,
  });
}

/* ── Rows ─────────────────────────────────────────────────────────────── */

/** Add (rowId null) or edit one row. Values are keyed by column key. */
export async function saveRow(
  actor: DatasetActor,
  datasetId: string,
  rowId: string | null,
  input: Record<string, string>,
): Promise<void> {
  const dataset = await findDataset(actor.orgId, datasetId);
  if (!dataset.keyColumn) throw new DatasetError("Import a CSV first to set up this dataset's columns.");
  const values: Record<string, string> = {};
  for (const column of dataset.columns) {
    const value = (input[column.key] ?? "").trim();
    const problem = cellProblem(column.type, value);
    if (problem) throw new DatasetError(`${column.label} is ${problem}.`, column.key);
    values[column.key] = value;
  }
  const keyNormalised = normaliseKey(values[dataset.keyColumn]);
  if (!keyNormalised) {
    const label = dataset.columns.find((c) => c.key === dataset.keyColumn)?.label ?? "The key";
    throw new DatasetError(`${label} can't be empty.`, dataset.keyColumn);
  }
  const db = await getDb();
  const rows = db.collection<DatasetRow>("datasetRows");
  const now = new Date();
  try {
    if (rowId) {
      const _id = toObjectId(rowId);
      const r = _id
        ? await rows.updateOne(
            { _id, datasetId, organizationId: actor.orgId },
            { $set: { values, keyNormalised, updatedAt: now } },
          )
        : { matchedCount: 0 };
      if (r.matchedCount === 0) throw new DatasetError("That row no longer exists.");
    } else {
      if (dataset.rowCount >= MAX_ROWS_PER_DATASET) {
        throw new DatasetError(`A dataset can hold up to ${MAX_ROWS_PER_DATASET.toLocaleString("en-IN")} rows.`);
      }
      await rows.insertOne({
        datasetId,
        organizationId: actor.orgId,
        values,
        keyNormalised,
        importId: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  } catch (error) {
    if ((error as { code?: number }).code === 11000) {
      throw new DatasetError("Another row already has this key.", dataset.keyColumn);
    }
    throw error;
  }
  await refreshRowCount(dataset._id);
  await record(
    actor,
    { id: datasetId, name: dataset.name },
    rowId ? "dataset.row_updated" : "dataset.row_added",
    rowId ? `Edited a row in “${dataset.name}”.` : `Added a row to “${dataset.name}”.`,
  );
}

export async function deleteRow(actor: DatasetActor, datasetId: string, rowId: string): Promise<void> {
  const dataset = await findDataset(actor.orgId, datasetId);
  const _id = toObjectId(rowId);
  const db = await getDb();
  const r = _id
    ? await db.collection<DatasetRow>("datasetRows").deleteOne({ _id, datasetId, organizationId: actor.orgId })
    : { deletedCount: 0 };
  if (r.deletedCount === 0) throw new DatasetError("That row no longer exists.");
  await refreshRowCount(dataset._id);
  await record(actor, { id: datasetId, name: dataset.name }, "dataset.row_deleted", `Deleted a row from “${dataset.name}”.`);
}

/* ── CSV import ───────────────────────────────────────────────────────── */

function readCsv(bytes: Uint8Array): string[][] {
  if (bytes.byteLength === 0) throw new DatasetError("The file is empty.", "file");
  if (bytes.byteLength > MAX_CSV_BYTES) throw new DatasetError("The file must be 5 MB or smaller.", "file");
  const text = decodeUtf8(bytes);
  if (text === null) {
    throw new DatasetError("The file isn't UTF-8 text. In Excel, save it as “CSV UTF-8 (comma delimited)”.", "file");
  }
  let rows: string[][];
  try {
    rows = parseCsv(text);
  } catch (error) {
    throw new DatasetError(error instanceof Error ? error.message : "The file couldn't be read as CSV.", "file");
  }
  if (rows.length < 2) throw new DatasetError("The file needs a header row and at least one data row.", "file");
  if (rows[0].length > MAX_COLUMNS) throw new DatasetError(`The file has more than ${MAX_COLUMNS} columns.`, "file");
  return rows;
}

/** One proposed column in the mapping step. `key` null = a new column. */
export interface ImportColumnSpec {
  key: string | null;
  label: string;
  type: DatasetColumnType;
  /** CSV header index, or null to skip. */
  source: number | null;
}

export interface ImportSpec {
  mode: ImportMode;
  columns: ImportColumnSpec[];
  /** Index into `columns` of the key column. */
  keyIndex: number;
}

export interface CsvInspection {
  headers: string[];
  preview: string[][];
  totalRows: number;
  /** A starting mapping: existing columns matched to headers, or one new column per header. */
  suggested: ImportSpec;
}

export async function inspectCsv(orgId: string, datasetId: string, bytes: Uint8Array): Promise<CsvInspection> {
  const dataset = await findDataset(orgId, datasetId);
  const rows = readCsv(bytes);
  const headers = rows[0].map((h) => h.trim());
  let suggested: ImportSpec;
  if (dataset.columns.length === 0) {
    suggested = {
      mode: "UPSERT",
      columns: suggestColumns(headers).map((c, i) => ({ key: null, label: c.label, type: c.type, source: i })),
      keyIndex: 0,
    };
  } else {
    const sources = suggestSources(dataset.columns, headers);
    suggested = {
      mode: "UPSERT",
      columns: dataset.columns.map((c, i) => ({ key: c.key, label: c.label, type: c.type, source: sources[i] })),
      keyIndex: Math.max(0, dataset.columns.findIndex((c) => c.key === dataset.keyColumn)),
    };
  }
  return { headers, preview: rows.slice(1, 1 + PREVIEW_ROWS), totalRows: rows.length - 1, suggested };
}

/** Turn a client spec into dataset columns + mapping, enforcing the rules the UI also shows. */
function resolveSpec(dataset: Dataset, spec: ImportSpec, headerCount: number) {
  if (spec.mode !== "UPSERT" && spec.mode !== "REPLACE") throw new DatasetError("Choose an import mode.");
  const existing = new Map(dataset.columns.map((c) => [c.key, c]));
  const kept = spec.columns.filter((c) => c.key !== null || c.source !== null);
  if (kept.length === 0) throw new DatasetError("Map at least one column.");
  if (kept.length > MAX_COLUMNS) throw new DatasetError(`A dataset can have up to ${MAX_COLUMNS} columns.`);
  const keySpec = spec.columns[spec.keyIndex];
  if (!keySpec || keySpec.source === null) throw new DatasetError("Choose which file column is the key.", "keyIndex");
  if (dataset.keyColumn && keySpec.key !== dataset.keyColumn) {
    throw new DatasetError("The key column of an existing dataset can't change.", "keyIndex");
  }
  // Every existing column stays (an import never drops data columns).
  for (const key of existing.keys()) {
    if (!spec.columns.some((c) => c.key === key)) throw new DatasetError("The mapping is out of date. Start the import again.");
  }
  const taken = new Set(existing.keys());
  const labels = new Set<string>();
  const mapping: ColumnMapping[] = [];
  let keyColumn = dataset.keyColumn;
  for (const c of kept) {
    const label = c.label.trim().replace(/\s+/g, " ").slice(0, 80);
    if (!label) throw new DatasetError("Every column needs a name.");
    if (labels.has(label.toLowerCase())) throw new DatasetError(`Two columns are called “${label}”.`);
    labels.add(label.toLowerCase());
    if (!["text", "email", "number"].includes(c.type)) throw new DatasetError("Unknown column type.");
    if (c.source !== null && (!Number.isInteger(c.source) || c.source < 0 || c.source >= headerCount)) {
      throw new DatasetError("The mapping is out of date. Start the import again.");
    }
    let key: string;
    if (c.key !== null) {
      if (!existing.has(c.key)) throw new DatasetError("The mapping is out of date. Start the import again.");
      key = c.key;
    } else {
      key = columnKey(label, taken);
      taken.add(key);
    }
    if (c === keySpec) keyColumn = key;
    mapping.push({ column: { key, label, type: c.type }, source: c.source });
  }
  return { columns: mapping.map((m) => m.column), mapping, keyColumn: keyColumn! };
}

export interface ImportReport {
  totalRows: number;
  rejected: number;
  emptyKeys: number;
  duplicateKeys: number;
  badValues: number;
  problems: RowProblem[];
  plan: ImportPlan;
  /** Set when the result would exceed the row limit; the import is refused. */
  overLimit: boolean;
}

async function existingKeys(datasetId: string): Promise<Set<string>> {
  const db = await getDb();
  const keys = new Set<string>();
  const cursor = db
    .collection<DatasetRow>("datasetRows")
    .find({ datasetId }, { projection: { keyNormalised: 1, _id: 0 } });
  for await (const r of cursor) keys.add(r.keyNormalised);
  return keys;
}

async function analyse(orgId: string, datasetId: string, bytes: Uint8Array, spec: ImportSpec) {
  const dataset = await findDataset(orgId, datasetId);
  const rows = readCsv(bytes);
  const resolved = resolveSpec(dataset, spec, rows[0].length);
  const validation = validateRows(rows.slice(1), resolved.mapping, resolved.keyColumn);
  const plan = planImport(await existingKeys(datasetId), validation.valid, spec.mode);
  const report: ImportReport = {
    totalRows: validation.totalRows,
    rejected: validation.rejected,
    emptyKeys: validation.emptyKeys,
    duplicateKeys: validation.duplicateKeys,
    badValues: validation.badValues,
    problems: validation.problems,
    plan,
    overLimit: plan.resultingRows > MAX_ROWS_PER_DATASET,
  };
  return { dataset, resolved, validation, report };
}

/** Dry run: the validation report and counts, nothing written. */
export async function validateImport(
  orgId: string,
  datasetId: string,
  bytes: Uint8Array,
  spec: ImportSpec,
): Promise<ImportReport> {
  return (await analyse(orgId, datasetId, bytes, spec)).report;
}

export interface ImportResult extends ImportReport {
  written: number;
  removed: number;
  /** Set when some batches failed; rows in earlier batches were written. */
  failure: string | null;
}

const BATCH = 1000;

/**
 * Write an import. Rejected rows are skipped. Rows are written in batches of
 * upserts keyed by the normalised key (so re-importing never duplicates); a
 * REPLACE import then removes rows the file didn't contain — only if every
 * batch succeeded, so a failure never leaves the dataset half-emptied.
 */
export async function runImport(
  actor: DatasetActor,
  datasetId: string,
  bytes: Uint8Array,
  spec: ImportSpec,
): Promise<ImportResult> {
  const { dataset, resolved, validation, report } = await analyse(actor.orgId, datasetId, bytes, spec);
  if (report.overLimit) {
    throw new DatasetError(
      `This import would leave ${report.plan.resultingRows.toLocaleString("en-IN")} rows; a dataset can hold up to ${MAX_ROWS_PER_DATASET.toLocaleString("en-IN")}.`,
    );
  }
  if (validation.valid.length === 0) throw new DatasetError("No valid rows to import.");

  const db = await getDb();
  const now = new Date();
  await db
    .collection<Dataset>("datasets")
    .updateOne({ _id: dataset._id }, { $set: { columns: resolved.columns, keyColumn: resolved.keyColumn, updatedAt: now } });

  const importId = new ObjectId().toString();
  const mapped = resolved.mapping.filter((m) => m.source !== null).map((m) => m.column.key);
  const allKeys = resolved.columns.map((c) => c.key);
  const rows = db.collection<DatasetRow>("datasetRows");
  let written = 0;
  let failure: string | null = null;
  for (let i = 0; i < validation.valid.length; i += BATCH) {
    const ops: AnyBulkWriteOperation<DatasetRow>[] = validation.valid.slice(i, i + BATCH).map((row) => {
      const set: Record<string, unknown> = { importId, updatedAt: now };
      if (spec.mode === "REPLACE") {
        // A replaced row holds exactly what the file says; unmapped columns are blank.
        set.values = Object.fromEntries(allKeys.map((k) => [k, row.values[k] ?? ""]));
      } else {
        for (const k of mapped) set[`values.${k}`] = row.values[k];
      }
      return {
        updateOne: {
          filter: { datasetId, keyNormalised: row.keyNormalised },
          update: {
            $set: set,
            $setOnInsert: {
              datasetId,
              organizationId: actor.orgId,
              keyNormalised: row.keyNormalised,
              createdAt: now,
              ...(spec.mode === "REPLACE"
                ? {}
                : { ...Object.fromEntries(allKeys.filter((k) => !mapped.includes(k)).map((k) => [`values.${k}`, ""])) }),
            },
          },
          upsert: true,
        },
      };
    });
    try {
      await rows.bulkWrite(ops, { ordered: false });
      written += ops.length;
    } catch (error) {
      console.error("[datasets] import batch failed", datasetId, error);
      failure = `Rows from line ${validation.valid[i].line} onwards couldn't be saved. Earlier rows were imported; run the import again to finish.`;
      break;
    }
  }
  let removed = 0;
  if (spec.mode === "REPLACE" && !failure) {
    removed = (await rows.deleteMany({ datasetId, importId: { $ne: importId } })).deletedCount;
  }
  const rowCount = await refreshRowCount(dataset._id);
  await record(
    actor,
    { id: datasetId, name: dataset.name },
    "dataset.imported",
    `Imported ${written.toLocaleString("en-IN")} rows into “${dataset.name}” (${rowCount.toLocaleString("en-IN")} in total).`,
    {
      mode: spec.mode,
      added: report.plan.added,
      updated: report.plan.updated,
      removed,
      rejected: report.rejected,
      written,
      failed: !!failure,
    },
  );
  return { ...report, written, removed, failure };
}

/* ── Export ───────────────────────────────────────────────────────────── */

/** Header and an async row iterator, for a streamed CSV download. Audited by the caller. */
export async function datasetExport(orgId: string, datasetId: string) {
  const dataset = await findDataset(orgId, datasetId);
  const db = await getDb();
  const cursor = db
    .collection<DatasetRow>("datasetRows")
    .find({ datasetId }, { projection: { values: 1 } })
    .sort({ keyNormalised: 1 })
    .batchSize(BATCH);
  return {
    dataset: toSummary(dataset),
    header: dataset.columns.map((c) => c.label),
    rows: (async function* () {
      for await (const r of cursor) yield dataset.columns.map((c) => r.values[c.key] ?? "");
    })(),
  };
}
