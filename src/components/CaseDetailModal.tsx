import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { toast } from "sonner";
import type { PropertyRecord } from "@/lib/properties";
import { acknowledgeGuidance, type ProtestRecord } from "@/lib/protests";
import { currency } from "@/lib/intake-store";
import {
  getCase,
  generateCasePrep,
  linkEvidenceDocument,
  markFiled,
  recordSettlementOffer,
  acceptSettlement,
  scheduleHearing,
  getHearingPrep,
  recordArbDecision,
  recordEscalation,
  closeCase,
  getCaseResults,
  type ProtestCase,
} from "@/lib/protest-case";
import { getCaseGuidance } from "@/lib/case-guidance";
import { getCountyProtestInfo } from "@/lib/county-protest-info";
import { uploadDocument } from "@/lib/documents";
import { getAuthorization, type AuthorizationRecord } from "@/lib/protest-authorizations";
import {
  getNoticeOfProtestDefaults,
  getAppointmentOfAgentDefaults,
  getAdditionalOwnerPropertyFields,
  buildPdf,
  signPdf,
  downloadPdf,
  resolveDateFields,
  NOTICE_OF_PROTEST_SCHEMA,
  APPOINTMENT_OF_AGENT_SCHEMA,
  type FieldValues,
} from "@/lib/protest-documents";
import {
  getSubmission,
  saveDraft,
  signAndSubmit,
  type FormType,
} from "@/lib/protest-form-submissions";
import { searchPropertiesByOwner } from "@/lib/cad-owner-search";
import { PdfFormEditor } from "@/components/PdfFormEditor";
import { Modal } from "@/components/Modal";
import { Skeleton } from "@/components/ui/skeleton";
import type { SignatureValue } from "@/components/SignaturePad";

export function CaseDetailModal({
  userId,
  property,
  protest,
  onClose,
}: {
  userId: string;
  property: PropertyRecord;
  protest: ProtestRecord;
  onClose: () => void;
}) {
  const [caseData, setCaseData] = useState<ProtestCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [current, setCurrent] = useState<ProtestRecord>(protest);
  const [acknowledging, setAcknowledging] = useState(false);
  // Per-open, not per-case: the notice must appear every time the customer
  // clicks View Case, not just the first time — deliberately not derived
  // from corvusGuidanceAckAt below, since that would only show it once ever.
  const [acknowledgedThisOpen, setAcknowledgedThisOpen] = useState(false);

  function load() {
    setLoading(true);
    getCase(protest.id)
      .then(setCaseData)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load this case."))
      .finally(() => setLoading(false));
  }

  useEffect(load, [protest.id]);

  async function handleAcknowledgeGuidance() {
    setAcknowledging(true);
    try {
      // Still recorded on the case every time, for an audit trail of when the
      // notice was shown/accepted — it just no longer gates whether the
      // notice is shown again on the next open (see acknowledgedThisOpen).
      await acknowledgeGuidance(protest.id);
      setCurrent((prev) => ({ ...prev, corvusGuidanceAckAt: new Date().toISOString() }));
      setAcknowledgedThisOpen(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not continue — please try again.");
    } finally {
      setAcknowledging(false);
    }
  }

  // Gates entry into a not-yet-filed case until the customer acknowledges
  // Corvus's guidance notice for THIS open of the case — shown every time
  // View Case is clicked on a not-yet-filed case, not just the first time.
  const needsGuidanceAck = current.status === "requested" && !acknowledgedThisOpen;

  return (
    <Modal onClose={onClose} wide>
      <h3 className="font-serif text-xl font-semibold">Case: {property.address}</h3>
      <p className="text-xs text-muted-foreground">
        AI-generated from your property's official CAD record.
      </p>

      {loading ? (
        <div className="mt-4 grid gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : needsGuidanceAck ? (
        <CorvusGuidanceGate
          onAcknowledge={handleAcknowledgeGuidance}
          acknowledging={acknowledging}
        />
      ) : (
        <>
          <CorvusGuidancePanel property={property} protest={current} caseData={caseData} />

          <CasePlanSection
            userId={userId}
            property={property}
            protestId={protest.id}
            caseData={caseData}
            onReload={load}
          />

          <DocumentsSection
            userId={userId}
            protest={current}
            property={property}
            strategyRecommendation={caseData?.strategyRecommendation ?? null}
            onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
          />

          <CaseProgress
            protest={current}
            property={property}
            caseData={caseData}
            onUpdate={(patch) => setCurrent((prev) => ({ ...prev, ...patch }))}
          />
        </>
      )}

      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="btn-outline text-sm">
          Close
        </button>
      </div>
    </Modal>
  );
}

// Consent screen gating entry into a not-yet-filed case, shown on every open
// (not just the first) per explicit product direction — exact copy per the
// spec this was built from. An acknowledgment, not a legal document, so a
// checkbox + button is enough (no signature capture, unlike the real Service
// Agreement in ProtestAuthorizationFlow.tsx).
function CorvusGuidanceGate({
  onAcknowledge,
  acknowledging,
}: {
  onAcknowledge: () => void;
  acknowledging: boolean;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <div className="mt-4 grid gap-4">
      <div className="card-elev p-4">
        <h4 className="text-sm font-semibold">AI Guidance & Filing Notice</h4>
        <div className="mt-2 grid gap-2 text-sm text-muted-foreground">
          <p>
            Corvus is an AI assistant designed to guide you through the property protest process and
            help prepare and complete the required forms and documents.
          </p>
          <p>
            By proceeding, you authorize Corvus to assist with completing forms and preparing filing
            materials on your behalf.
          </p>
          <p>
            You are responsible for reviewing and verifying all information before signing, filing,
            or submitting any document.
          </p>
          <p>
            Corvus does not replace your responsibility to verify the accuracy of the information or
            comply with county requirements.
          </p>
        </div>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-0.5"
        />
        I have read and understand this notice.
      </label>
      <button
        onClick={onAcknowledge}
        disabled={!checked || acknowledging}
        className="btn-accent w-fit text-sm disabled:opacity-60"
      >
        {acknowledging ? "Continuing…" : "Continue to Case"}
      </button>
    </div>
  );
}

// Ambient, ongoing guidance — purely additive, sits above the existing
// sections on every visit once the notice above has been acknowledged for
// this open. Every fact it shows comes from getCaseGuidance()'s
// deterministic mapping of real case/property/county data — never
// AI-generated. No checkbox, no gating: informational only, and nothing
// below it is disabled or hidden by its presence.
function CorvusGuidancePanel({
  property,
  protest,
  caseData,
}: {
  property: PropertyRecord;
  protest: ProtestRecord;
  caseData: ProtestCase | null;
}) {
  const [countyOpen, setCountyOpen] = useState(false);
  const countyInfo = getCountyProtestInfo(property.cad);
  const guidance = getCaseGuidance(property, protest, caseData?.evidenceItems, countyInfo);

  function goTo(anchor: string) {
    if (anchor.startsWith("http")) {
      window.open(anchor, "_blank", "noopener,noreferrer");
      return;
    }
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="mt-4 card-elev p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Corvus Guidance
        </span>
        <span className="badge-soft">{guidance.stageLabel}</span>
      </div>
      <p className="mt-2 text-sm">{guidance.summary}</p>

      {guidance.nextSteps.length > 0 && (
        <div className="mt-3 grid gap-2">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What to do next
          </h5>
          <ul className="grid gap-1.5">
            {guidance.nextSteps.map((step, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{step.label}</span>
                {step.detail && <span className="text-muted-foreground"> — {step.detail}</span>}
                {step.action && (
                  <button
                    onClick={() => goTo(step.action!.anchor)}
                    className="ml-2 text-xs text-accent hover:underline"
                  >
                    {step.action.label} →
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {countyInfo && (
        <div className="mt-3 border-t border-border pt-3">
          <button
            onClick={() => setCountyOpen((v) => !v)}
            className="text-xs font-semibold text-accent hover:underline"
          >
            {countyOpen ? "Hide" : "Show"} your county's protest process
          </button>
          {countyOpen && (
            <div className="mt-2 grid gap-2 text-xs text-muted-foreground">
              <div>
                <span className="font-medium text-foreground">Filing method: </span>
                {countyInfo.filingMethod.portalUrl ? (
                  <a
                    href={countyInfo.filingMethod.portalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    {countyInfo.filingMethod.portalUrl}
                  </a>
                ) : (
                  (countyInfo.filingMethod.address ?? "Not on file yet.")
                )}
                {countyInfo.filingMethod.notes && <span> — {countyInfo.filingMethod.notes}</span>}
              </div>
              {countyInfo.arbContact &&
                (countyInfo.arbContact.phone || countyInfo.arbContact.email) && (
                  <div>
                    <span className="font-medium text-foreground">ARB contact: </span>
                    {[countyInfo.arbContact.phone, countyInfo.arbContact.email]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              {countyInfo.informalReview && (
                <div>
                  <span className="font-medium text-foreground">Informal review: </span>
                  {countyInfo.informalReview.howToRequest}
                </div>
              )}
              <div className="pt-1">
                Source:{" "}
                <a
                  href={countyInfo.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                >
                  {countyInfo.cad}
                </a>{" "}
                (verified {countyInfo.verifiedAt})
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Real Texas Comptroller forms (Form 50-132, Form 50-162 — see
// src/lib/protest-documents.ts), pre-filled from data already on this case.
// Neither is auto-signed; both need review + a real signature before filing.
// Strategy + Evidence Checklist + "Generate Case Plan" — shared by the customer
// modal (CaseDetailModal, above) and the staff modal (AdminCaseProgressModal),
// same reuse pattern as DocumentsSection/CaseProgress below. `userId` must be the
// case-owning CUSTOMER's id even when this renders inside the admin panel — both
// generateCasePrep()'s protest_evidence_items insert and uploadDocument()'s row/
// storage-path use it directly, and the customer's own RLS policies (unaffected by
// this component's admin-added INSERT/UPDATE policies) key off that same value.
export function CasePlanSection({
  userId,
  property,
  protestId,
  caseData,
  onReload,
}: {
  userId: string;
  property: PropertyRecord;
  protestId: string;
  caseData: ProtestCase | null;
  onReload: () => void;
}) {
  const [generating, setGenerating] = useState(false);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateCasePrep(protestId, userId, property);
      onReload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate the case plan.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleUpload(itemId: string, e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    setUploadingItemId(itemId);
    try {
      // Sequential, not Promise.all — several checklist items genuinely need
      // multiple files (e.g. 3 years of income statements), and uploading them
      // one at a time keeps storage writes and the resulting toast/error in a
      // predictable order rather than racing.
      for (const file of files) {
        const doc = await uploadDocument(userId, property.id, file, "Protest Evidence");
        await linkEvidenceDocument(itemId, doc.id);
      }
      onReload();
      toast.success(files.length === 1 ? "Evidence uploaded." : `${files.length} files uploaded.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload this file.");
    } finally {
      setUploadingItemId(null);
    }
  }

  const hasAnyPlan =
    !!caseData && (!!caseData.strategyRecommendation || caseData.evidenceItems.length > 0);
  const uploadedCount = caseData?.evidenceItems.filter((i) => i.documents.length > 0).length ?? 0;
  const totalCount = caseData?.evidenceItems.length ?? 0;

  if (!hasAnyPlan) {
    return (
      <div className="mt-4 grid gap-3">
        <p className="text-sm text-muted-foreground">No case plan yet.</p>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="btn-accent w-fit text-sm disabled:opacity-60"
        >
          {generating ? "Generating…" : "Generate Case Plan"}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 grid gap-5">
      <section>
        <h4 className="text-sm font-semibold">Strategy</h4>
        {caseData?.strategyRecommendation ? (
          <div className="mt-1">
            <span className="badge-soft">{caseData.strategyRecommendation}</span>
            {caseData.strategyConfidencePct != null && (
              <span className="ml-2 text-xs text-muted-foreground">
                {caseData.strategyConfidencePct}% confidence
              </span>
            )}
            {caseData.strategyRationale && (
              <p className="mt-1.5 text-sm text-muted-foreground">{caseData.strategyRationale}</p>
            )}
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Not available yet.</span>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="text-xs text-accent hover:underline disabled:opacity-60"
            >
              {generating ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}
      </section>

      <section id="case-evidence-checklist">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Evidence Checklist</h4>
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground">
              {uploadedCount} of {totalCount} uploaded
            </span>
          )}
        </div>
        {totalCount > 0 ? (
          <div className="mt-2 grid gap-2">
            {caseData!.evidenceItems.map((item, i) => (
              <div
                key={item.id}
                className="min-w-0 grid gap-1.5 rounded-md border border-border p-2.5 text-sm list-item-enter transition-colors hover:bg-secondary/30"
                style={{ animationDelay: `${Math.min(i * 50, 400)}ms` }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <label
                    className={`shrink-0 btn-outline text-xs py-1 cursor-pointer ${
                      uploadingItemId === item.id ? "opacity-60 pointer-events-none" : ""
                    }`}
                  >
                    {uploadingItemId === item.id
                      ? "Uploading…"
                      : item.documents.length > 0
                        ? "Add another file"
                        : "Upload"}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      accept=".pdf,image/*"
                      onChange={(e) => handleUpload(item.id, e)}
                    />
                  </label>
                </div>
                {item.documents.length > 0 && (
                  <ul className="grid gap-0.5">
                    {item.documents.map((doc) => (
                      <li key={doc.id} className="truncate text-xs text-success">
                        ✓ {doc.fileName}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Not available yet.</span>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="text-xs text-accent hover:underline disabled:opacity-60"
            >
              {generating ? "Retrying…" : "Retry"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export function DocumentsSection({
  userId,
  protest,
  property,
  strategyRecommendation,
  onUpdate,
  // Staff must never sign a legal filing on a customer's behalf — the admin
  // panel's copy of this section (AdminCaseProgressModal) passes false to
  // hide signing entirely, keeping Save Progress/Download available for
  // staff to help prep the form without ever touching the signature step.
  allowSigning = true,
}: {
  userId: string;
  protest: ProtestRecord;
  property: PropertyRecord;
  strategyRecommendation: string | null;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
  allowSigning?: boolean;
}) {
  const [authorization, setAuthorization] = useState<AuthorizationRecord | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [editingForm, setEditingForm] = useState<"protest" | "agent" | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOpen, setSigningOpen] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getAuthorization(protest.id)
      .then(setAuthorization)
      .catch((err) => console.error(err))
      .finally(() => setAuthLoading(false));
  }, [protest.id]);

  const formType: FormType | null =
    editingForm === "protest"
      ? "notice_of_protest"
      : editingForm === "agent"
        ? "appointment_of_agent"
        : null;
  const templatePath = editingForm === "protest" ? "forms/50-132.pdf" : "forms/50-162.pdf";
  const schema = editingForm === "protest" ? NOTICE_OF_PROTEST_SCHEMA : APPOINTMENT_OF_AGENT_SCHEMA;

  // Opens immediately with computed defaults (no loading state on click), then
  // swaps in a saved draft/signed submission if one exists — a prior Save
  // Progress or Sign & Submit always wins over freshly-computed defaults.
  function openProtestEditor() {
    setValues(
      getNoticeOfProtestDefaults(property, property.taxYear, strategyRecommendation, authorization),
    );
    setEditingForm("protest");
    setSigningOpen(false);
    setSignature(null);
    getSubmission(protest.id, "notice_of_protest")
      .then((existing) => existing && setValues(existing.fieldValues))
      .catch((err) => console.error("Could not load saved Notice of Protest draft:", err));
  }

  function openAgentEditor() {
    if (!authorization) return;
    setValues(getAppointmentOfAgentDefaults(authorization, property));
    setEditingForm("agent");
    setSigningOpen(false);
    setSignature(null);
    getSubmission(protest.id, "appointment_of_agent")
      .then((existing) => existing && setValues(existing.fieldValues))
      .catch((err) => console.error("Could not load saved Appointment of Agent draft:", err))
      .finally(fillAdditionalOwnerProperties);
  }

  // Form 50-162 authorizes an agent for possibly several properties at once —
  // this case's own property already fills the first slot; this looks up any
  // OTHER real properties on file under the same owner name, in the same
  // appraisal district (an authorization is filed per-district, so a sibling
  // property in a different county doesn't belong on this form), and fills
  // the remaining slots. Reuses the exact same owner-name search Add
  // Ownerships already uses — real CAD data, never guessed. Runs after the
  // saved-draft check above (whichever wins) and only ever fills slots that
  // are still empty, so it can never clobber a saved draft or an edit the
  // user already made.
  async function fillAdditionalOwnerProperties() {
    const ownerName =
      property.ownerName || (authorization?.isEntity ? authorization.entityName : null);
    if (!ownerName || !property.cad) return;
    try {
      const { matches } = await searchPropertiesByOwner(ownerName);
      const isCurrentProperty = (m: (typeof matches)[number]) =>
        property.accountNumber && m.accountNumber
          ? m.accountNumber === property.accountNumber
          : m.propertyAddress.trim().toLowerCase() === property.address.trim().toLowerCase();
      const additional = matches.filter((m) => m.cad === property.cad && !isCurrentProperty(m));
      if (additional.length === 0) return;
      setValues((prev) =>
        prev["Appraisal District Account Number_3"] ||
        prev["Physical or Situs Address of Property_3"]
          ? prev
          : { ...prev, ...getAdditionalOwnerPropertyFields(additional) },
      );
    } catch (err) {
      console.error("Could not search for other properties under this ownership:", err);
    }
  }

  function handleFieldChange(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSaveProgress() {
    if (!formType) return;
    setSaving(true);
    try {
      await saveDraft(userId, protest.id, formType, values);
      toast.success("Progress saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save your progress.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const bytes = await buildPdf(templatePath, schema, values);
      const filenameBase = property.accountNumber ?? property.id;
      downloadPdf(
        bytes,
        editingForm === "protest"
          ? `Notice-of-Protest-${filenameBase}.pdf`
          : `Appointment-of-Agent-${filenameBase}.pdf`,
      );
      // Downloading shouldn't be able to lose edits either — save silently
      // alongside it, without its own toast (Download already has one).
      if (formType)
        await saveDraft(userId, protest.id, formType, values).catch((err) => console.error(err));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate this document.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleConfirmSign() {
    if (!formType || !signature) return;
    setSubmitting(true);
    try {
      // Last-chance correction — catches a date field that was never blurred
      // (e.g. filled by clicking a suggestion chip last) before it's baked
      // into the signed PDF and the saved record.
      const resolvedValues = resolveDateFields(schema, values);
      setValues(resolvedValues);
      const signedAt = new Date();
      const bytes = await signPdf(templatePath, schema, resolvedValues, signature, signedAt);
      const filenameBase = property.accountNumber ?? property.id;
      const fileName =
        editingForm === "protest"
          ? `Signed-Notice-of-Protest-${filenameBase}.pdf`
          : `Signed-Appointment-of-Agent-${filenameBase}.pdf`;
      const file = new File([bytes as BlobPart], fileName, { type: "application/pdf" });
      const doc = await uploadDocument(
        userId,
        property.id,
        file,
        editingForm === "protest" ? "Signed Notice of Protest" : "Signed Appointment of Agent",
      );
      await signAndSubmit(userId, protest.id, formType, resolvedValues, signature, doc.id);
      if (editingForm === "protest") {
        await markFiled(protest.id);
        onUpdate({ status: "filed" });
      }
      downloadPdf(bytes, fileName);
      setSigningOpen(false);
      setSignature(null);
      toast.success(
        editingForm === "protest"
          ? "Signed and saved — this case is now marked Filed. Download or deliver this PDF to your appraisal district to complete filing."
          : "Signed and saved.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not sign this document.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div id="case-documents" className="mt-5 border-t border-border pt-5">
      <h4 className="text-sm font-semibold">Documents</h4>
      <p className="text-xs text-muted-foreground">
        Official Texas Comptroller forms, pre-filled from this case. Review or edit every field
        in-app, then download.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={openProtestEditor} className="btn-outline text-xs py-1.5">
          Review Notice of Protest (Form 50-132)
        </button>
        <button
          onClick={openAgentEditor}
          disabled={authLoading || !authorization}
          className="btn-outline text-xs py-1.5 disabled:opacity-60"
          title={
            !authLoading && !authorization
              ? "No signed authorization on file for this case yet"
              : undefined
          }
        >
          Review Appointment of Agent (Form 50-162)
        </button>
      </div>

      {editingForm && (
        <PdfFormEditor
          title={
            editingForm === "protest"
              ? "Notice of Protest (Form 50-132)"
              : "Appointment of Agent (Form 50-162)"
          }
          sections={schema}
          values={values}
          onChange={handleFieldChange}
          onDownload={handleDownload}
          downloading={downloading}
          onSaveProgress={handleSaveProgress}
          saving={saving}
          allowSigning={allowSigning}
          signingOpen={signingOpen}
          onOpenSigning={() => {
            setSignature(null);
            setSigningOpen(true);
          }}
          onCancelSigning={() => {
            setSigningOpen(false);
            setSignature(null);
          }}
          signature={signature}
          onSignatureChange={setSignature}
          onConfirmSign={handleConfirmSign}
          submitting={submitting}
          expectedSignerName={(() => {
            const key =
              editingForm === "protest"
                ? "Print Name of Property Owner or Authorized Representative"
                : "Name of Property Owner";
            const v = values[key];
            return typeof v === "string" && v ? v : undefined;
          })()}
          onClose={() => setEditingForm(null)}
        />
      )}
    </div>
  );
}

export function CaseProgress({
  protest,
  property,
  caseData,
  onUpdate,
}: {
  protest: ProtestRecord;
  property: PropertyRecord;
  caseData: ProtestCase | null;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showOfferForm, setShowOfferForm] = useState(false);
  const [offerValue, setOfferValue] = useState("");
  const [offerDate, setOfferDate] = useState(new Date().toISOString().slice(0, 10));
  const [showHearingForm, setShowHearingForm] = useState(false);
  const [hearingDateInput, setHearingDateInput] = useState("");
  const [showHearingSummary, setShowHearingSummary] = useState(false);
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [decisionType, setDecisionType] = useState<"approved" | "partial" | "denied">("partial");
  const [decisionDate, setDecisionDate] = useState(new Date().toISOString().slice(0, 10));
  const [decisionValue, setDecisionValue] = useState("");
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [closeValue, setCloseValue] = useState("");

  async function submitOffer(e: FormEvent) {
    e.preventDefault();
    if (!offerValue) return;
    setBusy(true);
    try {
      const value = Number(offerValue);
      await recordSettlementOffer(protest.id, { value, receivedAt: offerDate });
      onUpdate({
        settlementOfferValue: value,
        settlementOfferReceivedAt: offerDate,
        status: "offer_received",
      });
      setShowOfferForm(false);
      toast.success("Settlement offer recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this offer.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptOffer() {
    if (protest.settlementOfferValue == null) return;
    setBusy(true);
    try {
      await acceptSettlement(protest.id, protest.settlementOfferValue);
      onUpdate({
        finalValue: protest.settlementOfferValue,
        escalationPath: "accept",
        closedAt: new Date().toISOString(),
        status: "resolved",
      });
      toast.success("Offer accepted — case closed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not accept this offer.");
    } finally {
      setBusy(false);
    }
  }

  async function submitHearing(e: FormEvent) {
    e.preventDefault();
    if (!hearingDateInput) return;
    setBusy(true);
    try {
      await scheduleHearing(protest.id, hearingDateInput);
      onUpdate({ hearingDate: hearingDateInput, status: "hearing_scheduled" });
      setShowHearingForm(false);
      toast.success("Hearing date recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this hearing date.");
    } finally {
      setBusy(false);
    }
  }

  async function submitDecision(e: FormEvent) {
    e.preventDefault();
    if (!decisionValue) return;
    setBusy(true);
    try {
      const finalValue = Number(decisionValue);
      await recordArbDecision(protest.id, { type: decisionType, date: decisionDate, finalValue });
      const resolved = decisionType === "approved";
      onUpdate({
        arbDecision: decisionType,
        arbDecisionDate: decisionDate,
        finalValue,
        status: resolved ? "resolved" : "decision_received",
        ...(resolved ? { closedAt: new Date().toISOString(), escalationPath: "accept" } : {}),
      });
      setShowDecisionForm(false);
      toast.success("ARB decision recorded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this decision.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEscalate(path: "appeal" | "arbitration") {
    setBusy(true);
    try {
      await recordEscalation(protest.id, path);
      onUpdate({ escalationPath: path, status: path === "appeal" ? "appealing" : "arbitrating" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not record this next step.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAcceptDecision() {
    if (protest.finalValue == null) return;
    setBusy(true);
    try {
      await acceptSettlement(protest.id, protest.finalValue);
      onUpdate({
        escalationPath: "accept",
        closedAt: new Date().toISOString(),
        status: "resolved",
      });
      toast.success("Decision accepted — case closed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close this case.");
    } finally {
      setBusy(false);
    }
  }

  async function submitClose(e: FormEvent) {
    e.preventDefault();
    if (!closeValue) return;
    setBusy(true);
    try {
      const finalValue = Number(closeValue);
      await closeCase(protest.id, finalValue);
      onUpdate({ finalValue, closedAt: new Date().toISOString(), status: "resolved" });
      setShowCloseForm(false);
      toast.success("Case closed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not close this case.");
    } finally {
      setBusy(false);
    }
  }

  const results = getCaseResults(protest, property);

  return (
    <div id="case-progress" className="mt-5 border-t border-border pt-5">
      <h4 className="text-sm font-semibold">Case Progress</h4>

      {protest.status === "resolved" ? (
        results ? (
          <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
            <Field label="Original Value" value={currency(protest.originalValue ?? undefined)} />
            <Field label="Final Value" value={currency(protest.finalValue ?? undefined)} />
            <Field label="Value Reduction" value={currency(results.valueReduction)} bold />
            <Field
              label="Actual Tax Savings"
              value={currency(results.actualSavings)}
              bold
              success
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Case closed — no final value on file.
          </p>
        )
      ) : (
        <div className="mt-3 grid gap-4">
          {/* Settlement offer */}
          {protest.status === "offer_received" ? (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">
                Settlement offer: {currency(protest.settlementOfferValue ?? undefined)}
                {protest.settlementOfferReceivedAt && ` (${protest.settlementOfferReceivedAt})`}
              </div>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={handleAcceptOffer}
                  disabled={busy}
                  className="btn-accent text-xs py-1.5 disabled:opacity-60"
                >
                  Accept Offer
                </button>
                <span className="text-xs text-muted-foreground self-center">
                  or schedule a hearing below to proceed instead
                </span>
              </div>
            </div>
          ) : (
            protest.status !== "decision_received" &&
            protest.status !== "appealing" &&
            protest.status !== "arbitrating" && (
              <div>
                {showOfferForm ? (
                  <form
                    onSubmit={submitOffer}
                    className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end"
                  >
                    <label className="grid gap-1 text-xs">
                      Offer amount
                      <input
                        required
                        value={offerValue}
                        onChange={(e) => setOfferValue(e.target.value)}
                        inputMode="decimal"
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <label className="grid gap-1 text-xs">
                      Date received
                      <input
                        required
                        type="date"
                        value={offerDate}
                        onChange={(e) => setOfferDate(e.target.value)}
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={busy}
                      className="btn-accent text-xs py-1.5 disabled:opacity-60"
                    >
                      Save
                    </button>
                  </form>
                ) : (
                  <button
                    onClick={() => setShowOfferForm(true)}
                    className="btn-outline text-xs py-1.5"
                  >
                    Record Settlement Offer
                  </button>
                )}
              </div>
            )
          )}

          {/* Hearing */}
          {(protest.status === "hearing_scheduled" ||
            (protest.status !== "decision_received" &&
              protest.status !== "appealing" &&
              protest.status !== "arbitrating")) && (
            <div>
              {protest.status === "hearing_scheduled" ? (
                <div className="rounded-md border border-border p-3 text-sm">
                  <div className="font-medium">Hearing scheduled: {protest.hearingDate}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => setShowHearingSummary((v) => !v)}
                      className="btn-outline text-xs py-1.5"
                    >
                      {showHearingSummary ? "Hide" : "View"} Hearing Summary
                    </button>
                    <button
                      onClick={() => setShowDecisionForm((v) => !v)}
                      className="btn-outline text-xs py-1.5"
                    >
                      Record ARB Decision
                    </button>
                  </div>
                  {showHearingSummary && caseData && (
                    <pre className="mt-3 whitespace-pre-wrap rounded-md bg-secondary/40 p-3 text-xs">
                      {getHearingPrep(caseData, property.address)}
                    </pre>
                  )}
                  {showDecisionForm && (
                    <form onSubmit={submitDecision} className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs">
                        Decision
                        <select
                          value={decisionType}
                          onChange={(e) => setDecisionType(e.target.value as typeof decisionType)}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        >
                          <option value="approved">Approved (full reduction granted)</option>
                          <option value="partial">Partial reduction</option>
                          <option value="denied">Denied</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-xs">
                        Decision date
                        <input
                          required
                          type="date"
                          value={decisionDate}
                          onChange={(e) => setDecisionDate(e.target.value)}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <label className="grid gap-1 text-xs sm:col-span-2">
                        Final determined value
                        <input
                          required
                          value={decisionValue}
                          onChange={(e) => setDecisionValue(e.target.value)}
                          inputMode="decimal"
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="btn-accent text-xs py-1.5 w-fit disabled:opacity-60"
                      >
                        Save Decision
                      </button>
                    </form>
                  )}
                </div>
              ) : (
                <div>
                  {showHearingForm ? (
                    <form onSubmit={submitHearing} className="flex flex-wrap items-end gap-2">
                      <label className="grid gap-1 text-xs">
                        Hearing date
                        <input
                          required
                          type="date"
                          value={hearingDateInput}
                          onChange={(e) => setHearingDateInput(e.target.value)}
                          className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busy}
                        className="btn-accent text-xs py-1.5 disabled:opacity-60"
                      >
                        Save
                      </button>
                    </form>
                  ) : (
                    <button
                      onClick={() => setShowHearingForm(true)}
                      className="btn-outline text-xs py-1.5"
                    >
                      Schedule a Hearing
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Decision received, non-approved — next steps */}
          {protest.status === "decision_received" && (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">
                ARB decision: {protest.arbDecision} — final value{" "}
                {currency(protest.finalValue ?? undefined)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">What's next?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={handleAcceptDecision}
                  disabled={busy}
                  className="btn-accent text-xs py-1.5 disabled:opacity-60"
                >
                  Accept
                </button>
                <button
                  onClick={() => handleEscalate("appeal")}
                  disabled={busy}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  File Judicial Appeal
                </button>
                <button
                  onClick={() => handleEscalate("arbitration")}
                  disabled={busy}
                  className="btn-outline text-xs py-1.5 disabled:opacity-60"
                >
                  Request Binding Arbitration
                </button>
              </div>
            </div>
          )}

          {/* Appealing / arbitrating */}
          {(protest.status === "appealing" || protest.status === "arbitrating") && (
            <div className="rounded-md border border-border p-3 text-sm">
              <div className="font-medium">
                {protest.status === "appealing"
                  ? "Judicial appeal in progress."
                  : "Binding arbitration in progress."}
              </div>
              {protest.status === "arbitrating" ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Texas requires agents to file a Request for Binding Arbitration online, not on
                  paper — file at{" "}
                  <a
                    href="https://www.texas.gov/propertytaxarbitration"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    texas.gov/propertytaxarbitration
                  </a>
                  . A deposit is required with the request (refunded if the arbitrator's value lands
                  closer to the owner's opinion of value than the ARB's).
                </p>
              ) : (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  A judicial appeal is a lawsuit filed in district court (Tax Code Chapter 42), not
                  a Comptroller form — it typically requires an attorney and isn't something this
                  app files. See the Comptroller's{" "}
                  <a
                    href="https://comptroller.texas.gov/taxes/property-tax/protests/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent hover:underline"
                  >
                    Appraisal Protests and Appeals
                  </a>{" "}
                  overview for background.
                </p>
              )}
              {showCloseForm ? (
                <form onSubmit={submitClose} className="mt-2 flex flex-wrap items-end gap-2">
                  <label className="grid gap-1 text-xs">
                    Final determined value
                    <input
                      required
                      value={closeValue}
                      onChange={(e) => setCloseValue(e.target.value)}
                      inputMode="decimal"
                      className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy}
                    className="btn-accent text-xs py-1.5 disabled:opacity-60"
                  >
                    Save
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => setShowCloseForm(true)}
                  className="btn-outline text-xs py-1.5 mt-2"
                >
                  Record Final Outcome
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  bold,
  success,
}: {
  label: string;
  value: string;
  bold?: boolean;
  success?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`${bold ? "font-semibold" : ""} ${success ? "text-success" : ""}`}>
        {value}
      </div>
    </div>
  );
}
