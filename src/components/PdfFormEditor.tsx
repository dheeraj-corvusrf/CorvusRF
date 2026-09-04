import { useEffect, useState } from "react";
import {
  resolveDateInput,
  mmddyyyyToIso,
  isFormComplete,
  getIncompleteRequiredLabels,
  getFirstIncompleteFieldName,
  type FieldSection,
  type FieldValues,
  type FieldSuggestion,
} from "@/lib/protest-documents";
import type { CountyProtestInfo } from "@/lib/county-protest-info";
import type { ProtestStatus } from "@/lib/protests";
import { Modal } from "@/components/Modal";
import { FilingMethodsList } from "@/components/FilingMethodsList";
import { SignaturePad, type SignatureValue } from "@/components/SignaturePad";

function fieldInputId(name: string): string {
  return `pdf-field-${name.replace(/[^a-zA-Z0-9]+/g, "-")}`;
}

// Generic renderer for either Comptroller form's field schema — both forms
// are just collections of text/checkbox/radio fields grouped into sections,
// so one data-driven component covers both rather than ~90 hand-written rows.
// Also owns the guided File Protest sequence for the Notice of Protest:
// edit → Final Review (explicit "I have reviewed" confirmation) → sign →
// real, county-specific post-sign filing guidance — see isProtestForm below.
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
  isProtestForm,
  countyInfo,
  noticeSignedAt,
  caseStatus,
  onMarkFiled,
  markingFiled,
  hasEvidence,
  generatingReason,
  onGenerateReason,
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
  // The Final Review step + post-sign filing guidance only apply to the
  // real Notice of Protest — the Appointment of Agent form keeps today's
  // simpler review → sign flow (signing it doesn't file anything with a
  // county, so there's no filing-method guidance to show afterward).
  isProtestForm: boolean;
  countyInfo: CountyProtestInfo | null;
  noticeSignedAt: string | null;
  caseStatus: ProtestStatus;
  onMarkFiled: () => void;
  markingFiled: boolean;
  hasEvidence: boolean;
  generatingReason: boolean;
  onGenerateReason: () => void;
}) {
  const complete = isFormComplete(sections, values);
  const missing = complete ? [] : getIncompleteRequiredLabels(sections, values);
  const totalRequired = sections.reduce(
    (n, s) =>
      n +
      s.fields.filter((f) => f.type !== "checkbox" && f.required).length +
      (s.requireAtLeastOne ? 1 : 0),
    0,
  );
  const completedRequired = totalRequired - missing.length;

  const [view, setView] = useState<"edit" | "review" | "signed">("edit");
  const [reviewed, setReviewed] = useState(false);

  // Reacts to a REAL sign completing (noticeSignedAt going from null to a
  // real timestamp) — also fires on mount if the case was already signed
  // in an earlier session, so reopening File Protest on an already-signed
  // case goes straight to the real filing guidance instead of back through
  // edit/review. Never fires for the Appointment of Agent form.
  useEffect(() => {
    if (isProtestForm && noticeSignedAt) setView("signed");
  }, [isProtestForm, noticeSignedAt]);

  function jumpToNextRequiredField() {
    const name = getFirstIncompleteFieldName(sections, values);
    if (!name) return;
    const el = document.getElementById(fieldInputId(name));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLElement | null)?.focus();
  }

  return (
    <Modal onClose={onClose} wide>
      <h3 className="font-serif text-xl font-semibold">{title}</h3>

      {view === "signed" && isProtestForm ? (
        <SignedFilingGuidance
          countyInfo={countyInfo}
          caseStatus={caseStatus}
          onMarkFiled={onMarkFiled}
          markingFiled={markingFiled}
          onDownload={onDownload}
          downloading={downloading}
          onMakeChanges={() => setView("edit")}
        />
      ) : view === "review" ? (
        <>
          <p className="text-xs text-muted-foreground">
            Please review all information before signing and submitting your protest.
          </p>
          <div className="mt-4 rounded-lg border border-accent/30 bg-accent/5 p-4">
            <h4 className="text-sm font-semibold">Ready to File</h4>
            <div className="mt-3 grid gap-5">
              {sections.map((section) => (
                <FieldSectionView
                  key={section.title}
                  section={section}
                  values={values}
                  onChange={onChange}
                  readOnly
                />
              ))}
            </div>
            <label className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-sm">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
                className="mt-0.5"
              />
              I have reviewed the completed form and confirm the information is accurate.
            </label>
          </div>

          {allowSigning && signingOpen && (
            <SignPanel
              expectedSignerName={expectedSignerName}
              signature={signature}
              onSignatureChange={onSignatureChange}
              onCancelSigning={onCancelSigning}
              onConfirmSign={onConfirmSign}
              submitting={submitting}
            />
          )}

          {!signingOpen && (
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button onClick={onClose} className="btn-outline text-sm">
                Close
              </button>
              <button onClick={() => setView("edit")} className="btn-outline text-sm">
                Go Back &amp; Edit
              </button>
              {allowSigning && (
                <button
                  onClick={onOpenSigning}
                  disabled={!reviewed}
                  title={!reviewed ? "Check the confirmation box above first" : undefined}
                  className="btn-accent text-sm disabled:opacity-60"
                >
                  Sign &amp; Continue
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Pre-filled from this case. Review or edit any field below, then save your progress,
            download, or continue. Fields marked <span className="text-destructive">*</span> are
            required.
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {completedRequired} of {totalRequired} required fields complete
            </span>
            {!complete && (
              <button
                type="button"
                onClick={jumpToNextRequiredField}
                className="text-accent hover:underline"
              >
                Jump to next required field →
              </button>
            )}
          </div>

          <div className="mt-4 grid gap-5">
            {sections.map((section) => (
              <FieldSectionView
                key={section.title}
                section={section}
                values={values}
                onChange={onChange}
                hasEvidence={hasEvidence}
                generatingReason={generatingReason}
                onGenerateReason={onGenerateReason}
              />
            ))}
          </div>

          {!complete && (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              Complete these required fields before you can download or continue:{" "}
              {missing.join(", ")}.
            </div>
          )}

          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <button onClick={onClose} className="btn-outline text-sm">
              Close
            </button>
            <button
              onClick={onSaveProgress}
              disabled={saving}
              className="btn-outline text-sm disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save Progress"}
            </button>
            <button
              onClick={onDownload}
              disabled={downloading || !complete}
              title={!complete ? "Complete all required fields (marked *) first" : undefined}
              className="btn-outline text-sm disabled:opacity-60"
            >
              {downloading ? "Generating…" : "Download PDF"}
            </button>
            {allowSigning && (
              <button
                onClick={() => setView("review")}
                disabled={!complete}
                title={!complete ? "Complete all required fields (marked *) first" : undefined}
                className="btn-accent text-sm disabled:opacity-60"
              >
                Continue to Sign
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}

function SignPanel({
  expectedSignerName,
  signature,
  onSignatureChange,
  onCancelSigning,
  onConfirmSign,
  submitting,
}: {
  expectedSignerName?: string;
  signature: SignatureValue | null;
  onSignatureChange: (v: SignatureValue | null) => void;
  onCancelSigning: () => void;
  onConfirmSign: () => void;
  submitting: boolean;
}) {
  return (
    <div className="mt-5 rounded-lg border border-accent/40 bg-accent/5 p-4">
      <h4 className="text-sm font-semibold">Sign this document</h4>
      <p className="mt-1 text-xs text-muted-foreground">
        Signing saves this exact document as your case record and downloads a copy. There's no
        county-wide e-filing system — delivering the signed PDF to your appraisal district is still
        on you.
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
  );
}

// Shown once the Notice of Protest is actually signed — real, county-
// specific instructions for whichever filing methods this county actually
// confirms (never a fabricated "direct integration": no county publishes a
// public submission API, so every path here ends in the customer's own
// real action). Reuses the exact same FilingMethodsList data as
// CaseDetailModal.tsx's own "How to actually file this" block.
function SignedFilingGuidance({
  countyInfo,
  caseStatus,
  onMarkFiled,
  markingFiled,
  onDownload,
  downloading,
  onMakeChanges,
}: {
  countyInfo: CountyProtestInfo | null;
  caseStatus: ProtestStatus;
  onMarkFiled: () => void;
  markingFiled: boolean;
  onDownload: () => void;
  downloading: boolean;
  onMakeChanges: () => void;
}) {
  const mailto = countyInfo?.filingMethod.email.available ? buildFilingMailto(countyInfo) : null;

  return (
    <div className="mt-4 grid gap-4">
      <div className="rounded-lg border border-success/30 bg-success/5 p-4">
        <h4 className="text-sm font-semibold text-success">Signed — now deliver it</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Your Notice of Protest is signed and saved. It is not yet filed with{" "}
          {countyInfo?.cad ?? "your county"} — delivering it is the one step left, and only you can
          confirm you've done it.
        </p>
      </div>

      {countyInfo ? (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="font-medium">Real ways to file with {countyInfo.cad}</p>
          <div className="mt-2 text-xs text-muted-foreground">
            <FilingMethodsList countyInfo={countyInfo} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {countyInfo.filingMethod.online && (
              <a
                href={countyInfo.filingMethod.online.url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-accent text-xs py-1.5"
              >
                File Online at {countyInfo.cad} →
              </a>
            )}
            {mailto && (
              <a href={mailto} className="btn-outline text-xs py-1.5">
                Draft Email
              </a>
            )}
          </div>
          {countyInfo.filingMethod.mail && (
            <p className="mt-2 text-xs text-muted-foreground">
              Mailing? Recommended: Certified Mail with Return Receipt Requested (one of Form
              50-132's own options) — keep the receipt as your proof of timely mailing.
            </p>
          )}
          {countyInfo.filingMethod.inPerson && (
            <p className="mt-1 text-xs text-muted-foreground">
              Filing in person? Bring the signed form and a photo ID, and ask for a stamped/dated
              copy as your receipt.
            </p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          We don't have this county's confirmed filing methods on file yet — check your appraisal
          district's website directly for the current address or any online option.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onDownload}
          disabled={downloading}
          className="btn-outline text-xs py-1.5 disabled:opacity-60"
        >
          {downloading ? "Generating…" : "Download Completed Protest"}
        </button>
        {caseStatus === "requested" && (
          <button
            onClick={onMarkFiled}
            disabled={markingFiled}
            className="btn-accent text-xs py-1.5 disabled:opacity-60"
          >
            {markingFiled ? "Saving…" : "I've delivered this — Mark as Filed"}
          </button>
        )}
        <button onClick={onMakeChanges} className="text-xs text-accent hover:underline">
          Make changes &amp; re-sign
        </button>
      </div>
    </div>
  );
}

// mailto: can't attach a file — the body says so explicitly rather than
// implying the PDF travels with the draft.
function buildFilingMailto(countyInfo: CountyProtestInfo): string {
  const to = countyInfo.filingMethod.email.address ?? "";
  const subject = `Notice of Protest — ${countyInfo.cad}`;
  const body = `Please find my Notice of Protest attached. (Attach your downloaded, signed PDF to this email before sending — it isn't included automatically.)${
    countyInfo.filingMethod.email.notes ? `\n\n${countyInfo.filingMethod.email.notes}` : ""
  }`;
  return `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function FieldSectionView({
  section,
  values,
  onChange,
  readOnly,
  hasEvidence,
  generatingReason,
  onGenerateReason,
}: {
  section: FieldSection;
  values: FieldValues;
  onChange: (name: string, value: string | boolean) => void;
  readOnly?: boolean;
  hasEvidence?: boolean;
  generatingReason?: boolean;
  onGenerateReason?: () => void;
}) {
  return (
    <section>
      <h4 className="text-sm font-semibold border-b border-border pb-1">
        {section.title}
        {section.requireAtLeastOne && <span className="text-destructive"> *</span>}
      </h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {section.fields.map((field) => (
          <div
            key={field.name}
            id={fieldInputId(field.name)}
            className={field.type === "radio" ? "sm:col-span-2" : ""}
          >
            {field.type === "text" && (
              <TextRow
                label={field.label}
                required={field.required}
                value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
                onChange={(v) => onChange(field.name, v)}
                suggestions={field.suggestions?.(values) ?? []}
                dateFormat={field.dateFormat}
                multiline={field.multiline}
                readOnly={readOnly}
                aiSuggestable={field.aiSuggestable}
                hasEvidence={hasEvidence}
                generatingReason={generatingReason}
                onGenerateReason={onGenerateReason}
              />
            )}
            {field.type === "checkbox" && (
              <CheckRow
                label={field.label}
                checked={!!values[field.name]}
                onChange={(v) => onChange(field.name, v)}
                readOnly={readOnly}
              />
            )}
            {field.type === "radio" && (
              <RadioRow
                label={field.label}
                required={field.required}
                options={field.options}
                value={typeof values[field.name] === "string" ? (values[field.name] as string) : ""}
                onChange={(v) => onChange(field.name, v)}
                readOnly={readOnly}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function TextRow({
  label,
  required,
  value,
  onChange,
  suggestions,
  dateFormat,
  multiline,
  readOnly,
  aiSuggestable,
  hasEvidence,
  generatingReason,
  onGenerateReason,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  suggestions: FieldSuggestion[];
  dateFormat?: boolean;
  multiline?: boolean;
  readOnly?: boolean;
  aiSuggestable?: boolean;
  hasEvidence?: boolean;
  generatingReason?: boolean;
  onGenerateReason?: () => void;
}) {
  const inputClass =
    "w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm disabled:opacity-70";
  return (
    <div className="grid gap-1 text-xs">
      {/* Suggestion chips are a sibling of the <label>, not nested inside it
          — a <button> nested inside a <label> gets folded into the input's
          accessible name (e.g. "Date" + "Today" becomes "Date Today"),
          breaking screen readers and any getByLabel-style lookup. */}
      <label className="grid gap-1">
        <span className="font-medium text-muted-foreground">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </span>
        {dateFormat ? (
          // A real calendar picker, not free text — the only way to get a
          // date into this field is to pick a real one (or a suggestion
          // chip below), so there's no wrong-format/typo/ambiguous-date
          // entry to correct in the first place. The stored value is still
          // MM/DD/YYYY (what the real PDF and every other date field here
          // use); native <input type="date"> just requires ISO for its own
          // value/onChange, so this converts at the boundary.
          <input
            type="date"
            disabled={readOnly}
            value={mmddyyyyToIso(value)}
            onChange={(e) => onChange(e.target.value ? resolveDateInput(e.target.value) : "")}
            className={inputClass}
          />
        ) : multiline ? (
          <textarea
            disabled={readOnly}
            rows={4}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          />
        ) : (
          <input
            disabled={readOnly}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={inputClass}
          />
        )}
      </label>
      {aiSuggestable && !readOnly && (
        <div>
          <button
            type="button"
            onClick={onGenerateReason}
            disabled={!hasEvidence || generatingReason}
            title={!hasEvidence ? "Upload evidence in the Evidence Checklist first" : undefined}
            className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {generatingReason
              ? "Reading your evidence…"
              : "✦ Generate Suggested Reason from Your Evidence"}
          </button>
          {!hasEvidence && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Upload your evidence in the Evidence Checklist for a stronger, AI-suggested reason.
            </p>
          )}
          {value && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              If this was AI-suggested, it's Corvus's draft from your evidence — review and edit it
              before signing.
            </p>
          )}
        </div>
      )}
      {/* Real, computed options (today's date, a phone already on file
          elsewhere in this form) — a shortcut to a valid answer, never a
          constraint. Clicking one fills the field; typing over it afterward
          works exactly the same as if it'd never been suggested. */}
      {!readOnly && suggestions.length > 0 && (
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
  readOnly,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  readOnly?: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>{label}</span>
    </label>
  );
}

function RadioRow({
  label,
  required,
  options,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  required?: boolean;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="grid gap-1 text-xs">
      <span className="font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <div className="grid gap-1 pl-1 text-sm">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="radio"
            checked={value === ""}
            disabled={readOnly}
            onChange={() => onChange("")}
          />
          (none selected)
        </label>
        {options.map((opt) => (
          <label key={opt} className="flex items-start gap-2">
            <input
              type="radio"
              checked={value === opt}
              disabled={readOnly}
              onChange={() => onChange(opt)}
              className="mt-0.5"
            />
            <span>{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
