/**
 * Checks for the pure dataset rules: key normalisation, CSV parsing, mapping
 * and import validation/planning.
 *
 *   npm run check:datasets
 */
import assert from "node:assert/strict";
import {
  cellProblem,
  columnKey,
  decodeUtf8,
  detectDelimiter,
  keyPrefixRegex,
  normaliseKey,
  parseCsv,
  planImport,
  suggestColumns,
  suggestSources,
  validateRows,
  type ColumnMapping,
} from "./dataset-rules.ts";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

check("keys compare case- and whitespace-insensitively", () => {
  assert.equal(normaliseKey(" 23 013 "), "23013");
  assert.equal(normaliseKey("AB12"), normaliseKey("ab12"));
  assert.equal(normaliseKey("a\tb c"), "abc");
  // Full-width digits (pasted from some spreadsheets) fold to ASCII.
  assert.equal(normaliseKey("２３０１３"), "23013");
  assert.equal(normaliseKey("   "), "");
});

check("CSV: quotes, doubled quotes, embedded newlines, CRLF, BOM, blank lines", () => {
  const csv = '﻿roll,name,note\r\n23013,"Verma, Asha","said ""hi""\nthen left"\r\n\r\n23014,Ravi,\n';
  assert.deepEqual(parseCsv(csv), [
    ["roll", "name", "note"],
    ["23013", "Verma, Asha", 'said "hi"\nthen left'],
    ["23014", "Ravi", ""],
  ]);
  assert.throws(() => parseCsv('a,b\n"open,1\n'), /unterminated/);
});

check("CSV: semicolon files are detected", () => {
  assert.equal(detectDelimiter("roll;name;email\n1;a;b"), ";");
  assert.equal(detectDelimiter('"a;b",c,d\n'), ",");
  assert.deepEqual(parseCsv("roll;name\n1;Asha, V\n"), [["roll", "name"], ["1", "Asha, V"]]);
});

check("UTF-8 only: invalid bytes are refused", () => {
  assert.equal(decodeUtf8(new TextEncoder().encode("आशा")), "आशा");
  assert.equal(decodeUtf8(new Uint8Array([0xff, 0xfe, 0x41])), null);
});

check("column keys are snake_case and unique", () => {
  assert.equal(columnKey("Roll Number"), "roll_number");
  assert.equal(columnKey("E-mail"), "e_mail");
  assert.equal(columnKey("2nd name"), "c_2nd_name");
  assert.equal(columnKey("Name", new Set(["name"])), "name_2");
  assert.deepEqual(
    suggestColumns(["Roll No", "Name", "Email", "Name"]).map((c) => [c.key, c.type]),
    [["roll_no", "text"], ["name", "text"], ["email", "email"], ["name_2", "text"]],
  );
  assert.deepEqual(
    suggestSources(
      [{ key: "roll_number", label: "Roll number", type: "text" }, { key: "email", label: "Email", type: "email" }, { key: "x", label: "X", type: "text" }],
      ["EMAIL", "roll_number"],
    ),
    [1, 0, null],
  );
});

check("cell types: email and number", () => {
  assert.equal(cellProblem("email", "a@b.in"), null);
  assert.match(cellProblem("email", "a@b")!, /email/);
  assert.equal(cellProblem("number", "1,200.5"), null);
  assert.match(cellProblem("number", "12a")!, /number/);
  assert.equal(cellProblem("email", ""), null);
});

const mapping: ColumnMapping[] = [
  { column: { key: "roll", label: "Roll", type: "text" }, source: 0 },
  { column: { key: "name", label: "Name", type: "text" }, source: 1 },
  { column: { key: "email", label: "Email", type: "email" }, source: 2 },
  { column: { key: "batch", label: "Batch", type: "number" }, source: null },
];

check("validation report: empty keys, duplicates, bad emails, with line numbers", () => {
  const r = validateRows(
    [
      ["23013", "Asha", "asha@krmu.edu.in"],
      ["", "Nobody", ""],
      [" 23 013", "Asha again", ""],
      ["23015", "Ravi", "ravi@"],
      ["23016", "Meera", ""],
    ],
    mapping,
    "roll",
  );
  assert.equal(r.totalRows, 5);
  assert.deepEqual(r.valid.map((v) => [v.line, v.keyNormalised]), [[2, "23013"], [6, "23016"]]);
  assert.equal(r.rejected, 3);
  assert.equal(r.emptyKeys, 1);
  assert.equal(r.duplicateKeys, 1);
  assert.equal(r.badValues, 1);
  assert.deepEqual(r.problems.map((p) => [p.line, p.column]), [[3, "Roll"], [4, "Roll"], [5, "Email"]]);
  // Skipped columns are not written.
  assert.ok(!("batch" in r.valid[0].values));
  assert.throws(() => validateRows([], [{ ...mapping[0], source: null }], "roll"), /key column/);
});

check("import plan: add/update by key never duplicates; replace removes the rest", () => {
  const existing = new Set(["1", "2", "3"]);
  const incoming = [{ keyNormalised: "2" }, { keyNormalised: "3" }, { keyNormalised: "4" }];
  assert.deepEqual(planImport(existing, incoming, "UPSERT"), { added: 1, updated: 2, removed: 0, resultingRows: 4 });
  assert.deepEqual(planImport(existing, incoming, "REPLACE"), { added: 1, updated: 2, removed: 1, resultingRows: 3 });
});

check("search is a literal prefix on the normalised key", () => {
  assert.ok(keyPrefixRegex(" 230 ")!.test("23013"));
  assert.ok(!keyPrefixRegex("230")!.test("12301"));
  assert.ok(keyPrefixRegex("a.b")!.test("a.b1"));
  assert.ok(!keyPrefixRegex("a.b")!.test("axb"));
  assert.equal(keyPrefixRegex("   "), null);
});

console.log(`\n${passed} dataset checks passed`);
