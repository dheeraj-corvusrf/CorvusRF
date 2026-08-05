import { useEffect, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { toast } from "sonner";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import { getCase, generateCasePrep, linkEvidenceDocument, type ProtestCase } from "@/lib/protest-case";
import { uploadDocument } from "@/lib/documents";
import { Skeleton } from "@/components/ui/skeleton";

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
  const [generating, setGenerating] = useState(false);
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);

  function load() {
    setLoading(true);
    getCase(protest.id)
      .then(setCaseData)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load this case."))
      .finally(() => setLoading(false));
  }

  useEffect(load, [protest.id]);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateCasePrep(protest.id, userId, property);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate the case plan.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleUpload(itemId: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploadingItemId(itemId);
    try {
      const doc = await uploadDocument(userId, property.id, file, "Protest Evidence");
      await linkEvidenceDocument(itemId, doc.id);
      load();
      toast.success("Evidence uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not upload this file.");
    } finally {
      setUploadingItemId(null);
    }
  }

  const hasAnyPlan = !!caseData && (!!caseData.strategyRecommendation || caseData.evidenceItems.length > 0);
  const uploadedCount = caseData?.evidenceItems.filter((i) => i.documentId).length ?? 0;
  const totalCount = caseData?.evidenceItems.length ?? 0;

  return (
    <Modal onClose={onClose}>
      <h3 className="font-serif text-xl font-semibold">Case: {property.address}</h3>
      <p className="text-xs text-muted-foreground">AI-generated from your property's official CAD record.</p>

      {loading ? (
        <div className="mt-4 grid gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !hasAnyPlan ? (
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
      ) : (
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

          <section>
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
                {caseData!.evidenceItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border p-2.5 text-sm"
                  >
                    <span className="min-w-0 truncate">{item.label}</span>
                    {item.documentFileName ? (
                      <span className="shrink-0 text-xs text-success">✓ {item.documentFileName}</span>
                    ) : (
                      <label
                        className={`shrink-0 btn-outline text-xs py-1 cursor-pointer ${
                          uploadingItemId === item.id ? "opacity-60 pointer-events-none" : ""
                        }`}
                      >
                        {uploadingItemId === item.id ? "Uploading…" : "Upload"}
                        <input
                          type="file"
                          className="hidden"
                          accept=".pdf,image/*"
                          onChange={(e) => handleUpload(item.id, e)}
                        />
                      </label>
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
      )}

      <div className="mt-5 flex justify-end">
        <button onClick={onClose} className="btn-outline text-sm">
          Close
        </button>
      </div>
    </Modal>
  );
}

function Modal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-primary/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card-elev p-6 w-full max-w-lg max-h-[85vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
