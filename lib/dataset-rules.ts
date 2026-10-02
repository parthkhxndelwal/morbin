/**
 * The pure rules for organisation datasets — key normalisation, CSV parsing,
 * column mapping and import validation — with no database or `@/` imports, so
 * `lib/dataset-rules.check.mts` runs them under plain Node and the import
 * preview, the import itself and (later) checkout lookups all agree.
 *
 * Keys are compared case- and whitespace-insensitively: " 23 013 " and
 * "23013" are the same roll number, as are "AB12" and "ab12". The normalised
 * form is what the unique index on `datasetRows` holds; the value as typed is
 * kept for display.
 */

export type DatasetColumnType = "text" | "email" | "number";

export interface DatasetColumn {
  key: string;
  label: string;
  type: DatasetColumnType;
}

export const MAX_DATASETS_PER_ORG = 50;
export const MAX_ROWS_PER_DATASET = 200_000;
export const MAX_COLUMNS = 30;
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CELL_LENGTH = 500;
export const PREVIEW_ROWS = 20;
/** Problems listed in a validation report; the counts are always complete. */
export const MAX_REPORTED_PROBLEMS = 200;

/** Compare-form of a key: Unicode-normalised, no whitespace at all, lower case. */
export function normaliseKey(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

/** "Roll Number" → "roll_number"; stable, unique within a dataset. */
export function columnKey(label: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    label
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "column";
  const start = /^[a-z]/.test(base) ? base : `c_${base}`;
  let key = start;
  for (let i = 2; taken.has(key); i++) key = `${start}_${i}`;
  return key;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUMBER_RE = /^-?\d+(\.\d+)?$/;

/** Why a cell value doesn't fit its column type, or null if it does. Empty is allowed. */
export function cellProblem(type: DatasetColumnType, value: string): string | null {
  if (value === "") return null;
  if (value.length > MAX_CELL_LENGTH) return `longer than ${MAX_CELL_LENGTH} characters`;
  if (type === "email" && !EMAIL_RE.test(value)) return "not a valid email address";
  if (type === "number" && !NUMBER_RE.test(value.replace(/,/g, ""))) return "not a number";
  return null;
}

/** Comma or semicolon, whichever appears more often outside quotes in the first line. */
export function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

/**
 * RFC 4180 CSV: quoted fields, doubled quotes, newlines inside quotes, CRLF or
 * LF, optional UTF-8 BOM. Blank lines are dropped. Throws on an unterminated
 * quote rather than guessing.
 */
export function parseCsv(input: string, delimiter: "," | ";" = detectDelimiter(input.replace(/^﻿/, ""))): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0].trim() !== "") rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        field += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (ch === "\n") endRow();
    else field += ch;
    i++;
  }
  if (quoted) throw new Error("The file has an unterminated quoted field.");
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Decode upload bytes as UTF-8 (BOM optional); null if they aren't valid UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * How CSV headers feed dataset columns. `source` is the CSV header index;
 * columns without a source (skipped) are left empty on new rows and untouched
 * on updated ones.
 */
export interface ColumnMapping {
  column: DatasetColumn;
  source: number | null;
}

/** First-import mapping: one column per CSV header, typed by a guess, the first as key. */
export function suggestColumns(headers: readonly string[]): DatasetColumn[] {
  const taken = new Set<string>();
  return headers.map((h, i) => {
    const label = h.trim() || `Column ${i + 1}`;
    const key = columnKey(label, taken);
    taken.add(key);
    const type: DatasetColumnType = /e-?mail/i.test(label) ? "email" : "text";
    return { key, label: label.slice(0, 80), type };
  });
}

/** Match existing dataset columns to CSV headers by label or key, case-insensitively. */
export function suggestSources(columns: readonly DatasetColumn[], headers: readonly string[]): (number | null)[] {
  const norm = headers.map((h) => normaliseKey(h).replace(/_/g, ""));
  return columns.map((c) => {
    const i = norm.findIndex((h) => h === normaliseKey(c.label).replace(/_/g, "") || h === c.key.replace(/_/g, ""));
    return i === -1 ? null : i;
  });
}

export type ImportMode = "UPSERT" | "REPLACE";

export interface RowProblem {
  /** 1-based line in the file, counting the header as line 1. */
  line: number;
  column: string;
  problem: string;
}

export interface ValidatedRow {
  line: number;
  key: string;
  keyNormalised: string;
  values: Record<string, string>;
}

export interface ValidationReport {
  totalRows: number;
  valid: ValidatedRow[];
  rejected: number;
  emptyKeys: number;
  duplicateKeys: number;
  badValues: number;
  /** The first MAX_REPORTED_PROBLEMS problems, in file order. */
  problems: RowProblem[];
}

/**
 * Validate data rows (no header) against a mapping. A row is rejected for an
 * empty key, a key already seen earlier in the file, or a value that doesn't
 * fit its column type; rejected rows are never written.
 */
export function validateRows(
  dataRows: readonly (readonly string[])[],
  mapping: readonly ColumnMapping[],
  keyColumn: string,
): ValidationReport {
  const keyMap = mapping.find((m) => m.column.key === keyColumn);
  if (!keyMap || keyMap.source === null) throw new Error("The key column must come from the file.");
  const seen = new Set<string>();
  const report: ValidationReport = {
    totalRows: dataRows.length,
    valid: [],
    rejected: 0,
    emptyKeys: 0,
    duplicateKeys: 0,
    badValues: 0,
    problems: [],
  };
  const flag = (p: RowProblem) => {
    if (report.problems.length < MAX_REPORTED_PROBLEMS) report.problems.push(p);
  };
  dataRows.forEach((cells, index) => {
    const line = index + 2;
    const values: Record<string, string> = {};
    let bad = false;
    for (const m of mapping) {
      if (m.source === null) continue;
      const value = (cells[m.source] ?? "").trim();
      const problem = cellProblem(m.column.type, value);
      if (problem) {
        bad = true;
        flag({ line, column: m.column.label, problem });
      }
      values[m.column.key] = value;
    }
    const key = values[keyColumn] ?? "";
    const keyNormalised = normaliseKey(key);
    if (!keyNormalised) {
      report.emptyKeys++;
      report.rejected++;
      flag({ line, column: keyMap.column.label, problem: "empty key" });
      return;
    }
    if (seen.has(keyNormalised)) {
      report.duplicateKeys++;
      report.rejected++;
      flag({ line, column: keyMap.column.label, problem: `duplicate key "${key}"` });
      return;
    }
    seen.add(keyNormalised);
    if (bad) {
      report.badValues++;
      report.rejected++;
      return;
    }
    report.valid.push({ line, key, keyNormalised, values });
  });
  return report;
}

export interface ImportPlan {
  added: number;
  updated: number;
  /** Existing rows a REPLACE import removes (their keys aren't in the file). */
  removed: number;
  resultingRows: number;
}

/** What an import will do, given the keys already in the dataset. */
export function planImport(
  existingKeys: ReadonlySet<string>,
  incoming: readonly Pick<ValidatedRow, "keyNormalised">[],
  mode: ImportMode,
): ImportPlan {
  let updated = 0;
  const incomingKeys = new Set<string>();
  for (const row of incoming) {
    incomingKeys.add(row.keyNormalised);
    if (existingKeys.has(row.keyNormalised)) updated++;
  }
  const added = incoming.length - updated;
  let removed = 0;
  if (mode === "REPLACE") for (const k of existingKeys) if (!incomingKeys.has(k)) removed++;
  return { added, updated, removed, resultingRows: existingKeys.size + added - removed };
}

/** Literal-prefix regex for a search box, matching normalised keys. */
export function keyPrefixRegex(query: string): RegExp | null {
  const n = normaliseKey(query);
  if (!n) return null;
  return new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
}
