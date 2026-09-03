// Deterministic "Ready to File" checklist shown before a user can open the
// Notice of Protest form (see PreFilingCheckSection in CaseDetailModal.tsx).
// Every row here is either a real field already on the property/protest
// record, or static app copy — never a guessed or fabricated per-county
// answer. Filing Method (and, when available, ARB Contact) source from
// county-protest-info.ts's real, hand-verified per-county dataset when that
// county has an entry; otherwise this falls back to the app's own honest
// default ("download and deliver it yourself") rather than claiming an
// online/email/mail answer that isn't actually confirmed for that county.
import type { PropertyRecord } from "./properties";
import type { ProtestRecord } from "./protests";
import { getCountyProtestInfo } from "./county-protest-info";

export type PreFilingCheckItem = {
  label: string;
  value: string | null;
  status: "confirmed" | "missing";
  // Blocking rows are this case's own real identity/deadline data — if any
  // are missing, filing shouldn't proceed until they're fixed. Non-blocking
  // rows are static, always-true app copy (the real form, the honest filing-
  // method default) — never "missing" since nothing here is ever guessed.
  blocking: boolean;
};

function row(label: string, value: string | null, blocking: boolean): PreFilingCheckItem {
  return { label, value, status: value ? "confirmed" : "missing", blocking };
}

export function getPreFilingCheck(
  property: PropertyRecord,
  protest: ProtestRecord,
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

  const filingMethodValue = countyInfo?.filingMethod.portalUrl
    ? `File online at ${countyInfo.filingMethod.portalUrl}`
    : countyInfo?.filingMethod.address
      ? `Mail or deliver to ${countyInfo.filingMethod.address}`
      : // No verified per-county entry yet — the app's own honest default
        // (see DocumentsSection's "download or deliver this PDF" copy),
        // never a guessed online/mail/email answer.
        "Download and deliver to your county";

  const items: PreFilingCheckItem[] = [
    row("County", property.cad, true),
    row("Property Address", property.address, true),
    row("Account Number", property.accountNumber, true),
    row("Tax Year", taxYear != null ? String(taxYear) : null, true),
    row("Owner / Entity", property.ownerName, true),
    row("Protest Deadline", deadline, true),
    row("Property Type", property.propertyType ?? "Not on file", false),
    row("Applicable Form", "Comptroller Form 50-132 — Notice of Protest", false),
    row("Filing Method", filingMethodValue, false),
    row("Signature Required", "Yes — property owner or authorized agent", false),
  ];

  const arbContact = countyInfo?.arbContact;
  if (arbContact && (arbContact.phone || arbContact.email)) {
    items.push(
      row("ARB Contact", [arbContact.phone, arbContact.email].filter(Boolean).join(" · "), false),
    );
  }

  return items;
}

export function isPreFilingBlocked(items: PreFilingCheckItem[]): boolean {
  return items.some((i) => i.blocking && i.status === "missing");
}
