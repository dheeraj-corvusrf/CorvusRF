import type { CadRecord } from "./cad-lookup";

// A link to the property's real, official county record — lets a user
// independently verify what this app shows (owner, values, account number)
// against the source of truth itself, and is especially useful when
// disambiguating multiple accounts at the same address (see cad-lookup.ts's
// "multiple" result).
//
// Two counties get a REAL deep link straight to the specific account, since
// their URL format is confirmed (not guessed):
//   - Bexar: verified directly against a real record a user shared
//     (bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id=...).
//     cid=110 is Bexar's own fixed client ID on the TrueAutomation platform,
//     not something derived per-property.
//   - Dallas: the exact account-detail path this app's own enrichDallas()
//     already fetches server-side (AcctDetailCom.aspx — the commercial
//     variant, matching this app's commercial-only scope; see
//     DALLAS_DETAIL_PATHS in supabase/functions/cad-lookup/index.ts).
//
// Every other county only gets that CAD's general property-search homepage
// (a real, verified domain — not a guessed deep-link route this app has
// never actually confirmed works) rather than a specific-record URL nobody's
// checked. Better an honest "search here yourself" than a link that might
// silently 404 or land on the wrong page.
const CAD_SEARCH_HOMEPAGE: Record<string, string> = {
  "Bexar Appraisal District": "https://bcad.org",
  "Collin Central Appraisal District": "https://www.collincad.org",
  "Dallas Central Appraisal District": "https://www.dallascad.org",
  "Denton Central Appraisal District": "https://www.dentoncad.com",
  "Fort Bend Central Appraisal District": "https://esearch.fbcad.org",
  "Grayson Central Appraisal District": "https://www.graysonappraisal.org",
  "Harris Central Appraisal District": "https://hcad.org",
  "Montgomery Central Appraisal District": "https://mcad-tx.org",
  "Kaufman Central Appraisal District": "https://esearch.kaufman-cad.org",
  "Tarrant Appraisal District": "https://www.tad.org",
  "Travis Central Appraisal District": "https://www.traviscad.org",
  "Williamson Central Appraisal District": "https://search.wcad.org",
};

export function getCadRecordUrl(record: Pick<CadRecord, "cad" | "accountNumber">): string | null {
  if (!record.accountNumber) return CAD_SEARCH_HOMEPAGE[record.cad] ?? null;

  if (record.cad === "Bexar Appraisal District") {
    return `https://bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id=${encodeURIComponent(record.accountNumber)}`;
  }
  if (record.cad === "Dallas Central Appraisal District") {
    return `https://www.dallascad.org/AcctDetailCom.aspx?ID=${encodeURIComponent(record.accountNumber)}`;
  }
  return CAD_SEARCH_HOMEPAGE[record.cad] ?? null;
}

// True only for the counties with a real, verified deep link straight to the
// account — used to phrase the link's own label honestly ("View Official CAD
// Record" vs. "Search on {CAD}'s Website") rather than promising a specific
// record every county doesn't actually jump straight to.
export function isDirectCadRecordUrl(cad: string): boolean {
  return cad === "Bexar Appraisal District" || cad === "Dallas Central Appraisal District";
}
