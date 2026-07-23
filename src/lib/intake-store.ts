// Session-scoped intake store for the guest flow.
import { classifyDocument, type Extraction, type DocumentType } from "./document-ai";

export type AuditEntry = {
  ts: number;
  actor: "ai" | "user" | "staff";
  action: string;
  field?: string;
  from?: string | number | null;
  to?: string | number | null;
  reason?: string;
};

export type Workflow =
  | "real_property_protest"
  | "bpp_rendition"
  | "bpp_protest"
  | "tax_payment_tracking"
  | "refund_tracking"
  | "notice_epin_retrieval"
  | "hearing_decision_tracking";

export type WorkflowSuggestion = {
  workflow: Workflow;
  label: string;
  message: string;
  primary: boolean;
};

export type IntakeState = {
  // legacy address flow
  address?: string;
  cad?: string;
  accountNumber?: string;
  ownerName?: string;
  propertyType?: string;
  landValue?: number;
  improvementValue?: number;
  totalValue?: number;
  taxYear?: number;
  noticeFileName?: string;
  confirmed?: boolean;
  previewsUsed: string[];

  // document classification flow
  extraction?: Extraction;
  extractionEdited?: Partial<Extraction>;
  extractionConfirmed?: boolean;
  lowConfidenceFlag?: boolean;
  mismatchFlag?: boolean;
  routedWorkflows?: WorkflowSuggestion[];
  auditLog?: AuditEntry[];
};

const KEY = "crf_intake";

export function readIntake(): IntakeState {
  if (typeof window === "undefined") return { previewsUsed: [] };
  try {
    return JSON.parse(sessionStorage.getItem(KEY) || "") as IntakeState;
  } catch {
    return { previewsUsed: [] };
  }
}

export function writeIntake(state: IntakeState) {
  sessionStorage.setItem(KEY, JSON.stringify(state));
}

export function updateIntake(patch: Partial<IntakeState>): IntakeState {
  const current = readIntake();
  const next: IntakeState = {
    ...current,
    ...patch,
    previewsUsed: current.previewsUsed ?? [],
  };
  writeIntake(next);
  return next;
}

export function appendAudit(entry: Omit<AuditEntry, "ts">) {
  const s = readIntake();
  const log = s.auditLog ?? [];
  log.push({ ts: Date.now(), ...entry });
  return updateIntake({ auditLog: log });
}

export function resetIntake() {
  sessionStorage.removeItem(KEY);
}

// Merge extraction + user edits into the effective confirmed record.
export function effectiveExtraction(s: IntakeState): Extraction | null {
  if (!s.extraction) return null;
  return { ...s.extraction, ...(s.extractionEdited ?? {}) } as Extraction;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.6;

const MAX_FILE_BYTES = 15 * 1024 * 1024;

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsDataURL(file);
  });
}

// Shared by the home page's "Upload Appraisal Notice" button and the /intake upload
// widget so both go through the exact same validation + classification + audit trail.
export async function classifyAndStoreDocument(file: File): Promise<Extraction> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error("Document exceeds 15 MB maximum file size.");
  }
  if (!/pdf|png|jpe?g/i.test(file.type)) {
    throw new Error("Supported types: PDF, PNG, JPG.");
  }

  const dataUrl = await fileToDataUrl(file);
  appendAudit({ actor: "user", action: "upload_document", to: file.name });
  const extraction = await classifyDocument({
    fileName: file.name,
    mimeType: file.type,
    dataUrl,
  });
  appendAudit({
    actor: "ai",
    action: "classify_document",
    to: `${extraction.documentType} (conf ${(extraction.confidence * 100).toFixed(0)}%)`,
  });

  const prior = readIntake();
  const mismatchFlag = detectMismatch(extraction, prior);
  const lowConfidenceFlag = extraction.confidence < LOW_CONFIDENCE_THRESHOLD;
  if (lowConfidenceFlag) appendAudit({ actor: "ai", action: "flag_low_confidence" });
  if (mismatchFlag) appendAudit({ actor: "ai", action: "flag_mismatch" });

  updateIntake({
    noticeFileName: file.name,
    extraction,
    extractionEdited: undefined,
    extractionConfirmed: false,
    lowConfidenceFlag,
    mismatchFlag,
  });

  return extraction;
}

export function detectMismatch(e: Extraction, prior?: IntakeState): boolean {
  if (!prior) return false;
  if (prior.cad && e.cadName && !normalize(e.cadName).includes(normalize(prior.cad).split(" ")[0]))
    return true;
  if (
    prior.accountNumber &&
    e.accountNumber &&
    normalize(e.accountNumber) !== normalize(prior.accountNumber)
  )
    return true;
  return false;
}

function normalize(v: string) {
  return v.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function routeWorkflows(e: Extraction): WorkflowSuggestion[] {
  const out: WorkflowSuggestion[] = [];
  const primaryByType: Record<DocumentType, WorkflowSuggestion | null> = {
    "Real Property Appraisal Notice": {
      workflow: "real_property_protest",
      label: "Real Property Protest",
      message: "Looks like your property value may be protestable. AI can file on your behalf.",
      primary: true,
    },
    "BPP Rendition Form": {
      workflow: "bpp_rendition",
      label: "BPP Rendition",
      message: "Looks like you need to file a BPP rendition before the deadline.",
      primary: true,
    },
    "BPP Appraisal Notice": {
      workflow: "bpp_protest",
      label: "BPP Protest",
      message: "Looks like a business personal property notice. AI can evaluate a protest.",
      primary: true,
    },
    "Tax Bill / Statement": {
      workflow: "tax_payment_tracking",
      label: "Tax Payment Tracking",
      message: "Looks like this is a tax bill. AI will track payment and savings.",
      primary: true,
    },
    "Hearing Notice / ARB": {
      workflow: "hearing_decision_tracking",
      label: "Hearing / Decision Tracking",
      message: "Looks like this is a hearing notice. AI will track the ARB decision.",
      primary: true,
    },
    "Refund Notice": {
      workflow: "refund_tracking",
      label: "Refund Tracking",
      message: "Looks like a refund notice. AI will track the refund to your account.",
      primary: true,
    },
    "EPIN / PIN Notice": {
      workflow: "notice_epin_retrieval",
      label: "Notice / EPIN Retrieval",
      message: "Looks like an EPIN/PIN notice. AI will store it for online filings.",
      primary: true,
    },
    "Exemption Notice": {
      workflow: "real_property_protest",
      label: "Real Property Protest",
      message: "Exemption notice detected. AI will factor exemptions into your valuation review.",
      primary: true,
    },
    Other: null,
  };

  const p = primaryByType[e.documentType];
  if (p) out.push(p);

  if (e.paymentDueDate && p?.workflow !== "tax_payment_tracking") {
    out.push({
      workflow: "tax_payment_tracking",
      label: "Tax Payment Tracking",
      message: "Payment due date detected — AI will track this bill.",
      primary: false,
    });
  }
  if (e.hearingDate && p?.workflow !== "hearing_decision_tracking") {
    out.push({
      workflow: "hearing_decision_tracking",
      label: "Hearing / Decision Tracking",
      message: "Hearing date detected — AI will track the ARB decision.",
      primary: false,
    });
  }
  if (out.length === 0) {
    out.push({
      workflow: "notice_epin_retrieval",
      label: "Manual Review",
      message: "AI could not confidently route this document. CorvusRF staff will review.",
      primary: true,
    });
  }
  return out;
}

export function currency(n?: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function displayVal(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "Data Not Found";
  return String(v);
}
