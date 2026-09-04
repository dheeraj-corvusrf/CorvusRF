import { supabase } from "./supabase";

// document_type is free-text (no schema enum), so this is just a convention shared
// between the upload call and the filter query that reads it back — see
// src/routes/ai-report.tsx's Improvement Condition module.
export const EVIDENCE_DOCUMENT_TYPE = "Improvement Evidence";

// Same convention, for a real protest case's own evidence — shared between
// CaseDetailModal's per-item checklist upload and ai-report.tsx's Module 8
// upload widget, so a file uploaded via either path shows up as the same
// tagged evidence, not two similarly-named-but-different strings.
export const PROTEST_EVIDENCE_DOCUMENT_TYPE = "Protest Evidence";

// Uploaded once a user confirms they've actually submitted their protest to
// the county (see DocumentsSection's "Have you filed?" prompt) — optional,
// best-effort proof, never required to mark a case Filed.
export const FILING_PROOF_DOCUMENT_TYPE = "Filing Proof";

export type DocumentRecord = {
  id: string;
  propertyId: string;
  fileName: string;
  storagePath: string;
  documentType: string | null;
  uploadedAt: string;
};

type DocumentRow = {
  id: string;
  property_id: string;
  file_name: string;
  storage_path: string;
  document_type: string | null;
  uploaded_at: string;
};

function fromRow(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    propertyId: row.property_id,
    fileName: row.file_name,
    storagePath: row.storage_path,
    documentType: row.document_type,
    uploadedAt: row.uploaded_at,
  };
}

// Uploads the original file to the private "documents" bucket and indexes it — called
// right after a property is confirmed/saved, so the dashboard's Documents tab has a
// real file to list instead of only the AI-extracted field values.
export async function uploadDocument(
  userId: string,
  propertyId: string,
  file: File,
  documentType?: string | null,
): Promise<DocumentRecord> {
  const storagePath = `${userId}/${propertyId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("documents")
    .insert({
      property_id: propertyId,
      user_id: userId,
      file_name: file.name,
      storage_path: storagePath,
      document_type: documentType ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return fromRow(data as DocumentRow);
}

export async function listDocuments(userId: string): Promise<DocumentRecord[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id, property_id, file_name, storage_path, document_type, uploaded_at")
    .eq("user_id", userId)
    .order("uploaded_at", { ascending: false });
  if (error) throw error;
  return (data as DocumentRow[]).map(fromRow);
}

// Real "Protest Evidence"-tagged documents for one property — the same
// query ai-report.tsx's Module 8 already uses to show its own upload list
// (queried directly, not scoped to any protest_evidence_items checklist
// link), reused so anything that needs to know "how much evidence has this
// customer actually uploaded" (CaseDetailModal's Upload Evidence prompt,
// draftProtestReason, the Pre-Filing Check row) reads the same real,
// single source of truth Module 8 writes to.
export async function getProtestEvidenceDocuments(
  userId: string,
  propertyId: string,
): Promise<DocumentRecord[]> {
  const docs = await listDocuments(userId);
  return docs.filter(
    (d) => d.propertyId === propertyId && d.documentType === PROTEST_EVIDENCE_DOCUMENT_TYPE,
  );
}

export async function getDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(storagePath, 60 * 5);
  if (error) throw error;
  return data.signedUrl;
}
