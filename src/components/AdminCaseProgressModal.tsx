import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { PropertyRecord } from "@/lib/properties";
import type { ProtestRecord } from "@/lib/protests";
import { getCase, type ProtestCase } from "@/lib/protest-case";
import { CasePlanSection, CaseProgress, DocumentsSection } from "@/components/CaseDetailModal";
import { Modal } from "@/components/Modal";
import { Skeleton } from "@/components/ui/skeleton";

// Staff-facing counterpart to the customer dashboard's CaseDetailModal — reuses
// CaseProgress, DocumentsSection, and (as of the admin write-access RLS policies
// added alongside this) CasePlanSection verbatim. `userId` here is always the
// case-owning CUSTOMER's id (from AdminProtestRecord.userId in admin.tsx), never
// the signed-in admin's own — CasePlanSection's generateCasePrep()/uploadDocument()
// calls key their rows/storage paths off it directly, so the customer can still see
// their own case from their own dashboard afterward.
export function AdminCaseProgressModal({
  userId,
  protest,
  property,
  onUpdate,
  onClose,
}: {
  userId: string;
  protest: ProtestRecord;
  property: PropertyRecord;
  onUpdate: (patch: Partial<ProtestRecord>) => void;
  onClose: () => void;
}) {
  const [caseData, setCaseData] = useState<ProtestCase | null>(null);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    getCase(protest.id)
      .then(setCaseData)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load this case."))
      .finally(() => setLoading(false));
  }

  useEffect(load, [protest.id]);

  return (
    <Modal onClose={onClose} wide>
      <h3 className="font-serif text-xl font-semibold">Case: {property.address}</h3>
      <p className="text-xs text-muted-foreground">Staff view — record what the county reported.</p>

      {loading ? (
        <div className="mt-4 grid gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          <CasePlanSection
            userId={userId}
            property={property}
            protestId={protest.id}
            caseData={caseData}
            onReload={load}
          />
          <DocumentsSection
            userId={userId}
            protest={protest}
            property={property}
            strategyRecommendation={caseData?.strategyRecommendation ?? null}
            onUpdate={onUpdate}
            allowSigning={false}
          />
          <CaseProgress protest={protest} property={property} caseData={caseData} onUpdate={onUpdate} />
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
