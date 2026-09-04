import { getDocumentUrl, type DocumentRecord } from "./documents";
import { invokeEdgeFunction } from "./edge-functions";
import { bytesToBase64 } from "./pdf-utils";
import type { PropertyRecord } from "./properties";

// Real uploaded evidence documents in, real AI analysis out — see
// supabase/functions/draft-protest-reason/index.ts for the actual prompt/
// discipline. Two real callers: PdfFormEditor.tsx's "Generate Suggested
// Reason" button (draftProtestReason, below — just the suggested
// paragraph) and ai-report.tsx's Module 8 "Analyze My Evidence"
// (analyzeEvidence — the full per-document + summary analysis). Both are
// only ever triggered by an explicit user click, never automatic, and
// every field either returns is something the customer reviews — never
// inserted or submitted on its own.
//
// Reads from the same real "Protest Evidence"-tagged document list Module
// 8 (ai-report.tsx) writes to (see getProtestEvidenceDocuments in
// documents.ts) — not the older per-checklist-item links, since evidence
// upload now happens exclusively through Module 8.

const MAX_DOCS = 5;
// Stay well under Gemini's practical inline-data limits — a document over
// this is skipped (not sent, not guessed at), same "never fabricate"
// discipline as everything else this app sends to a model.
const MAX_BYTES_PER_DOC = 8 * 1024 * 1024;

// arrayBuffer + btoa, not FileReader.readAsDataURL — works the same in the
// browser and in a plain Node test environment (no DOM), and this file
// already has the bytes in hand from fetch() rather than a <input> File.
async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = blob.type || "application/octet-stream";
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

export class NoEvidenceDocumentsError extends Error {
  constructor() {
    super("No evidence documents to read yet — upload some via Module 8 (Evidence) first.");
    this.name = "NoEvidenceDocumentsError";
  }
}

type PreparedDocument = { fileName: string; mimeType: string; dataUrl: string };

// Downloads the real file bytes for up to MAX_DOCS evidence documents and
// converts each to a data URL for the edge function — shared by both
// callers below so there's exactly one real download/size-cap/skip-bad-
// file policy, not two that could drift.
async function prepareEvidenceDocuments(
  evidenceDocuments: DocumentRecord[],
): Promise<PreparedDocument[]> {
  const documents: PreparedDocument[] = [];
  for (const doc of evidenceDocuments.slice(0, MAX_DOCS)) {
    const url = await getDocumentUrl(doc.storagePath);
    const res = await fetch(url);
    if (!res.ok) continue; // one bad file shouldn't sink the whole analysis
    const blob = await res.blob();
    if (blob.size > MAX_BYTES_PER_DOC) continue;
    documents.push({
      fileName: doc.fileName,
      mimeType: blob.type || "application/octet-stream",
      dataUrl: await blobToDataUrl(blob),
    });
  }
  return documents;
}

function propertyContext(property: PropertyRecord, strategyRecommendation: string | null) {
  return {
    address: property.address,
    cad: property.cad,
    taxYear: property.taxYear,
    totalValue: property.totalValue,
    strategyRecommendation,
  };
}

export async function draftProtestReason(
  property: PropertyRecord,
  strategyRecommendation: string | null,
  evidenceDocuments: DocumentRecord[],
): Promise<string> {
  if (evidenceDocuments.length === 0) throw new NoEvidenceDocumentsError();
  const documents = await prepareEvidenceDocuments(evidenceDocuments);
  if (documents.length === 0) throw new NoEvidenceDocumentsError();

  const { text } = await invokeEdgeFunction<{ text: string }>("draft-protest-reason", {
    property: propertyContext(property, strategyRecommendation),
    documents,
  });
  return text;
}

export type EvidenceAnalysis = {
  documentFindings: { fileName: string; assessment: string }[];
  summary: string;
  suggestedReason: string;
};

// The fuller version — real per-document findings (including an honest
// flag when a file doesn't look like real protest evidence at all) plus
// an overall summary, not just the one suggested paragraph
// draftProtestReason returns. Used by Module 8's "Analyze My Evidence."
export async function analyzeEvidence(
  property: PropertyRecord,
  strategyRecommendation: string | null,
  evidenceDocuments: DocumentRecord[],
): Promise<EvidenceAnalysis> {
  if (evidenceDocuments.length === 0) throw new NoEvidenceDocumentsError();
  const documents = await prepareEvidenceDocuments(evidenceDocuments);
  if (documents.length === 0) throw new NoEvidenceDocumentsError();

  return invokeEdgeFunction<EvidenceAnalysis>("draft-protest-reason", {
    property: propertyContext(property, strategyRecommendation),
    documents,
  });
}
