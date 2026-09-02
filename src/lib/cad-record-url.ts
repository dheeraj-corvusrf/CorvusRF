import type { CadRecord } from "./cad-lookup";

// A link to the property's real, official county record — lets a user
// independently verify what this app shows (owner, values, account number)
// against the source of truth itself, and is especially useful when
// disambiguating multiple accounts at the same address (see cad-lookup.ts's
// "multiple" result).
//
// Six counties get a REAL deep link straight to the specific account, since
// their URL format is confirmed (not guessed):
//   - Bexar: verified directly against a real record a user shared
//     (bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id=...).
//     cid=110 is Bexar's own fixed client ID on the TrueAutomation platform,
//     not something derived per-property.
//   - Dallas: the exact account-detail path this app's own enrichDallas()
//     already fetches server-side (AcctDetailCom.aspx — the commercial
//     variant, matching this app's commercial-only scope; see
//     DALLAS_DETAIL_PATHS in supabase/functions/cad-lookup/index.ts).
//   - Denton, Tarrant, Montgomery, Travis: same underlying TrueProdigy/
//     ProdigyCAD platform this app's own cad-comps already uses for their
//     backend data (see texas_cad_vendor_landscape) — confirmed live by
//     actually searching each county's public site for a real account
//     (Denton 34086, Tarrant 41054806, Montgomery 167662, Travis 230964) and
//     following the result through to its detail page:
//     {site}/property-detail/{accountNumber}. Travis's portal lives on its
//     own subdomain (travis.prodigycad.com) rather than under traviscad.org
//     itself — easy to miss if you only check the county's main domain, as
//     an earlier pass here did before this was corrected.
//
// Every other county only gets that CAD's general property-search homepage
// (a real, verified domain — not a guessed deep-link route this app has
// never actually confirmed works) rather than a specific-record URL nobody's
// checked. Better an honest "search here yourself" than a link that might
// silently 404 or land on the wrong page.
export const CAD_SEARCH_HOMEPAGE: Record<string, string> = {
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

// The 3 TrueProdigy-platform counties (see the comment above) all share the
// identical {base}/property-detail/{accountNumber} shape — just a different
// base per county's own public site.
const PRODIGYCAD_DETAIL_BASE: Record<string, string> = {
  "Denton Central Appraisal District": "https://www.dentoncad.com",
  "Tarrant Appraisal District": "https://tarrant.prodigycad.com",
  "Montgomery Central Appraisal District": "https://mcad-tx.org",
  "Travis Central Appraisal District": "https://travis.prodigycad.com",
};

export function getCadRecordUrl(record: Pick<CadRecord, "cad" | "accountNumber">): string | null {
  if (!record.accountNumber) return CAD_SEARCH_HOMEPAGE[record.cad] ?? null;

  if (record.cad === "Bexar Appraisal District") {
    return `https://bexar.trueautomation.com/clientdb/Property.aspx?cid=110&prop_id=${encodeURIComponent(record.accountNumber)}`;
  }
  if (record.cad === "Dallas Central Appraisal District") {
    return `https://www.dallascad.org/AcctDetailCom.aspx?ID=${encodeURIComponent(record.accountNumber)}`;
  }
  const prodigyBase = PRODIGYCAD_DETAIL_BASE[record.cad];
  if (prodigyBase) {
    return `${prodigyBase}/property-detail/${encodeURIComponent(record.accountNumber)}`;
  }
  return CAD_SEARCH_HOMEPAGE[record.cad] ?? null;
}

// True only for the counties with a real, verified deep link straight to the
// account — used to phrase the link's own label honestly ("View Official CAD
// Record" vs. "Search on {CAD}'s Website") rather than promising a specific
// record every county doesn't actually jump straight to.
export function isDirectCadRecordUrl(cad: string): boolean {
  return (
    cad === "Bexar Appraisal District" ||
    cad === "Dallas Central Appraisal District" ||
    cad in PRODIGYCAD_DETAIL_BASE
  );
}

// Plain county names ("Bexar", not "Bexar Appraisal District") derived from
// CAD_SEARCH_HOMEPAGE's own keys above — the one place this app's actual
// county coverage is enumerated — rather than a second hand-maintained list
// that could silently drift out of sync with it (the same class of bug as
// the $699/$799 pricing mismatch: two copies of one fact, only one updated).
// Used by intake.tsx to tell "this county genuinely isn't supported yet"
// apart from "supported county, just no record found for this address."
export const SUPPORTED_COUNTY_NAMES = new Set(
  Object.keys(CAD_SEARCH_HOMEPAGE).map((cad) =>
    cad.replace(/\s*(Central\s+)?Appraisal District$/i, "").trim(),
  ),
);
