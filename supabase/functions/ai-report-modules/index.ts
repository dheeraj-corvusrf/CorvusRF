// Deploy via CLI: `supabase functions deploy ai-report-modules`.
// Requires the GEMINI_API_KEY secret (shared with the other AI functions).
//
// Covers modules 2, 3, 4, 5, 6, 8, 9, 10 (module 1 — health score — is its own
// function, ai-health-score; module 7 — income approach — genuinely needs a
// user-uploaded P&L/rent roll and stays a static gate in the client, not an AI call).
//
// One Gemini call per invocation covers exactly ONE module (selected via the
// `moduleId` field) rather than all eight at once — the client only calls this when
// the user clicks "Unlock preview" on that specific module, so tokens are only spent
// on modules the user actually opens.
//
// Also handles a second request shape — `question` set — used by the per-module
// Q&A box (see askModuleQuestion() in src/lib/ai-report-modules.ts): one grounded
// answer to a free-text follow-up about a module, reusing the same record-building
// and Gemini-call plumbing rather than a separate function.
//
// No Supabase auth check — same known-risk pattern already accepted for the other
// guest-accessible AI functions.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type ModulesInput = {
  moduleId?: string;
  address?: string;
  cad?: string;
  propertyType?: string;
  landValue?: number;
  improvementValue?: number;
  totalValue?: number;
  taxYear?: number;
  // Only read for moduleId "improvement" — property photos/documents as base64 data
  // URLs, already fetched client-side from a signed URL only the owning user could
  // obtain (same trust boundary as classify-document, which also accepts arbitrary
  // uploaded file bytes with no auth check).
  evidenceImages?: { mimeType?: string; dataUrl?: string }[];
  // Real signals computed client-side and passed through verbatim into the prompt
  // record — see buildRecord() below. None of this is fabricated server-side; it's
  // the same real comps/ratio-study/value-trend data other parts of the app already
  // compute (cad-comps.ts, texas-tax-rates.ts), just also handed to the Strategy
  // module (and, via priorityContext, to modules 3-7) so its reasoning is grounded
  // in more than the bare CAD record.
  compsSummary?: { median: number; min: number; max: number; count: number } | null;
  assessmentRatio?: { medianPct: number; cod: number; codOverCeiling: number } | null;
  valueTrend?: { jumpTriggered: boolean; jumpPct: number | null } | null;
  evidenceFileNames?: string[];
  // Module 2's own per-strategy scores, sent when calling comps/site/improvement/
  // zoning so their guidance stays consistent with — and prioritized by — the
  // Strategy module's ranking. See loadModule()'s sequencing in ai-report.tsx.
  priorityContext?: { strategy: string; score: number }[];
  // Only for moduleId "comps" — the real top-5-by-similarity comps
  // computeComparableStats() already ranked client-side (see
  // comps-analysis.ts), so recommendedUse below can name specific real
  // properties instead of speaking only in generalities. Every field here
  // is a real CAD-record value; nothing invented server-side.
  topComps?: {
    address: string;
    distanceMi: number;
    marketValue: number | null;
    similarity: number;
  }[];
  // Only for moduleId "executive" — real outputs Modules 2/3/8/9 already
  // computed client-side (never regenerated here), so the executive module
  // can actually reconcile them. See loadModule()'s executive branch and its
  // sequencing effect (waits for strategy + evidence to resolve) in
  // ai-report.tsx.
  topStrategies?: {
    name: string;
    primaryReason?: string;
    strengthScore: number;
    whySelected?: string;
    existingEvidence?: string[];
    missingEvidence?: string[];
  }[];
  evidenceReadiness?: {
    criticalMissing: string[];
    importantMissing: string[];
    uploadedCount: number;
  };
  compsIndicated?: {
    min: number;
    median: number;
    max: number;
    gapPct: number | null;
    confidencePct: number | null;
  } | null;
  financialSummary?: {
    savings: number;
    basis: "comps" | "formula";
    reductionPct: number | null;
  } | null;
  preFilingStatus?: { missingBlocking: string[] } | null;
  // Question-mode fields (see Deno.serve below) — when `question` is set, this
  // request is a Q&A follow-up, not a module-analysis request.
  question?: string;
  priorModuleData?: unknown;
};

const PREAMBLE = `You are CorvusPT's AI property tax analyst for Texas commercial properties.
Given only the official CAD (county appraisal district) record below, generate the requested
report module.

Reason only from what's given plus general knowledge of Texas commercial property appraisal
practice. Do NOT invent specific comparable sale prices, specific building square footage,
specific site defects, or a specific effective age — none of that was provided. Where this
module would normally need data this record doesn't include (actual comparable sales, a site
inspection, a building condition survey), give general guidance and a checklist of what to
gather instead of fabricated specific findings.

Writing style: be precise and concise. Short, direct sentences — lead with the concrete fact
(the actual number or detail), never a preamble like "based on the provided information" or
"it should be noted that." Cut hedging and filler ("though a formal analysis should be
performed once...", "based on this minimal information, there is..."); state a limitation
plainly, then the specific next step, not wrapped in soft qualifiers. Every sentence must
carry real information — if a sentence could be deleted without losing a fact, delete it.
Example of the target density: instead of "The provided record contains only a single total
assessed value of $3,100,000 for tax year 2026 without any land/improvement breakdown,
property characteristics, or historical trends. Based on this minimal information, there is
insufficient evidence to confirm a strong protest opportunity, though a formal equity and
market comparison should be performed once detailed CAD data is pulled," write "The record
only shows a 2026 assessed value of $3,100,000, with no land/improvement breakdown, property
details, or historical data. There is not enough information to confirm a strong protest
opportunity. A detailed CAD and market/equity analysis is needed."`;

// The 5 fixed valuation strategies Module 2 ranks, 1:1 with the modules that
// investigate each one (see STRATEGY_MODULE_MAP) — matches the reference design's
// named strategy list exactly. A 6th "Other: <label>" entry is allowed (validated by
// isValidStrategyName below) only for a genuinely distinct argument, never padded to
// hit a count.
const STRATEGY_NAMES = [
  "Comparable Sales",
  "Site Condition",
  "Improvement Condition",
  "Income Approach",
  "Zoning / Classification",
];

const STRATEGY_MODULE_MAP: Record<string, string> = {
  "Comparable Sales": "comps",
  "Site Condition": "site",
  "Improvement Condition": "improvement",
  "Income Approach": "income",
  "Zoning / Classification": "zoning",
};

function isValidStrategyName(name: string): boolean {
  return STRATEGY_NAMES.includes(name) || /^Other: .{1,40}$/.test(name);
}

type ModuleSpec = {
  instruction: string;
  schema: string;
  parse: (parsed: Record<string, unknown>) => unknown;
};

const checklist = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 4) : [];

// Clamps an AI-provided 0-100 score, falling back to a neutral midpoint
// (rather than 0, which would visually read as "no issue found" — the
// opposite of "the AI didn't return a usable number") when missing/invalid.
const score100 = (v: unknown, fallback = 50): number =>
  Math.max(0, Math.min(100, Math.round(Number(v)) || fallback));

const strList = (v: unknown, max: number, len: number): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.slice(0, len))
        .slice(0, max)
    : [];

const str = (v: unknown, len: number): string => (typeof v === "string" ? v.slice(0, len) : "");

const strategies = (v: unknown) =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
        .map((x) => {
          const name = str(x.name, 40);
          return {
            name,
            strengthScore: score100(x.strengthScore),
            primaryReason: str(x.primaryReason, 80),
            whySelected: str(x.whySelected, 300),
            supportingFindings: str(x.supportingFindings, 300),
            valuationRelevance: str(x.valuationRelevance, 200),
            existingEvidence: strList(x.existingEvidence, 6, 100),
            missingEvidence: strList(x.missingEvidence, 6, 100),
            confidencePct: score100(x.confidencePct),
            recommendedInvestigation: str(x.recommendedInvestigation, 200),
            relatedModules: name in STRATEGY_MODULE_MAP ? [STRATEGY_MODULE_MAP[name]] : [],
            dataSufficient: x.dataSufficient !== false,
          };
        })
        .filter((s) => s.name.length > 0 && isValidStrategyName(s.name))
        .sort((a, b) => b.strengthScore - a.strengthScore)
        .slice(0, 6)
    : [];

const evidenceItems = (
  v: unknown,
): { item: string; importance: "High" | "Low"; availability: "High" | "Low" }[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
        .map((x) => ({
          item: String(x.item ?? "").slice(0, 120),
          importance: x.importance === "High" ? ("High" as const) : ("Low" as const),
          availability: x.availability === "High" ? ("High" as const) : ("Low" as const),
        }))
        .filter((x) => x.item.length > 0)
        .slice(0, 6)
    : [];

// Module 10 (executive) parsers — real modules only, so a bad/invented
// relatedModule value from the AI can never deep-link the UI somewhere
// nonsensical.
const RELATED_MODULE_IDS = ["comps", "site", "improvement", "zoning", "income", "evidence"];
const relatedModule = (v: unknown): string | null =>
  typeof v === "string" && RELATED_MODULE_IDS.includes(v) ? v : null;

const RECOMMENDED_ACTIONS = [
  "Proceed with Protest",
  "Proceed with Protest After Completing Recommended Evidence",
  "Additional Information Needed Before Proceeding",
  "Limited Protest Opportunity Based on Available Information",
];
const isValidRecommendedAction = (v: unknown): v is string =>
  typeof v === "string" && RECOMMENDED_ACTIONS.includes(v);

const majorFindings = (
  v: unknown,
): { finding: string; whyItMatters: string; relatedModule: string | null }[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
        .map((x) => ({
          finding: str(x.finding, 100),
          whyItMatters: str(x.whyItMatters, 200),
          relatedModule: relatedModule(x.relatedModule),
        }))
        .filter((x) => x.finding.length > 0)
        .slice(0, 5)
    : [];

const missingInformation = (
  v: unknown,
): { item: string; severity: "Critical" | "Important" | "Supporting" }[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
        .map((x) => ({
          item: str(x.item, 120),
          severity:
            x.severity === "Critical" || x.severity === "Important"
              ? (x.severity as "Critical" | "Important")
              : ("Supporting" as const),
        }))
        .filter((x) => x.item.length > 0)
        .slice(0, 8)
    : [];

const DEFENSE_QA_STATUSES = [
  "Supported",
  "Partially Supported",
  "Evidence Needed",
  "User Input Needed",
];
const defenseQA = (
  v: unknown,
): {
  question: string;
  suggestedAnswer: string;
  status: "Supported" | "Partially Supported" | "Evidence Needed" | "User Input Needed";
  relatedModule: string | null;
}[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
        .map((x) => ({
          question: str(x.question, 160),
          suggestedAnswer: str(x.suggestedAnswer, 300),
          status: DEFENSE_QA_STATUSES.includes(x.status as string)
            ? (x.status as
                "Supported" | "Partially Supported" | "Evidence Needed" | "User Input Needed")
            : ("User Input Needed" as const),
          relatedModule: relatedModule(x.relatedModule),
        }))
        .filter((x) => x.question.length > 0 && x.suggestedAnswer.length > 0)
        .slice(0, 6)
    : [];

const MODULE_SPECS: Record<string, ModuleSpec> = {
  strategy: {
    instruction:
      "Evaluate up to 5 fixed valuation strategies for this property — Comparable Sales, Site " +
      "Condition, Improvement Condition, Income Approach, and Zoning / Classification — plus, " +
      "only if a genuinely distinct argument applies beyond those 5, one additional " +
      '"Other: <label>" entry (do not invent an Other entry just to add a 6th). For EACH ' +
      "strategy, weigh its opportunity magnitude, your confidence in the underlying data, how " +
      "available supporting evidence typically is, how reliable this method is for this property " +
      "type, this property type's relevance to the argument, and the quality of information you " +
      "actually have — blend those into one 0-100 Strategy Strength Score. Rank strategies " +
      "strongest first. For any strategy where you genuinely don't have enough information to " +
      "score it responsibly, set dataSufficient to false and list what's missing rather than " +
      "guessing a number.",
    schema:
      '{"strategies": [{"name": "<Comparable Sales | Site Condition | Improvement Condition | ' +
      'Income Approach | Zoning / Classification | Other: label>", "strengthScore": <integer ' +
      '0-100>, "primaryReason": "<short phrase>", "whySelected": "<ONE short sentence, max ' +
      '~15 words>", "supportingFindings": "<ONE short sentence, max ~15 words>", ' +
      '"valuationRelevance": "<ONE short sentence, max ~12 words>", ' +
      '"existingEvidence": ["<short>", ...], "missingEvidence": ["<short>", ...], ' +
      '"confidencePct": <integer 0-100>, "recommendedInvestigation": "<ONE short sentence, max ' +
      '~12 words>", "dataSufficient": <true|false>}, ...], "topStrategySummary": "<ONE short ' +
      'sentence, max ~15 words, naming the top 1-2 strategies>"}',
    parse: (p) => ({
      strategies: strategies(p.strategies),
      topStrategySummary: str(p.topStrategySummary, 140),
    }),
  },
  comps: {
    instruction:
      "Give guidance on comparable-property and equity-comp evidence relevant to this property " +
      "type and county (Texas is a non-disclosure state — never call anything a 'sale' or imply " +
      "a sale price exists; these are assessed-value comparables). If real top comparable " +
      "properties were given above, also recommend how to use them in the protest: which ones to " +
      "lean on primarily and why (real similarity/distance/value differences only), and any real " +
      "weakness in the comp set to address (e.g. few comps, wide value spread) — never invent a " +
      "property, address, or number not given.",
    schema:
      `{"guidance": "<ONE short sentence, max ~18 words — a headline, the checklist below carries ` +
      `the detail>", "checklist": ["<short item>", ...], "recommendedUse": "<ONE to two short ` +
      `sentences, max ~30 words total — omit/empty string entirely if no real top comps were given ` +
      `above>"}`,
    parse: (p) => ({
      guidance: str(p.guidance, 160),
      checklist: checklist(p.checklist),
      // 320, not the ~200 chars "30 words" implies — confirmed live the
      // model's real two-sentence output regularly ran a bit over its own
      // word-count instruction, and a hard character slice mid-sentence
      // read as a broken/cut-off UI, not just "a bit long." Generous
      // headroom over the target is safer here than a tight truncation.
      recommendedUse: str(p.recommendedUse, 320),
    }),
  },
  site: {
    instruction:
      "Give guidance on site-condition factors (access, drainage, easements) worth documenting. " +
      "Also give an overall 0-100 documentation-priority score for how worthwhile pursuing site-" +
      "condition evidence looks for this specific property (based on its value profile and property " +
      "type — not a claim about a specific defect you haven't observed).",
    schema: `{"guidance": "<ONE short sentence, max ~18 words — a headline, the checklist below carries the detail>", "checklist": ["<short item>", ...], "priorityScore": <integer 0-100>}`,
    parse: (p) => ({
      guidance: str(p.guidance, 160),
      checklist: checklist(p.checklist),
      priorityScore: score100(p.priorityScore),
    }),
  },
  improvement: {
    instruction:
      "Give guidance on building condition / functional obsolescence factors worth documenting. " +
      "Also give an overall 0-100 documentation-priority score for how worthwhile pursuing " +
      "improvement-condition evidence looks for this specific property (based on its value profile " +
      "and property type — not a claim about a specific defect you haven't observed).",
    schema: `{"guidance": "<ONE short sentence, max ~18 words — a headline, the checklist below carries the detail>", "checklist": ["<short item>", ...], "priorityScore": <integer 0-100>}`,
    parse: (p) => ({
      guidance: str(p.guidance, 160),
      checklist: checklist(p.checklist),
      priorityScore: score100(p.priorityScore),
    }),
  },
  zoning: {
    instruction:
      "Assess whether the stated property type and typical CAD classification appear consistent. " +
      "Also state, in 2-4 words, what CAD classification would typically be expected for a property " +
      'like this (e.g. "Commercial - Retail").',
    schema: `{"matches": "<one of: consistent | inconsistent | uncertain>", "assessment": "<ONE short sentence, max ~18 words>", "typicalClassification": "<2-4 words>"}`,
    parse: (p) => {
      const matches = typeof p.matches === "string" ? p.matches : "";
      return {
        matches: (["consistent", "inconsistent", "uncertain"].includes(matches)
          ? matches
          : "uncertain") as "consistent" | "inconsistent" | "uncertain",
        assessment: str(p.assessment, 160),
        typicalClassification: str(p.typicalClassification, 40),
      };
    },
  },
  evidence: {
    instruction:
      "Produce a prioritized evidence checklist for the protest packet. For each item, judge its " +
      "importance to the case (High/Low) and how readily available it typically is to a property " +
      "owner (High/Low) — this powers a priority-quadrant view, so favor items that actually differ " +
      "on these two axes rather than marking everything High/High. importance is High only for an " +
      "item that would materially change the strategy/value argument if missing, Low otherwise; " +
      "availability is High only for something the owner already has or can obtain with no real " +
      "effort (a photo, a bill), Low for something that takes real work to get (a certified " +
      "appraisal, a rent roll). This checklist feeds a real completeness score shown to the user — " +
      "given the same property record, always select the same real evidence types and classify them " +
      "the same way, not a different list each time.",
    schema: `{"items": [{"item": "<short item>", "importance": "<High | Low>", "availability": "<High | Low>"}, ...]}`,
    parse: (p) => ({ items: evidenceItems(p.items) }),
  },
  executive: {
    instruction:
      "You are writing the FINAL conclusion after reviewing this property's complete case — " +
      "not another independent module. Reconcile the real strategy, comparable-value, evidence, " +
      "and financial findings already given in the record above into one recommendation. Name " +
      "real strategies, comps, and evidence items from the record — never invent a different " +
      "one. If the record's own signals genuinely disagree with each other (e.g. a strong " +
      "strategy score alongside missing critical evidence, or a comps range that doesn't support " +
      "the stated savings), say so in conflictNote instead of silently picking a side; leave " +
      "conflictNote null when nothing actually conflicts. Do not guarantee an outcome, a specific " +
      "reduction, or protest success. For defenseQA, generate 4-6 property-specific questions an " +
      "appraisal district or ARB panel would realistically raise against THIS property's specific " +
      "strategy/comps/evidence — not a generic FAQ — each with a fact-based suggested answer " +
      "grounded only in the record. status is a real classification, not a feel — apply this rule " +
      "strictly, in order: Supported only when the record's own evidence/comps/strategy data " +
      "directly and fully backs the answer; Partially Supported when the record backs part of the " +
      "answer but a real gap remains; Evidence Needed when the record names the needed evidence " +
      "item but it isn't yet marked as uploaded/available; User Input Needed when answering fully " +
      "requires a fact this record doesn't contain at all. This score feeds a real readiness gauge " +
      "shown to the user — given the same record, always classify the same way, not a different " +
      "call each time. This page is a visual dashboard, not a report to read top to bottom — every " +
      "text field below is displayed next to real numbers/badges/gauges that already convey the " +
      "figures (score, value, confidence). Never restate a number or fact the record already gave " +
      "you; every field is the shortest possible phrase that adds NEW information a stat tile " +
      "can't show, not a sentence justifying or explaining the stat.",
    schema:
      `{"recommendedAction": "<one of: Proceed with Protest | Proceed with Protest After ` +
      `Completing Recommended Evidence | Additional Information Needed Before Proceeding | ` +
      `Limited Protest Opportunity Based on Available Information>", ` +
      `"recommendationExplanation": "<ONE short sentence, max ~15 words — the single most ` +
      `important reason only, never restating a $ or % figure>", ` +
      `"primaryStrategyExplanation": "<max ~10 words, a short phrase not a sentence — why this ` +
      `strategy, in a few words, or null if none is clearly supported>", ` +
      `"secondaryStrategyExplanation": "<max ~10 words, or null if no second strategy materially ` +
      `contributes>", ` +
      `"majorFindings": [{"finding": "<short title, max ~6 words>", "whyItMatters": "<max ~8 ` +
      `words>", "relatedModule": "<one of: comps | site | improvement | zoning | income | ` +
      `evidence | null>"}, ...] (3-5 items, most important first), ` +
      `"missingInformation": [{"item": "<short item>", "severity": "<Critical | Important | ` +
      `Supporting>"}, ...] (only real gaps, empty array if none), ` +
      `"recommendedProtestValue": <number, the real indicated value to argue for, or null if not ` +
      `reliably supported by the record>, ` +
      `"recommendedProtestValueBasis": "<max ~10 words, or 'Additional analysis required' if the ` +
      `value above is null>", ` +
      `"nextAction": "<ONE short sentence, max ~12 words, the single most important next step>", ` +
      `"conflictNote": "<1 short sentence describing a genuine conflict between the record's own ` +
      `signals, or null>", ` +
      `"defenseQA": [{"question": "<property-specific likely challenge>", "suggestedAnswer": ` +
      `"<max ~20 words, fact-based, using only the record>", "status": "<one of: Supported | ` +
      `Partially Supported | Evidence Needed | User Input Needed>", "relatedModule": "<one of: ` +
      `comps | site | improvement | zoning | income | evidence | null>"}, ...] (4-6 items)}`,
    parse: (p) => ({
      recommendedAction: isValidRecommendedAction(p.recommendedAction)
        ? p.recommendedAction
        : "Additional Information Needed Before Proceeding",
      recommendationExplanation: str(p.recommendationExplanation, 140),
      primaryStrategyExplanation: str(p.primaryStrategyExplanation, 90) || null,
      secondaryStrategyExplanation: str(p.secondaryStrategyExplanation, 90) || null,
      majorFindings: majorFindings(p.majorFindings),
      missingInformation: missingInformation(p.missingInformation),
      recommendedProtestValue:
        typeof p.recommendedProtestValue === "number" && Number.isFinite(p.recommendedProtestValue)
          ? p.recommendedProtestValue
          : null,
      recommendedProtestValueBasis: str(p.recommendedProtestValueBasis, 90),
      nextAction: str(p.nextAction, 160),
      conflictNote: str(p.conflictNote, 200) || null,
      defenseQA: defenseQA(p.defenseQA),
    }),
  },
};

// Shared by every module call and the Q&A question path — builds the plain-text
// "record" the model reasons over. Each optional block only appears when the
// client actually has that real data (comps fetched, ratio study covers this
// county/category, value history long enough to detect a jump, etc.) — nothing
// here is invented when the underlying data isn't available.
function buildRecord(input: ModulesInput): string {
  const lines: Array<string | false | undefined> = [
    input.address && `Address: ${input.address}`,
    input.cad && `Appraisal district: ${input.cad}`,
    input.propertyType && `Property type: ${input.propertyType}`,
    input.taxYear && `Tax year: ${input.taxYear}`,
    input.landValue != null && `Land value: $${input.landValue.toLocaleString()}`,
    input.improvementValue != null &&
      `Improvement value: $${input.improvementValue.toLocaleString()}`,
    input.totalValue != null && `Total assessed value: $${input.totalValue.toLocaleString()}`,
  ];

  if (input.compsSummary) {
    const c = input.compsSummary;
    lines.push(
      `Real comparable properties found nearby: ${c.count} (market value range ` +
        `$${c.min.toLocaleString()}-$${c.max.toLocaleString()}, median $${c.median.toLocaleString()})`,
    );
  }
  if (input.assessmentRatio) {
    const r = input.assessmentRatio;
    lines.push(
      `County Comptroller ratio study for this property type: median assessment ratio ` +
        `${r.medianPct}%, coefficient of dispersion ${r.cod.toFixed(1)}` +
        (r.codOverCeiling > 0
          ? ` (${r.codOverCeiling.toFixed(1)} points above the IAAO standard)`
          : " (within the IAAO standard)"),
    );
  }
  if (input.valueTrend?.jumpTriggered) {
    lines.push(
      `This property's assessed value jumped ${
        input.valueTrend.jumpPct != null
          ? `${Math.round(input.valueTrend.jumpPct * 100)}%`
          : "significantly"
      } beyond its own historical trend this year.`,
    );
  }
  if (input.evidenceFileNames && input.evidenceFileNames.length > 0) {
    lines.push(
      `Evidence documents already uploaded by the owner: ${input.evidenceFileNames.join(", ")}`,
    );
  }
  if (input.priorityContext && input.priorityContext.length > 0) {
    lines.push(
      `The Protest Strategy module already ranked this property's valuation arguments (0-100 ` +
        `strength scores): ${input.priorityContext.map((p) => `${p.strategy} ${p.score}`).join(", ")}. ` +
        `Weight your analysis and guidance accordingly.`,
    );
  }
  if (input.topComps && input.topComps.length > 0) {
    lines.push(
      `Real top comparable properties, ranked by similarity (use these exact ones by address — ` +
        `never invent a different comparable):\n` +
        input.topComps
          .map(
            (c, i) =>
              `${i + 1}. ${c.address} — ${c.distanceMi.toFixed(1)} mi, ` +
              `${c.marketValue != null ? `$${c.marketValue.toLocaleString()} assessed value` : "value not on file"}, ` +
              `${c.similarity}/100 similarity`,
          )
          .join("\n"),
    );
  }
  if (input.topStrategies && input.topStrategies.length > 0) {
    lines.push(
      `The Protest Strategy module already analyzed this case in full — use these exact real ` +
        `strategies and reasons, never invent a different one:\n` +
        input.topStrategies
          .map(
            (s, i) =>
              `${i + 1}. ${s.name} (strength ${s.strengthScore}/100)` +
              (s.primaryReason ? ` — ${s.primaryReason}` : "") +
              (s.whySelected ? `. Why: ${s.whySelected}` : "") +
              (s.existingEvidence && s.existingEvidence.length > 0
                ? `. Existing evidence: ${s.existingEvidence.join(", ")}`
                : "") +
              (s.missingEvidence && s.missingEvidence.length > 0
                ? `. Missing evidence: ${s.missingEvidence.join(", ")}`
                : ""),
          )
          .join("\n"),
    );
  }
  if (input.evidenceReadiness) {
    const e = input.evidenceReadiness;
    lines.push(
      `The Evidence Builder module already identified the case's real evidence gaps — ` +
        `${e.uploadedCount} file${e.uploadedCount === 1 ? "" : "s"} uploaded so far. ` +
        (e.criticalMissing.length > 0
          ? `Still missing (top priority): ${e.criticalMissing.join(", ")}. `
          : "No top-priority evidence gaps remain. ") +
        (e.importantMissing.length > 0
          ? `Also missing (lower priority): ${e.importantMissing.join(", ")}.`
          : ""),
    );
  }
  if (input.compsIndicated) {
    const c = input.compsIndicated;
    lines.push(
      `The Market Value module's real comparable-property analysis indicates a value range of ` +
        `$${c.min.toLocaleString()}-$${c.max.toLocaleString()} (median $${c.median.toLocaleString()})` +
        (c.gapPct != null
          ? `, ${c.gapPct > 0 ? "above" : "at or below"} this indicated range by ${Math.abs(c.gapPct)}%`
          : "") +
        (c.confidencePct != null ? `, ${c.confidencePct}/100 confidence` : "") +
        ". Use this exact range — never invent a different indicated value.",
    );
  }
  if (input.financialSummary) {
    const f = input.financialSummary;
    lines.push(
      `The Estimated Savings module already calculated a real potential annual tax savings of ` +
        `$${f.savings.toLocaleString()} (${f.basis === "comps" ? "based on real comparable properties" : "based on real county/category adjustments"}` +
        (f.reductionPct != null ? `, ${f.reductionPct}% value reduction` : "") +
        "). Use this exact figure — never recalculate or invent a different savings number.",
    );
  }
  if (input.preFilingStatus) {
    lines.push(
      input.preFilingStatus.missingBlocking.length > 0
        ? `A protest case is on file for this property, but filing is currently blocked on: ` +
            `${input.preFilingStatus.missingBlocking.join(", ")}.`
        : `A protest case is on file for this property and it is ready to file — no blocking ` +
            `information is missing.`,
    );
  }

  return lines.filter((l): l is string => typeof l === "string").join("\n");
}

// Shared Gemini call + JSON-response parsing for both the module-analysis path and
// the Q&A question path. Throws an Error with a `status` property set to 429 when
// Gemini itself is rate-limited, so the caller can propagate that status instead of
// a generic 500.
type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

// No timeout on this fetch at all before this — a slow/hung Gemini response
// just hung the edge function indefinitely, which is what actually surfaced
// as modules stuck on "Analyzing" forever (confirmed live: latency to Gemini
// is genuinely volatile right now — a trivial ping ranged from ~2s to 30s+
// with nothing on our end to explain the difference; this is congestion on
// Gemini's serving infrastructure, not something fixable by a prompt/config
// change here). 20s bounds the worst case to something the client can retry
// against instead of waiting forever — see the 504 handling below and the
// matching retry-on-504 in src/lib/edge-functions.ts (previously only
// retried 429).
const GEMINI_TIMEOUT_MS = 20_000;

async function generateJson(
  apiKey: string,
  system: string,
  parts: GeminiPart[],
  // Bounded, not left dynamic/unset — a fixed budget removes one source of
  // worst-case blowup (an unset budget lets the model choose its own,
  // unpredictable spend) and costs nothing when Gemini is responding
  // normally. This model rejects a budget of exactly 0 with a 400, so 512
  // is the smallest confirmed-working value — the default every module used
  // until "executive" needed real reconciliation across several other
  // modules' outputs plus property-specific Q&A generation, genuinely more
  // reasoning than a single-topic module's short schema.
  thinkingBudget = 512,
): Promise<Record<string, unknown>> {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget },
      // 0, not left at Gemini's default (~1) — several downstream numbers
      // (Module 10's Case Assessment / Defense Readiness gauges) are real
      // deterministic formulas over classification fields the model itself
      // assigns (evidence importance/availability, defenseQA status); at
      // default sampling those classifications visibly drifted between two
      // calls against the *same* underlying record, so a gauge could swing
      // 20+ points with nothing about the actual case having changed. 0
      // makes token selection always-greedy — not a mathematical guarantee
      // of byte-identical output every time, but it removes sampling as a
      // source of variance, leaving only genuine differences in the record
      // fed in to move these numbers.
      temperature: 0,
    },
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      const timeoutErr = new Error("AI response timed out. Please try again.") as Error & {
        status?: number;
      };
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(t);
  }

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) {
      const err = new Error("AI is rate-limited. Please retry in a moment.") as Error & {
        status?: number;
      };
      err.status = 429;
      throw err;
    }
    throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const input = (await req.json()) as ModulesInput;
    if (!input.totalValue) {
      return new Response(JSON.stringify({ error: "totalValue is required" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const record = buildRecord(input);

    // Q&A follow-up path — see askModuleQuestion() in src/lib/ai-report-modules.ts.
    // Grounded in the same record plus whatever analysis that module has already
    // generated (priorModuleData), not a fresh unrelated analysis.
    if (typeof input.question === "string" && input.question.trim()) {
      const priorText =
        input.priorModuleData != null
          ? `\n\nThis module's current analysis (already generated):\n${JSON.stringify(input.priorModuleData).slice(0, 4000)}`
          : "";
      const system =
        `${PREAMBLE}\n\nThe user is looking at the "${input.moduleId ?? "this"}" report module ` +
        "and asked a follow-up question about it. Answer directly in 2-4 sentences, grounded " +
        "only in the record and analysis below plus general knowledge of Texas commercial " +
        "property appraisal practice. If the answer genuinely isn't knowable from what's given, " +
        "say so rather than guessing.\n\nReturn ONLY a JSON object with exactly this shape:\n" +
        '{"answer": "<2-4 sentences>"}';
      const parsed = await generateJson(apiKey, system, [
        { text: `${record}${priorText}\n\nQuestion: ${input.question.trim().slice(0, 500)}` },
      ]);
      const answer = typeof parsed.answer === "string" ? parsed.answer.slice(0, 1200) : "";
      return new Response(JSON.stringify({ answer }), { status: 200, headers: corsHeaders });
    }

    const spec = input.moduleId ? MODULE_SPECS[input.moduleId] : undefined;
    if (!spec) {
      return new Response(JSON.stringify({ error: "unknown or missing moduleId" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    // Evidence images are only meaningful for the improvement-condition module —
    // filtered to real image/PDF data URLs and capped defensively even though the
    // client already caps at 4 (defense in depth, not trusting client-side limits).
    const evidenceParts =
      input.moduleId === "improvement" && Array.isArray(input.evidenceImages)
        ? input.evidenceImages
            .filter(
              (e): e is { mimeType: string; dataUrl: string } =>
                !!e.mimeType &&
                !!e.dataUrl &&
                (e.mimeType.startsWith("image/") || e.mimeType === "application/pdf"),
            )
            .slice(0, 4)
            .map((e) => ({
              inline_data: { mime_type: e.mimeType, data: e.dataUrl.split(",", 2)[1] ?? "" },
            }))
        : [];

    let instruction = spec.instruction;
    if (evidenceParts.length > 0) {
      instruction +=
        " Photos and/or documents of the property's actual condition are attached below as " +
        "images — base your assessment specifically on what is visible or stated in them " +
        "(e.g. visible wear, deferred maintenance, damage, renovation quality), citing concrete " +
        "observations, rather than only general guidance. If something isn't visible or stated " +
        "in the attachments, say so rather than guessing.";
    }

    const system = `${PREAMBLE}\n\n${instruction}\n\nReturn ONLY a JSON object with exactly this shape:\n${spec.schema}`;

    const parsed = await generateJson(
      apiKey,
      system,
      [{ text: record }, ...evidenceParts],
      input.moduleId === "executive" ? 1536 : undefined,
    );
    const result = spec.parse(parsed ?? {});
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    const errStatus = (err as { status?: number } | null)?.status;
    const status = errStatus === 429 || errStatus === 504 ? errStatus : 500;
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status, headers: corsHeaders },
    );
  }
});
