import { resolveDateInput, type FieldSection, type FieldValues, type FieldSuggestion } from "@/lib/protest-documents";
import { Modal } from "@/components/Modal";
import { SignaturePad, type SignatureValue } from "@/components/SignaturePad";

// Generic renderer for either Comptroller form's field schema — both forms
// are just collections of text/checkbox/radio fields grouped into sections,
// so one data-driven component covers both rather than ~90 hand-written rows.
export function PdfFormEditor({
  title,
  sections,
  values,
  onChange,
  onDownload,
  downloading,
  onSaveProgress,
  saving,
  allowSigning,
  signingOpen,
  onOpenSigning,
  onCancelSigning,
  signature,
  onSignatureChange,
  onConfirmSign,
  submitting,
  expectedSignerName,
  onClose,
}: {
  title: string;
  sections: FieldSection[];
  values: FieldValues;
  onChange: (name: string, value: string | boolean) => void;
  onDownload: () => void;
  downloading: boolean;
  onSaveProgress: () => void;
  saving: boolean;
  allowSigning: boolean;
  signingOpen: boolean;
  onOpenSigning: () => void;
  onCancelSigning: () => void;
  signature: SignatureValue | null;
  onSignatureChange: (v: SignatureValue | null) => void;
  onConfirmSign: () => void;
  submitting: boolean;
  expectedSignerName?: string;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} wide>
      <h3 className="font-serif text-xl font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">
        Pre-filled from this case. Review or edit any field below, then save your progress, download, or sign and
        submit.
      </p>

      <div className="mt-4 grid gap-5">
        {sections.map((section) => (
          <section key={section.title}>
            <h4 className="text-sm font-semibold border-b border-border pb-1">{section.title}</h4>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {section.fields.map((field) => (
                <div key={field.name} className={field.type === "radio" ? "sm:col-span-2" : ""}>
                  {field.type === "text" && (
                    <TextRow
                      label={field.label}
                      value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
                      onChange={(v) => onChange(field.name, v)}
                      suggestions={field.suggestions?.(values) ?? []}
                      dateFormat={field.dateFormat}
                    />
                  )}
                  {field.type === "checkbox" && (
                    <CheckRow
                      label={field.label}
                      checked={!!values[field.name]}
                      onChange={(v) => onChange(field.name, v)}
                    />
                  )}
                  {field.type === "radio" && (
                    <RadioRow
                      label={field.label}
                      options={field.options}
                      value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
                      onChange={(v) => onChange(field.name, v)}
                    />
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {allowSigning && signingOpen && (
        <div className="mt-5 rounded-lg border border-accent/40 bg-accent/5 p-4">
          <h4 className="text-sm font-semibold">Sign this document</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Signing saves this exact document as your case record and downloads a copy. There's no county-wide
            e-filing system — delivering the signed PDF to your appraisal district is still on you.
          </p>
          <div className="mt-3">
            <SignaturePad expectedName={expectedSignerName} onChange={onSignatureChange} />
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={onCancelSigning} className="btn-outline text-xs py-1.5">
              Cancel
            </button>
            <button
              onClick={onConfirmSign}
              disabled={!signature || submitting}
              className="btn-accent text-xs py-1.5 disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Confirm & Submit"}
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button onClick={onClose} className="btn-outline text-sm">
          Close
        </button>
        <button onClick={onSaveProgress} disabled={saving} className="btn-outline text-sm disabled:opacity-60">
          {saving ? "Saving…" : "Save Progress"}
        </button>
        <button onClick={onDownload} disabled={downloading} className="btn-outline text-sm disabled:opacity-60">
          {downloading ? "Generating…" : "Download PDF"}
        </button>
        {allowSigning && !signingOpen && (
          <button onClick={onOpenSigning} className="btn-accent text-sm">
            Sign &amp; Submit
          </button>
        )}
      </div>
    </Modal>
  );
}

function TextRow({
  label,
  value,
  onChange,
  suggestions,
  dateFormat,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: FieldSuggestion[];
  dateFormat?: boolean;
}) {
  return (
    <div className="grid gap-1 text-xs">
      {/* Suggestion chips are a sibling of the <label>, not nested inside it
          — a <button> nested inside a <label> gets folded into the input's
          accessible name (e.g. "Date" + "Today" becomes "Date Today"),
          breaking screen readers and any getByLabel-style lookup. */}
      <label className="grid gap-1">
        <span className="font-medium text-muted-foreground">{label}</span>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // Corrects on blur, not on every keystroke — typing "30 years" needs
          // to stay readable while you're still typing it; resolveDateInput()
          // only converts it to a real MM/DD/YYYY once you're done. The same
          // normalization runs once more right before signing, in case a
          // field never got blurred (e.g. a suggestion chip was clicked last).
          onBlur={dateFormat ? (e) => onChange(resolveDateInput(e.target.value)) : undefined}
          placeholder={dateFormat ? "MM/DD/YYYY" : undefined}
          className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </label>
      {/* Real, computed options (today's date, a phone already on file
          elsewhere in this form) — a shortcut to a valid answer, never a
          constraint. Clicking one fills the field; typing over it afterward
          works exactly the same as if it'd never been suggested. */}
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => onChange(s.value)}
              className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5" />
      <span>{label}</span>
    </label>
  );
}

function RadioRow({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <div className="grid gap-1 pl-1 text-sm">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="radio" checked={value === ""} onChange={() => onChange("")} />
          (none selected)
        </label>
        {options.map((opt) => (
          <label key={opt} className="flex items-start gap-2">
            <input type="radio" checked={value === opt} onChange={() => onChange(opt)} className="mt-0.5" />
            <span>{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
