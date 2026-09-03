// Deterministic "Ready to File" checklist — the blocking gate Corvus runs
// before a user can open the Notice of Protest form (see
// PreFilingCheckSection in CaseDetailModal.tsx). Every row here is either a
// real field already on the property/protest/evidence records, or a real,
// hand-verified per-county fact from county-protest-info.ts — never a
// guessed or fabricated answer. Where a fact genuinely isn't verified for a
// county, the row honestly says "Not confirmed" rather than assuming a
// typical answer.
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import type { EvidenceItemRecord } from "./protest-case";
import { getCountyProtestInfo } from "./county-protest-info";

export type PreFilingCheckItem = {
  label: string;
  value: string | null;
  status: "confirmed" | "missing";
  // Blocking rows are this case's own real identity/deadline data — if any
  // are missing, filing stops until they're fixed (isPreFilingBlocked /
  // PreFilingCheckSection enforce this). Non-blocking rows are informational
  // — procedural facts that are either always-true app copy or a real,
  // possibly-unconfirmed per-county answer — never treated as a reason to
  // stop filing, since the app's own generic form/instructions remain a
  // valid fallback even when a specific county detail isn't confirmed.
  blocking: boolean;
};

function row(label: string, value: string | null, blocking: boolean): PreFilingCheckItem {
  return { label, value, status: value ? "confirmed" : "missing", blocking };
}

function yesNo(value: boolean | null, whenTrue: string, whenFalse: string): string {
  if (value === true) return whenTrue;
  if (value === false) return whenFalse;
  return "Not confirmed";
}

export function getPreFilingCheck(
  property: PropertyRecord,
  protest: ProtestRecord,
  evidenceItems?: EvidenceItemRecord[],
): PreFilingCheckItem[] {
  // protestDeadline is a date-only string ("2026-05-15") — parsing it as-is
  // is interpreted as UTC midnight, which toLocaleDateString then renders in
  // the browser's local timezone, rolling the displayed date back a full day
  // for anyone west of UTC (confirmed live: "2026-05-15" rendered as "May
  // 14"). Appending a local time-of-day avoids the UTC interpretation
  // entirely, regardless of the viewer's timezone.
  const deadline = property.protestDeadline
    ? new Date(`${property.protestDeadline}T00:00:00`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  const taxYear = protest.taxYear ?? property.taxYear;
  const countyInfo = getCountyProtestInfo(property.cad);
  const filingMethod = countyInfo?.filingMethod ?? null;
  const mailOrInPerson = filingMethod?.mail ?? filingMethod?.inPerson ?? null;

  const filingMethodValue = filingMethod?.online
    ? `Online — ${filingMethod.online.url}`
    : mailOrInPerson
      ? `Mail or deliver to ${mailOrInPerson.address}`
      : // No verified per-county entry yet — the app's own honest default
        // (see DocumentsSection's "download or deliver this PDF" copy),
        // never a guessed online/mail/email answer.
        "Download and deliver to your county";

  const evidenceStatus = !evidenceItems
    ? null
    : evidenceItems.length === 0
      ? "Not generated yet"
      : `${evidenceItems.filter((i) => i.documents.length > 0).length} of ${evidenceItems.length} uploaded`;

  const contactValue = countyInfo?.arbContact
    ? [countyInfo.arbContact.phone, countyInfo.arbContact.email].filter(Boolean).join(" · ") || null
    : null;

  const items: PreFilingCheckItem[] = [
    row("County", property.cad, true),
    row("Property Address", property.address, true),
    row("Account Number", property.accountNumber, true),
    row("Tax Year", taxYear != null ? String(taxYear) : null, true),
    row("Owner / Entity", property.ownerName, true),
    row("Property Type", property.propertyType ?? "Not on file", false),
    row("Protest Deadline", deadline, true),
    row("Applicable Form", "Comptroller Form 50-132 — Notice of Protest", false),
    row("Filing Method", filingMethodValue, false),
    row("Signature Required", "Yes — property owner or authorized agent", false),
    row(
      "Required Supporting Documents",
      evidenceStatus ?? "Generate a case plan to see your evidence checklist",
      false,
    ),
    row("Applicable County Instructions", countyInfo?.sourceUrl ?? "Not on file", false),
    row(
      "Online Filing Available",
      yesNo(filingMethod ? filingMethod.online != null : null, "Yes", "No"),
      false,
    ),
    row("Email Filing Available", yesNo(filingMethod?.email.available ?? null, "Yes", "No"), false),
    row(
      "Mail / In-Person Filing",
      mailOrInPerson
        ? filingMethod?.online
          ? "Available (alternative to online)"
          : "Required (no confirmed online option)"
        : "Not confirmed",
      false,
    ),
    row("County Contact Information", contactValue ?? "Not confirmed", false),
  ];

  return items;
}

export function isPreFilingBlocked(items: PreFilingCheckItem[]): boolean {
  return items.some((i) => i.blocking && i.status === "missing");
}
