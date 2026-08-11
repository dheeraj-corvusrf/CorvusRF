import type { FieldSection, FieldValues } from "@/lib/protest-documents";
import { Modal } from "@/components/Modal";

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
  onClose,
}: {
  title: string;
  sections: FieldSection[];
  values: FieldValues;
  onChange: (name: string, value: string | boolean) => void;
  onDownload: () => void;
  downloading: boolean;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} wide>
      <h3 className="font-serif text-xl font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">
        Pre-filled from this case. Review or edit any field below, then download.
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

      <div className="mt-6 flex justify-end gap-2">
        <button onClick={onClose} className="btn-outline text-sm">
          Close
        </button>
        <button onClick={onDownload} disabled={downloading} className="btn-accent text-sm disabled:opacity-60">
          {downloading ? "Generating…" : "Download PDF"}
        </button>
      </div>
    </Modal>
  );
}

function TextRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1 text-xs">
      <span className="font-medium text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      />
    </label>
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
