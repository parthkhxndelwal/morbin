"use client";

import { AlertTriangleIcon, CheckCircle2Icon, FileUpIcon, KeyRoundIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DatasetColumnType, ImportMode } from "@/lib/dataset-rules";
import type { CsvInspection, ImportReport, ImportResult, ImportSpec } from "@/lib/datasets";
import type { Result } from "@/lib/result";
import { inspectCsvAction, runImportAction, validateImportAction } from "./actions";

type Step = "file" | "map" | "report" | "done";

const MAX_BYTES = 5 * 1024 * 1024;
const n = (v: number) => v.toLocaleString("en-IN");

/**
 * Import a CSV into a dataset in three server round trips, each re-sending the
 * file (nothing is kept between steps): inspect → map and validate → import.
 * The server re-validates on the final step, so the report the person saw is
 * exactly what gets written.
 */
export function ImportDialog({
  datasetId,
  supportOrgId,
  hasColumns,
  trigger,
}: {
  datasetId: string;
  supportOrgId: string | null;
  hasColumns: boolean;
  trigger?: React.ReactElement;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<CsvInspection | null>(null);
  const [spec, setSpec] = useState<ImportSpec | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setStep("file");
    setFile(null);
    setInspection(null);
    setSpec(null);
    setReport(null);
    setResult(null);
    setError(null);
  }

  function formData(withSpec: boolean): FormData {
    const fd = new FormData();
    fd.set("file", file!);
    if (withSpec) fd.set("spec", JSON.stringify(spec));
    return fd;
  }

  function call<T>(fn: () => Promise<Result<T>>, then: (data: T) => void) {
    setError(null);
    startTransition(async () => {
      let r: Result<T>;
      try {
        r = await fn();
      } catch {
        r = { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
      }
      if (r.ok) then(r.data);
      else setError(r.error);
    });
  }

  function inspect() {
    if (!file) return setError("Choose a CSV file.");
    if (file.size > MAX_BYTES) return setError("The file must be 5 MB or smaller.");
    call(
      () => inspectCsvAction(supportOrgId, datasetId, formData(false)),
      (data) => {
        setInspection(data);
        setSpec(data.suggested);
        setStep("map");
      },
    );
  }

  function validate() {
    call(
      () => validateImportAction(supportOrgId, datasetId, formData(true)),
      (data) => {
        setReport(data);
        setStep("report");
      },
    );
  }

  function commit() {
    call(
      () => runImportAction(supportOrgId, datasetId, formData(true)),
      (data) => {
        setResult(data);
        setStep("done");
        if (data.failure) toast.error("The import stopped part-way");
        else toast.success(`Imported ${n(data.written)} rows`);
        router.refresh();
      },
    );
  }

  function patchColumn(index: number, patch: Partial<ImportSpec["columns"][number]>) {
    setSpec((s) => s && { ...s, columns: s.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          trigger ?? (
            <Button>
              <FileUpIcon data-icon="inline-start" />
              Import CSV
            </Button>
          )
        }
      />
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import a CSV</DialogTitle>
          <DialogDescription>
            {step === "file" && "UTF-8, comma or semicolon separated, up to 5 MB. The first row must be the column names."}
            {step === "map" && inspection && `${n(inspection.totalRows)} rows found. Check the columns, then check the file.`}
            {step === "report" && "Nothing has been written yet. Review what will happen."}
            {step === "done" && "Import finished."}
          </DialogDescription>
        </DialogHeader>

        {step === "file" && (
          <Field data-invalid={!!error || undefined}>
            <FieldLabel htmlFor="dataset-file">CSV file</FieldLabel>
            <Input
              id="dataset-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                setFile(e.currentTarget.files?.[0] ?? null);
                setError(null);
              }}
            />
            <FieldDescription>In Excel or Google Sheets, use “Download / Save as → CSV (UTF-8)”.</FieldDescription>
          </Field>
        )}

        {step === "map" && inspection && spec && (
          <MappingStep
            inspection={inspection}
            spec={spec}
            hasColumns={hasColumns}
            onColumn={patchColumn}
            onKey={(keyIndex) => setSpec({ ...spec, keyIndex })}
            onMode={(mode) => setSpec({ ...spec, mode })}
          />
        )}

        {step === "report" && report && spec && <ReportView report={report} mode={spec.mode} />}

        {step === "done" && result && (
          <div className="space-y-3">
            {result.failure ? (
              <Alert variant="destructive">
                <AlertTriangleIcon />
                <AlertTitle>The import stopped part-way</AlertTitle>
                <AlertDescription>{result.failure}</AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <CheckCircle2Icon />
                <AlertTitle>Imported {n(result.written)} rows</AlertTitle>
                <AlertDescription>
                  {n(result.plan.added)} added, {n(result.plan.updated)} updated
                  {result.removed ? `, ${n(result.removed)} removed` : ""}
                  {result.rejected ? `, ${n(result.rejected)} skipped because of problems` : ""}.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter>
          {step === "file" && (
            <Button onClick={inspect} disabled={pending || !file}>
              {pending && <Spinner data-icon="inline-start" />}
              Preview
            </Button>
          )}
          {step === "map" && (
            <>
              <Button variant="outline" onClick={reset} disabled={pending}>
                Choose another file
              </Button>
              <Button onClick={validate} disabled={pending}>
                {pending && <Spinner data-icon="inline-start" />}
                Check file
              </Button>
            </>
          )}
          {step === "report" && report && (
            <>
              <Button variant="outline" onClick={() => setStep("map")} disabled={pending}>
                Back
              </Button>
              <Button onClick={commit} disabled={pending || report.overLimit || report.totalRows === report.rejected}>
                {pending && <Spinner data-icon="inline-start" />}
                Import {n(report.totalRows - report.rejected)} rows
              </Button>
            </>
          )}
          {step === "done" && <Button onClick={() => setOpen(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MappingStep({
  inspection,
  spec,
  hasColumns,
  onColumn,
  onKey,
  onMode,
}: {
  inspection: CsvInspection;
  spec: ImportSpec;
  hasColumns: boolean;
  onColumn: (index: number, patch: Partial<ImportSpec["columns"][number]>) => void;
  onKey: (index: number) => void;
  onMode: (mode: ImportMode) => void;
}) {
  const { headers, preview } = inspection;
  return (
    <div className="min-w-0 space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-medium">First {preview.length} rows</h3>
        <div className="max-h-56 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-0 text-muted-foreground">#</TableHead>
                {headers.map((h, i) => (
                  <TableHead key={i}>{h || `Column ${i + 1}`}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.map((row, r) => (
                <TableRow key={r}>
                  <TableCell className="text-muted-foreground tabular-nums">{r + 2}</TableCell>
                  {headers.map((_, i) => (
                    <TableCell key={i} className="max-w-48 truncate">
                      {row[i] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Columns</h3>
        <p className="text-xs text-muted-foreground">
          {hasColumns
            ? "Match each dataset column to a column in the file, or skip it. Skipped columns keep their current values."
            : "Rename columns, set their type, skip the ones you don't need, and pick the key — the value that identifies a row, such as a roll number."}
        </p>
        <div className="space-y-2">
          {spec.columns.map((c, i) => {
            const isKey = spec.keyIndex === i;
            const skipped = c.source === null;
            return (
              <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,1fr)_auto] sm:items-center">
                <Input
                  aria-label="Column name"
                  value={c.label}
                  maxLength={80}
                  disabled={skipped && c.key === null}
                  onChange={(e) => onColumn(i, { label: e.currentTarget.value })}
                />
                <NativeSelect
                  aria-label="Type"
                  className="w-full"
                  value={c.type}
                  disabled={skipped && c.key === null}
                  onChange={(e) => onColumn(i, { type: e.currentTarget.value as DatasetColumnType })}
                >
                  <NativeSelectOption value="text">Text</NativeSelectOption>
                  <NativeSelectOption value="email">Email</NativeSelectOption>
                  <NativeSelectOption value="number">Number</NativeSelectOption>
                </NativeSelect>
                <NativeSelect
                  aria-label="From file column"
                  className="w-full"
                  value={c.source === null ? "" : String(c.source)}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    onColumn(i, { source: v === "" ? null : Number(v) });
                  }}
                >
                  <NativeSelectOption value="">{c.key === null ? "Skip this column" : "Skip (keep current values)"}</NativeSelectOption>
                  {headers.map((h, hi) => (
                    <NativeSelectOption key={hi} value={String(hi)}>
                      From “{h || `Column ${hi + 1}`}”
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                {isKey ? (
                  <Badge variant="secondary" className="justify-self-start">
                    <KeyRoundIcon data-icon="inline-start" />
                    Key
                  </Badge>
                ) : hasColumns ? (
                  <span />
                ) : (
                  <Button variant="ghost" size="sm" className="justify-self-start" disabled={skipped} onClick={() => onKey(i)}>
                    Make key
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        {spec.columns[spec.keyIndex]?.source === null && (
          <FieldError>The key column must come from the file.</FieldError>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Import mode</h3>
        <RadioGroup value={spec.mode} onValueChange={(v) => onMode(v as ImportMode)} className="grid gap-2 sm:grid-cols-2">
          <FieldLabel htmlFor="mode-upsert">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Add and update by key</FieldTitle>
                <FieldDescription>New keys are added; existing keys get the file’s values. Nothing is removed.</FieldDescription>
              </FieldContent>
              <RadioGroupItem value="UPSERT" id="mode-upsert" />
            </Field>
          </FieldLabel>
          <FieldLabel htmlFor="mode-replace">
            <Field orientation="horizontal">
              <FieldContent>
                <FieldTitle>Replace everything</FieldTitle>
                <FieldDescription>The dataset ends up holding exactly the file’s rows.</FieldDescription>
              </FieldContent>
              <RadioGroupItem value="REPLACE" id="mode-replace" />
            </Field>
          </FieldLabel>
        </RadioGroup>
      </section>
    </div>
  );
}

function ReportView({ report, mode }: { report: ImportReport; mode: ImportMode }) {
  const valid = report.totalRows - report.rejected;
  return (
    <div className="min-w-0 space-y-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Rows in file" value={report.totalRows} />
        <Stat label="Will be added" value={report.plan.added} />
        <Stat label="Will be updated" value={report.plan.updated} />
        {mode === "REPLACE" ? (
          <Stat label="Will be removed" value={report.plan.removed} warn={report.plan.removed > 0} />
        ) : (
          <Stat label="Rows afterwards" value={report.plan.resultingRows} />
        )}
      </dl>
      {report.overLimit && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Too many rows</AlertTitle>
          <AlertDescription>
            This would leave {n(report.plan.resultingRows)} rows. A dataset can hold up to 2,00,000.
          </AlertDescription>
        </Alert>
      )}
      {report.rejected > 0 ? (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>
            {n(report.rejected)} row{report.rejected === 1 ? "" : "s"} will be skipped
          </AlertTitle>
          <AlertDescription>
            {[
              report.emptyKeys && `${n(report.emptyKeys)} with an empty key`,
              report.duplicateKeys && `${n(report.duplicateKeys)} repeating an earlier key`,
              report.badValues && `${n(report.badValues)} with a value that doesn’t fit its column`,
            ]
              .filter(Boolean)
              .join(", ")}
            . The other {n(valid)} rows can be imported; fix the file and import again to add the rest.
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-sm text-muted-foreground">No problems found.</p>
      )}
      {report.problems.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-0">Line</TableHead>
                <TableHead>Column</TableHead>
                <TableHead>Problem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.problems.map((p, i) => (
                <TableRow key={i}>
                  <TableCell className="tabular-nums">{p.line}</TableCell>
                  <TableCell>{p.column}</TableCell>
                  <TableCell>{p.problem}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${warn ? "text-destructive" : ""}`}>{n(value)}</dd>
    </div>
  );
}
