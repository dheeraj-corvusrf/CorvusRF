import { PDFDocument, StandardFonts, rgb, type PDFFont, type RGB } from "pdf-lib";
import { getDocumentUrl, type DocumentRecord } from "./documents";
import { currency } from "./intake-store";
import { getCountyProtestInfo } from "./county-protest-info";
import type { PropertyRecord } from "./properties";
import type { EvidenceAnalysis, DocumentStatus } from "./protest-reason";

// Compiles a property's real uploaded protest-evidence documents into one
// organized, downloadable PDF — Module 8's "Download Evidence Packet". Real
// documents only: every page in the output is either an actual uploaded
// PDF's own pages (merged via copyPages, never re-rendered/re-typeset) or an
// actual uploaded image embedded full-page. Nothing here is AI-generated
// content; the AI's role (see protest-reason.ts/analyzeEvidence) already
// ran earlier and only supplies the per-document status/assessment text
// that decides what's included and how it's labeled below.
//
// Only "Accepted", "Needs Review", and "Additional Information Needed"
// documents are compiled in — "Incorrect Document" and "Duplicate" are
// deliberately left out (the user shouldn't submit a wrong file or a
// redundant copy to their county), and the cover page says exactly why each
// excluded document didn't make it in, so nothing just silently vanishes.
const INCLUDED_STATUSES: DocumentStatus[] = [
  "Accepted",
  "Needs Review",
  "Additional Information Needed",
];

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.42, 0.42, 0.46);
const ACCENT = rgb(0.1, 0.32, 0.62);

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

// Small stateful cursor so each section below can just say how much text it
// wants to write, rather than every call site tracking its own y-position —
// starts a fresh page whenever the current one runs out of room.
class PageWriter {
  doc: PDFDocument;
  page: ReturnType<PDFDocument["addPage"]>;
  y: number;
  regular: PDFFont;
  bold: PDFFont;

  private constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  static async create(doc: PDFDocument): Promise<PageWriter> {
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    return new PageWriter(doc, regular, bold);
  }

  ensureRoom(height: number) {
    if (this.y - height < MARGIN) {
      this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      this.y = PAGE_HEIGHT - MARGIN;
    }
  }

  text(
    value: string,
    opts: { size?: number; bold?: boolean; color?: RGB; gap?: number; maxWidth?: number } = {},
  ) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.bold : this.regular;
    const color = opts.color ?? INK;
    const maxWidth = opts.maxWidth ?? CONTENT_WIDTH;
    const lines = wrapText(value, font, size, maxWidth);
    for (const line of lines) {
      this.ensureRoom(size * 1.4);
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font, color });
      this.y -= size * 1.4;
    }
    this.y -= opts.gap ?? 0;
  }

  spacer(height: number) {
    this.y -= height;
  }

  rule() {
    this.ensureRoom(12);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.75,
      color: rgb(0.85, 0.85, 0.87),
    });
    this.y -= 12;
  }
}

const STATUS_LABEL: Record<DocumentStatus, string> = {
  Accepted: "Accepted",
  "Needs Review": "Needs Review — check this document before relying on it",
  "Incorrect Document": "Incorrect Document — not included below",
  Duplicate: "Duplicate — not included below",
  "Additional Information Needed": "Additional Information Needed — usable, but incomplete alone",
};

type MatchedFinding = EvidenceAnalysis["documentFindings"][number];

export async function buildEvidencePacket(
  property: PropertyRecord,
  documents: DocumentRecord[],
  findings: MatchedFinding[],
): Promise<Uint8Array> {
  const packet = await PDFDocument.create();
  const w = await PageWriter.create(packet);

  // ---- Cover page ----
  w.text("Property Tax Protest — Evidence Packet", { size: 18, bold: true, gap: 4 });
  w.text(`Generated ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}`, {
    size: 9.5,
    color: MUTED,
    gap: 14,
  });

  w.text("Property", { size: 9.5, bold: true, color: MUTED, gap: 2 });
  w.text(property.address, { size: 12, bold: true, gap: 2 });
  const facts = [
    property.cad ? `Appraisal District: ${property.cad}` : null,
    property.accountNumber ? `Account #: ${property.accountNumber}` : null,
    property.taxYear ? `Tax Year: ${property.taxYear}` : null,
    property.totalValue != null ? `Current Assessed Value: ${currency(property.totalValue)}` : null,
  ].filter((v): v is string => v != null);
  for (const fact of facts) w.text(fact, { size: 10.5, gap: 1 });
  w.spacer(10);
  w.rule();

  // ---- Table of contents ----
  const paired = documents.map((doc, i) => ({ doc, finding: findings[i] ?? null }));
  const included = paired.filter(
    (p): p is { doc: DocumentRecord; finding: MatchedFinding } =>
      p.finding != null && INCLUDED_STATUSES.includes(p.finding.status),
  );
  const excluded = paired.filter((p) => !included.some((inc) => inc.doc.id === p.doc.id));

  w.text("Contents", { size: 12, bold: true, gap: 6 });
  if (included.length === 0) {
    w.text("No documents qualified for inclusion — see below.", { size: 10.5, color: MUTED });
  }
  included.forEach((p, i) => {
    w.text(`${i + 1}. ${p.doc.fileName}`, { size: 10.5, bold: true, gap: 1 });
    w.text(STATUS_LABEL[p.finding.status], { size: 9, color: MUTED, gap: 4 });
  });

  if (excluded.length > 0) {
    w.spacer(6);
    w.text("Not included in this packet", { size: 10.5, bold: true, color: MUTED, gap: 4 });
    for (const p of excluded) {
      const reason = p.finding
        ? STATUS_LABEL[p.finding.status]
        : "Not yet analyzed — run Analyze My Evidence again, then re-download to include it.";
      w.text(`• ${p.doc.fileName} — ${reason}`, { size: 9.5, color: MUTED, gap: 2 });
    }
  }

  // ---- County filing instructions ----
  const countyInfo = getCountyProtestInfo(property.cad);
  if (countyInfo) {
    w.spacer(10);
    w.rule();
    w.text("How to Submit to Your County", { size: 12, bold: true, color: ACCENT, gap: 6 });
    if (countyInfo.filingMethod.online) {
      w.text("Online:", { size: 10.5, bold: true, gap: 1 });
      w.text(countyInfo.filingMethod.online.url, { size: 10, gap: 1 });
      if (countyInfo.filingMethod.online.notes)
        w.text(countyInfo.filingMethod.online.notes, { size: 9.5, color: MUTED, gap: 4 });
    }
    if (countyInfo.filingMethod.mail) {
      w.text("Mail:", { size: 10.5, bold: true, gap: 1 });
      w.text(countyInfo.filingMethod.mail.address, { size: 10, gap: 4 });
    }
    if (countyInfo.filingMethod.inPerson) {
      w.text("In Person:", { size: 10.5, bold: true, gap: 1 });
      w.text(countyInfo.filingMethod.inPerson.address, { size: 10, gap: 4 });
    }
    if (countyInfo.filingMethod.email.available && countyInfo.filingMethod.email.address) {
      w.text("Email:", { size: 10.5, bold: true, gap: 1 });
      w.text(countyInfo.filingMethod.email.address, { size: 10, gap: 4 });
    }
  } else {
    w.spacer(10);
    w.text(
      "No confirmed filing-method details are on file for this county yet — check your " +
        "appraisal district's website or notice for how to submit this packet.",
      { size: 9.5, color: MUTED },
    );
  }

  // ---- Each included document: a divider page, then its real pages ----
  for (const [i, { doc, finding }] of included.entries()) {
    const div = await PageWriter.create(packet);
    div.text(`Document ${i + 1} of ${included.length}`, { size: 9.5, color: MUTED, gap: 2 });
    div.text(doc.fileName, { size: 16, bold: true, gap: 4 });
    div.text(STATUS_LABEL[finding.status], { size: 10, color: ACCENT, gap: 10 });
    if (finding.assessment) {
      div.text("AI Assessment (review before relying on it):", { size: 9.5, bold: true, gap: 2 });
      div.text(finding.assessment, { size: 10, color: MUTED });
    }

    try {
      await appendDocument(packet, doc);
    } catch (err) {
      div.spacer(10);
      div.text(
        `Could not include this file's actual pages in the packet (${err instanceof Error ? err.message : "unreadable file"}). ` +
          "Download it separately and attach it yourself.",
        { size: 9.5, color: rgb(0.6, 0.15, 0.15) },
      );
    }
  }

  return packet.save();
}

// Appends one real document's own content — every page of an uploaded PDF
// (copied, not re-rendered), or one full page for an uploaded image. Throws
// for anything else (an unsupported image format, a corrupt file) so the
// caller can note it plainly instead of silently dropping it.
async function appendDocument(packet: PDFDocument, doc: DocumentRecord): Promise<void> {
  const url = await getDocumentUrl(doc.storagePath);
  const res = await fetch(url);
  if (!res.ok) throw new Error("could not download this file");
  const blob = await res.blob();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mimeType = blob.type || "";
  const isPdf = mimeType.includes("pdf") || /\.pdf$/i.test(doc.fileName);
  const isJpeg =
    mimeType.includes("jpeg") || mimeType.includes("jpg") || /\.jpe?g$/i.test(doc.fileName);
  const isPng = mimeType.includes("png") || /\.png$/i.test(doc.fileName);

  if (isPdf) {
    const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await packet.copyPages(source, source.getPageIndices());
    for (const page of pages) packet.addPage(page);
    return;
  }

  if (isJpeg || isPng) {
    const image = isJpeg ? await packet.embedJpg(bytes) : await packet.embedPng(bytes);
    const maxW = PAGE_WIDTH - MARGIN * 2;
    const maxH = PAGE_HEIGHT - MARGIN * 2;
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const w = image.width * scale;
    const h = image.height * scale;
    const page = packet.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawImage(image, {
      x: (PAGE_WIDTH - w) / 2,
      y: (PAGE_HEIGHT - h) / 2,
      width: w,
      height: h,
    });
    return;
  }

  throw new Error(`unsupported file type "${mimeType || "unknown"}"`);
}
