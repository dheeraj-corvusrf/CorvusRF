import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { supabase } from "./supabase";
import {
  getDocumentUrl,
  uploadDocument,
  SETTLEMENT_SIGNED_DOCUMENT_TYPE,
  type DocumentRecord,
} from "./documents";
import { extractDecisionDocument, type DecisionExtraction } from "./decision-notice";
import type { PropertyRecord } from "./properties";
import type { SignatureValue } from "@/components/SignaturePad";

// Real "settlement offer awaiting signature" flow: upload the county's own
// document, AI reads the real settled value/terms (extractDecisionDocument
// — same extraction extract-decision-document/index.ts does for post-
// hearing decisions, since it's the same kind of read), the user reviews
// and explicitly confirms it looks correct, only THEN can they sign, and
// signing appends a real certification page (not a re-typeset form — the
// original document's own real pages, plus one page recording who signed,
// when, and what was confirmed) rather than trying to place a signature on
// an unknown form's own signature line. The user downloads the result and
// submits it themselves — this app has no e-filing integration with any
// county.
export const extractSettlementDocument = extractDecisionDocument;

export type SettlementAgreementRecord = {
  id: string;
  protestId: string;
  documentId: string | null;
  settledValue: number | null;
  taxYear: string | null;
  accountNumber: string | null;
  propertyAddress: string | null;
  termsSummary: string | null;
  discrepancies: string[];
  userConfirmedAt: string | null;
  signatureType: "draw" | "type" | null;
  signatureData: string | null;
  signedAt: string | null;
  signedDocumentId: string | null;
  createdAt: string;
};

type SettlementAgreementRow = {
  id: string;
  protest_id: string;
  document_id: string | null;
  settled_value: number | null;
  extracted_tax_year: string | null;
  extracted_account_number: string | null;
  extracted_property_address: string | null;
  terms_summary: string | null;
  discrepancies: string | null;
  user_confirmed_at: string | null;
  signature_type: "draw" | "type" | null;
  signature_data: string | null;
  signed_at: string | null;
  signed_document_id: string | null;
  created_at: string;
};

function parseArray(v: string | null): string[] {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function fromRow(row: SettlementAgreementRow): SettlementAgreementRecord {
  return {
    id: row.id,
    protestId: row.protest_id,
    documentId: row.document_id,
    settledValue: row.settled_value,
    taxYear: row.extracted_tax_year,
    accountNumber: row.extracted_account_number,
    propertyAddress: row.extracted_property_address,
    termsSummary: row.terms_summary,
    discrepancies: parseArray(row.discrepancies),
    userConfirmedAt: row.user_confirmed_at,
    signatureType: row.signature_type,
    signatureData: row.signature_data,
    signedAt: row.signed_at,
    signedDocumentId: row.signed_document_id,
    createdAt: row.created_at,
  };
}

export async function saveSettlementAgreement(
  userId: string,
  protestId: string,
  documentId: string | null,
  extraction: DecisionExtraction,
): Promise<SettlementAgreementRecord> {
  const { data, error } = await supabase
    .from("settlement_agreements")
    .insert({
      protest_id: protestId,
      user_id: userId,
      document_id: documentId,
      settled_value: extraction.finalValue,
      extracted_tax_year: extraction.taxYear,
      extracted_account_number: extraction.accountNumber,
      extracted_property_address: extraction.propertyAddress,
      terms_summary: extraction.settlementTerms,
      discrepancies: JSON.stringify(extraction.discrepancies),
    })
    .select()
    .single();
  if (error) throw error;
  return fromRow(data as SettlementAgreementRow);
}

export async function getLatestSettlementAgreement(
  protestId: string,
): Promise<SettlementAgreementRecord | null> {
  const { data, error } = await supabase
    .from("settlement_agreements")
    .select("*")
    .eq("protest_id", protestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as SettlementAgreementRow) : null;
}

// "Give the user the OK to sign" — the explicit confirmation step the
// product asked for, distinct from and required before signing. Recorded
// with its own timestamp so there's a real audit trail of when the user
// said the extracted details looked correct, separate from when they
// actually signed.
export async function confirmSettlementAgreement(id: string): Promise<void> {
  const { error } = await supabase
    .from("settlement_agreements")
    .update({ user_confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(trial, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = trial;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Appends a real certification page — who signed, when, what was confirmed
// — to the county's own original document (its real pages, copied as-is,
// never re-typeset). For a non-PDF upload (an image), the image becomes
// its own full page first. This is deliberately NOT an attempt to place a
// signature on the original document's own signature line: this app
// doesn't know that unknown form's layout, so it certifies alongside the
// original instead of altering it.
export async function buildSignedSettlementPdf(
  originalBytes: Uint8Array,
  originalMimeType: string,
  originalFileName: string,
  signature: SignatureValue,
  meta: {
    propertyAddress: string | null;
    accountNumber: string | null;
    taxYear: string | null;
    settledValue: number | null;
    signerName: string;
  },
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const isPdf = originalMimeType.includes("pdf") || /\.pdf$/i.test(originalFileName);
  const isJpeg = originalMimeType.includes("jpeg") || originalMimeType.includes("jpg");
  const isPng = originalMimeType.includes("png");

  if (isPdf) {
    const source = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    const pages = await out.copyPages(source, source.getPageIndices());
    for (const page of pages) out.addPage(page);
  } else if (isJpeg || isPng) {
    const image = isJpeg ? await out.embedJpg(originalBytes) : await out.embedPng(originalBytes);
    const maxW = PAGE_WIDTH - MARGIN * 2;
    const maxH = PAGE_HEIGHT - MARGIN * 2;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    const page = out.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawImage(image, {
      x: (PAGE_WIDTH - w) / 2,
      y: (PAGE_HEIGHT - h) / 2,
      width: w,
      height: h,
    });
  } else {
    throw new Error(`unsupported file type "${originalMimeType || "unknown"}"`);
  }

  const regular = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const cert = out.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const ink = rgb(0.09, 0.09, 0.11);
  const muted = rgb(0.42, 0.42, 0.46);

  const write = (
    text: string,
    opts: { size?: number; bold?: boolean; color?: typeof ink; gap?: number } = {},
  ) => {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? bold : regular;
    for (const line of wrapText(text, font, size, PAGE_WIDTH - MARGIN * 2)) {
      cert.drawText(line, { x: MARGIN, y, size, font, color: opts.color ?? ink });
      y -= size * 1.4;
    }
    y -= opts.gap ?? 0;
  };

  write("Settlement Agreement — Signature Certification", { size: 16, bold: true, gap: 6 });
  write(
    `Generated ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`,
    {
      size: 9,
      color: muted,
      gap: 14,
    },
  );
  if (meta.propertyAddress) write(`Property: ${meta.propertyAddress}`, { gap: 2 });
  if (meta.accountNumber) write(`Account number: ${meta.accountNumber}`, { gap: 2 });
  if (meta.taxYear) write(`Tax year: ${meta.taxYear}`, { gap: 2 });
  if (meta.settledValue != null)
    write(`Settled value: $${meta.settledValue.toLocaleString()}`, { gap: 2 });
  y -= 10;
  write(
    "The property owner reviewed the attached settlement document, confirmed the details above were correct, and signed below to accept it.",
    { size: 10, color: muted, gap: 16 },
  );

  write("Signature:", { size: 9.5, bold: true, color: muted, gap: 4 });
  if (signature.type === "type") {
    const cursiveFont = await out.embedFont(StandardFonts.HelveticaOblique);
    cert.drawText(signature.data, { x: MARGIN, y, size: 22, font: cursiveFont, color: ink });
    y -= 34;
  } else {
    const png = await out.embedPng(signature.data);
    const w = 240;
    const h = (png.height / png.width) * w;
    cert.drawImage(png, { x: MARGIN, y: y - h, width: w, height: h });
    y -= h + 10;
  }
  write(`Signed by: ${meta.signerName}`, { size: 9.5, color: muted, gap: 2 });
  write(
    `Signed at: ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`,
    {
      size: 9.5,
      color: muted,
    },
  );

  return out.save();
}

export async function signSettlementAgreement(
  userId: string,
  agreement: SettlementAgreementRecord,
  property: PropertyRecord,
  originalDocument: DocumentRecord,
  signature: SignatureValue,
  signerName: string,
): Promise<{ record: SettlementAgreementRecord; signedDocument: DocumentRecord }> {
  const url = await getDocumentUrl(originalDocument.storagePath);
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not read the original settlement document.");
  const blob = await res.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const signedBytes = await buildSignedSettlementPdf(
    bytes,
    blob.type || "application/octet-stream",
    originalDocument.fileName,
    signature,
    {
      propertyAddress: property.address,
      accountNumber: property.accountNumber,
      taxYear: agreement.taxYear ?? (property.taxYear != null ? String(property.taxYear) : null),
      settledValue: agreement.settledValue,
      signerName,
    },
  );

  const signedFile = new File(
    [signedBytes as BlobPart],
    `signed-settlement-${originalDocument.fileName.replace(/\.[^.]+$/, "")}.pdf`,
    { type: "application/pdf" },
  );
  const signedDocument = await uploadDocument(
    userId,
    property.id,
    signedFile,
    SETTLEMENT_SIGNED_DOCUMENT_TYPE,
  );

  const { error } = await supabase
    .from("settlement_agreements")
    .update({
      signature_type: signature.type,
      signature_data: signature.data,
      signed_at: new Date().toISOString(),
      signed_document_id: signedDocument.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", agreement.id);
  if (error) throw error;

  return {
    record: {
      ...agreement,
      signatureType: signature.type,
      signedAt: new Date().toISOString(),
      signedDocumentId: signedDocument.id,
    },
    signedDocument,
  };
}
