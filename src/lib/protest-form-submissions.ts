import { supabase } from "./supabase";
import type { FieldValues } from "./protest-documents";
import type { SignatureValue } from "@/components/SignaturePad";

export type FormType = "notice_of_protest" | "appointment_of_agent" | "evidence_declaration";

export type FormSubmission = {
  fieldValues: FieldValues;
  signature: SignatureValue | null;
  signedAt: string | null;
  documentId: string | null;
};

type SubmissionRow = {
  field_values: string;
  signature_type: "draw" | "type" | null;
  signature_data: string | null;
  signed_at: string | null;
  document_id: string | null;
};

function fromRow(row: SubmissionRow): FormSubmission {
  return {
    fieldValues: JSON.parse(row.field_values) as FieldValues,
    signature:
      row.signature_type && row.signature_data
        ? { type: row.signature_type, data: row.signature_data }
        : null,
    signedAt: row.signed_at,
    documentId: row.document_id,
  };
}

export async function getSubmission(
  protestId: string,
  formType: FormType,
): Promise<FormSubmission | null> {
  const { data, error } = await supabase
    .from("protest_form_submissions")
    .select("field_values, signature_type, signature_data, signed_at, document_id")
    .eq("protest_id", protestId)
    .eq("form_type", formType)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as SubmissionRow) : null;
}

// Upserts on the (protest_id, form_type) unique key — one row per form per
// case, whether this is the first save or the hundredth edit.
export async function saveDraft(
  userId: string,
  protestId: string,
  formType: FormType,
  values: FieldValues,
): Promise<void> {
  const { error } = await supabase.from("protest_form_submissions").upsert(
    {
      protest_id: protestId,
      user_id: userId,
      form_type: formType,
      field_values: JSON.stringify(values),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "protest_id,form_type" },
  );
  if (error) throw error;
}

export async function signAndSubmit(
  userId: string,
  protestId: string,
  formType: FormType,
  values: FieldValues,
  signature: SignatureValue,
  documentId: string,
): Promise<void> {
  const { error } = await supabase.from("protest_form_submissions").upsert(
    {
      protest_id: protestId,
      user_id: userId,
      form_type: formType,
      field_values: JSON.stringify(values),
      signature_type: signature.type,
      signature_data: signature.data,
      signed_at: new Date().toISOString(),
      document_id: documentId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "protest_id,form_type" },
  );
  if (error) throw error;
}
