import { fileToDataUrl } from "./intake-store";
import { invokeEdgeFunction } from "./edge-functions";

// Real, just-picked Files in (before upload — no storage round-trip needed,
// unlike protest-reason.ts's functions which read back already-uploaded
// documents), a real AI match against the property's own current evidence
// checklist out. See categorize-evidence-upload/index.ts for the prompt/
// discipline — matchedItem is always either the exact checklist item text
// or null, never an invented category.
const MAX_DOCS = 8;
const MAX_BYTES_PER_DOC = 8 * 1024 * 1024;

export type EvidenceCategorization = { fileName: string; matchedItem: string | null };

// Skips categorization entirely (returns every file uncategorized) rather
// than throwing, when there's nothing real to match against or every file
// is over the size cap — the caller falls back to its existing generic
// upload behavior in that case, same "never block on an AI feature" spirit
// as everywhere else this app calls Gemini.
export async function categorizeEvidenceUploads(
  checklistItems: string[],
  files: File[],
): Promise<EvidenceCategorization[]> {
  const fallback = () => files.map((f) => ({ fileName: f.name, matchedItem: null }));
  if (checklistItems.length === 0 || files.length === 0) return fallback();

  const usable = files.slice(0, MAX_DOCS).filter((f) => f.size <= MAX_BYTES_PER_DOC);
  if (usable.length === 0) return fallback();

  const documents = await Promise.all(
    usable.map(async (f) => ({
      fileName: f.name,
      mimeType: f.type || "application/octet-stream",
      dataUrl: await fileToDataUrl(f),
    })),
  );

  try {
    const { findings } = await invokeEdgeFunction<{ findings: EvidenceCategorization[] }>(
      "categorize-evidence-upload",
      { items: checklistItems, documents },
    );
    // Any file skipped above (too large, or beyond MAX_DOCS) still gets a
    // real entry — uncategorized, not silently dropped from the result.
    const byName = new Map(findings.map((f) => [f.fileName, f.matchedItem]));
    return files.map((f) => ({ fileName: f.name, matchedItem: byName.get(f.name) ?? null }));
  } catch {
    // A failed categorization call shouldn't block the actual upload —
    // callers just get every file back uncategorized and proceed with the
    // existing generic tag.
    return fallback();
  }
}
