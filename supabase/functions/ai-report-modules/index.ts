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
      "Give guidance on comparable-sale and equity-comp evidence relevant to this property type and county.",
    schema: `{"guidance": "<ONE short sentence, max ~18 words — a headline, the checklist below carries the detail>", "checklist": ["<short item>", ...]}`,
    parse: (p) => ({ guidance: str(p.guidance, 160), checklist: checklist(p.checklist) }),
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
      "on these two axes rather than marking everything High/High.",
    schema: `{"items": [{"item": "<short item>", "importance": "<High | Low>", "availability": "<High | Low>"}, ...]}`,
    parse: (p) => ({ items: evidenceItems(p.items) }),
  },
  executive: {
    instruction: "Write the final executive recommendation, basis, and next step.",
    schema: `{"recommendation": "<ONE short sentence, max ~15 words>", "basis": "<ONE short sentence, max ~15 words>", "nextStep": "<ONE short sentence, max ~12 words>"}`,
    parse: (p) => ({
      recommendation: str(p.recommendation, 140),
      basis: str(p.basis, 140),
      nextStep: str(p.nextStep, 100),
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
): Promise<Record<string, unknown>> {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    // Bounded, not left dynamic/unset — a fixed budget removes one source of
    // worst-case blowup (an unset budget lets the model choose its own,
    // unpredictable spend) and costs nothing when Gemini is responding
    // normally. This model rejects a budget of exactly 0 with a 400, so 512
    // is the smallest confirmed-working value.
    generationConfig: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 512 },
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

    const parsed = await generateJson(apiKey, system, [{ text: record }, ...evidenceParts]);
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
