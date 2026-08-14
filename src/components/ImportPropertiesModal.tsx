import { useState } from "react";
import { toast } from "sonner";
import { Modal } from "@/components/Modal";
import {
  parsePropertiesCsv,
  downloadCsvTemplate,
  type ParsedPropertyRow,
  type CsvRowError,
} from "@/lib/csv-import";
import { addProperty, findExistingProperty, type PropertyRecord } from "@/lib/properties";
import { currency } from "@/lib/intake-store";

type Step = "pick" | "preview" | "importing";

export function ImportPropertiesModal({
  userId,
  onImported,
  onClose,
}: {
  userId: string;
  onImported: (properties: PropertyRecord[]) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [rows, setRows] = useState<ParsedPropertyRow[]>([]);
  const [parseErrors, setParseErrors] = useState<CsvRowError[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Captured as a plain File reference before any await — e.target.files itself
    // is a live FileList tied to the input and can read back empty once the input
    // is cleared below, same pitfall already hit and fixed for evidence upload in
    // ai-report.tsx.
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file) return;

    setFileError(null);
    const text = await file.text();
    const { rows: parsed, errors } = parsePropertiesCsv(text);
    if (parsed.length === 0 && errors.length > 0 && errors[0].rowNumber === 1) {
      // A row-1 error means the file itself couldn't be read at all (empty, or no
      // address column) rather than individual data rows being wrong — surface it
      // as a single blocking message instead of an empty preview table.
      setFileError(errors[0].reason);
      return;
    }
    setRows(parsed);
    setParseErrors(errors);
    setStep("preview");
  }

  async function onConfirmImport() {
    setStep("importing");
    const imported: PropertyRecord[] = [];
    let duplicateCount = 0;
    let failureCount = 0;

    // Sequential (not Promise.all) so "Importing N of M" progress is meaningful
    // and one failing row can't be blamed on/confused with another — same posture
    // as OwnerMatchModal's addSelected() loop.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setProgress(i + 1);
      try {
        const existing = await findExistingProperty(userId, row);
        const property = await addProperty(userId, row);
        if (existing) duplicateCount++;
        else imported.push(property);
      } catch (err) {
        console.error(err);
        failureCount++;
      }
    }

    const parts = [`Imported ${imported.length} propert${imported.length === 1 ? "y" : "ies"}.`];
    if (duplicateCount > 0) parts.push(`${duplicateCount} already existed.`);
    if (failureCount > 0) parts.push(`${failureCount} failed to save.`);
    if (imported.length > 0) toast.success(parts.join(" "));
    else toast.error(parts.join(" "));

    onImported(imported);
    onClose();
  }

  return (
    <Modal onClose={onClose} wide={step === "preview"}>
      <h3 className="font-serif text-xl font-semibold">Import Properties from CSV</h3>

      {step === "pick" && (
        <div className="mt-4 grid gap-4">
          <p className="text-sm text-muted-foreground">
            Upload a CSV with one property per row. Only <strong>address</strong> is required —
            everything else (CAD, account number, values, tax year) is optional and can be filled in
            later from each property's AI Report.
          </p>
          <button type="button" onClick={downloadCsvTemplate} className="btn-outline text-sm w-fit">
            Download CSV Template
          </button>
          <label className="btn-primary btn-primary-hover w-fit cursor-pointer">
            Choose File
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={onFileChange} />
          </label>
          {fileError && <p className="text-sm text-destructive">{fileError}</p>}
        </div>
      )}

      {step === "preview" && (
        <div className="mt-4 grid gap-4">
          <p className="text-sm text-muted-foreground">
            {rows.length} row{rows.length === 1 ? "" : "s"} ready to import
            {parseErrors.length > 0
              ? `, ${parseErrors.length} row${parseErrors.length === 1 ? "" : "s"} skipped due to errors.`
              : "."}
          </p>

          {rows.length > 0 && (
            <div className="max-h-64 overflow-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-secondary text-left">
                  <tr>
                    <th className="px-3 py-2">Address</th>
                    <th className="px-3 py-2">CAD</th>
                    <th className="px-3 py-2">Total Value</th>
                    <th className="px-3 py-2">Tax Year</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-border">
                      <td className="px-3 py-2">{r.address}</td>
                      <td className="px-3 py-2">{r.cad ?? "—"}</td>
                      <td className="px-3 py-2">
                        {r.totalValue != null ? currency(r.totalValue) : "—"}
                      </td>
                      <td className="px-3 py-2">{r.taxYear ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {parseErrors.length > 0 && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <p className="font-medium">Skipped rows:</p>
              <ul className="mt-1 list-disc pl-5">
                {parseErrors.map((e) => (
                  <li key={e.rowNumber}>
                    Row {e.rowNumber}: {e.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setStep("pick")} className="btn-outline">
              Back
            </button>
            <button
              type="button"
              onClick={onConfirmImport}
              disabled={rows.length === 0}
              className="btn-accent disabled:opacity-60"
            >
              Import {rows.length} Propert{rows.length === 1 ? "y" : "ies"}
            </button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">
            Importing {progress} of {rows.length}…
          </p>
          <div className="mt-2 h-2 w-full rounded-full bg-secondary">
            <div
              className="h-2 rounded-full bg-accent transition-all"
              style={{ width: `${(progress / rows.length) * 100}%` }}
            />
          </div>
        </div>
      )}
    </Modal>
  );
}
