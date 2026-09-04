import { invokeEdgeFunction } from "./edge-functions";
import type { PropertyRecord } from "./properties";
import type { CountyProtestInfo } from "./county-protest-info";
import type { AppraiserCategory } from "./protests";

// Real, grounded informal-review guidance — see
// informal-review-guidance/index.ts for the prompt/discipline.
// draftEmailSubject/draftEmailBody are only ever populated when a real,
// verified contact email exists (contactEmail non-null); the caller should
// never build a mailto: link without checking that first.
export type InformalReviewGuidance = {
  available: "Yes" | "No" | "Unclear";
  appraiserCategory: AppraiserCategory;
  whoToContact: string;
  howToRequest: string;
  documentsToProvide: string[];
  requestedValueGuidance: string;
  evidenceToUse: string[];
  whatToSay: string;
  whatNotToSay: string;
  respondingToProposedValue: string;
  acceptingEndsCase: string;
  draftEmailSubject: string;
  draftEmailBody: string;
  contactEmail: string | null;
};

export async function getInformalReviewGuidance(
  property: PropertyRecord,
  countyInfo: CountyProtestInfo | null,
  strategyRecommendation: string | null,
  estimatedReduction: number | null,
  evidenceFileNames: string[],
): Promise<InformalReviewGuidance> {
  return invokeEdgeFunction<InformalReviewGuidance>("informal-review-guidance", {
    caseContext: {
      address: property.address,
      cad: property.cad,
      accountNumber: property.accountNumber,
      taxYear: property.taxYear,
      propertyType: property.propertyType,
      totalValue: property.totalValue,
      strategyRecommendation,
      estimatedReduction,
      evidenceFileNames,
    },
    countyReference: countyInfo
      ? { informalReview: countyInfo.informalReview, arbContact: countyInfo.arbContact }
      : null,
  });
}

// mailto: can't attach a file — same convention as PdfFormEditor's own
// buildFilingMailto.
export function buildInformalReviewMailto(guidance: InformalReviewGuidance): string | null {
  if (!guidance.contactEmail || !guidance.draftEmailBody) return null;
  const subject = guidance.draftEmailSubject || "Informal Review Request";
  return `mailto:${encodeURIComponent(guidance.contactEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(guidance.draftEmailBody)}`;
}
