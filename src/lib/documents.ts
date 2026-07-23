import { supabase } from "./supabase";

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

export async function getDocumentUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from("documents")
    .createSignedUrl(storagePath, 60 * 5);
  if (error) throw error;
  return data.signedUrl;
}
