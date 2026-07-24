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
};

const STRATEGIES = ["Market Value", "Unequal Appraisal", "Condition-Based Reduction", "Combined Approach"];

const PREAMBLE = `You are CorvusRF's AI property tax analyst for Texas commercial properties.
Given only the official CAD (county appraisal district) record below, generate the requested
report module.

Reason only from what's given plus general knowledge of Texas commercial property appraisal
practice. Do NOT invent specific comparable sale prices, specific building square footage,
specific site defects, or a specific effective age — none of that was provided. Where this
module would normally need data this record doesn't include (actual comparable sales, a site
inspection, a building condition survey), give general guidance and a checklist of what to
gather instead of fabricated specific findings.`;

type ModuleSpec = { instruction: string; schema: string; parse: (parsed: any) => unknown };

const checklist = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 4) : [];

const MODULE_SPECS: Record<string, ModuleSpec> = {
  strategy: {
    instruction: "Recommend the single best-fit protest strategy for this record.",
    schema: `{"recommendation": "<one of: ${STRATEGIES.join(" | ")}>", "rationale": "<1-2 sentences>"}`,
    parse: (p) => ({
      recommendation:
        typeof p.recommendation === "string" && STRATEGIES.includes(p.recommendation)
          ? p.recommendation
          : "Combined Approach",
      rationale: p.rationale ?? "",
    }),
  },
  comps: {
    instruction:
      "Give guidance on comparable-sale and equity-comp evidence relevant to this property type and county.",
    schema: `{"guidance": "<1-2 sentences>", "checklist": ["<short item>", ...]}`,
    parse: (p) => ({ guidance: p.guidance ?? "", checklist: checklist(p.checklist) }),
  },
  site: {
    instruction: "Give guidance on site-condition factors (access, drainage, easements) worth documenting.",
    schema: `{"guidance": "<1-2 sentences>", "checklist": ["<short item>", ...]}`,
    parse: (p) => ({ guidance: p.guidance ?? "", checklist: checklist(p.checklist) }),
  },
  improvement: {
    instruction:
      "Give guidance on building condition / functional obsolescence factors worth documenting.",
    schema: `{"guidance": "<1-2 sentences>", "checklist": ["<short item>", ...]}`,
    parse: (p) => ({ guidance: p.guidance ?? "", checklist: checklist(p.checklist) }),
  },
  zoning: {
    instruction:
      "Assess whether the stated property type and typical CAD classification appear consistent.",
    schema: `{"assessment": "<1-2 sentences>"}`,
    parse: (p) => ({ assessment: p.assessment ?? "" }),
  },
  evidence: {
    instruction: "Produce a prioritized evidence checklist for the protest packet.",
    schema: `{"checklist": ["<short item>", ...]}`,
    parse: (p) => ({ checklist: checklist(p.checklist) }),
  },
  savings: {
    instruction: "Estimate a plausible value-reduction percent and the typical effective tax rate.",
    schema: `{"reductionPct": <integer 0-30>, "effectiveTaxRatePct": <number>, "rationale": "<1 sentence>"}`,
    parse: (p) => ({
      reductionPct: Math.max(0, Math.min(30, Math.round(Number(p.reductionPct) || 0))),
      effectiveTaxRatePct: Math.max(0, Math.min(5, Number(p.effectiveTaxRatePct) || 2.5)),
      rationale: p.rationale ?? "",
    }),
  },
  executive: {
    instruction: "Write the final executive recommendation, basis, and next step.",
    schema: `{"recommendation": "<1 sentence>", "basis": "<1 sentence>", "nextStep": "<1 sentence>"}`,
    parse: (p) => ({
      recommendation: p.recommendation ?? "",
      basis: p.basis ?? "",
      nextStep: p.nextStep ?? "",
    }),
  },
};

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
    const spec = input.moduleId ? MODULE_SPECS[input.moduleId] : undefined;
    if (!spec) {
      return new Response(JSON.stringify({ error: "unknown or missing moduleId" }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const record = [
      input.address && `Address: ${input.address}`,
      input.cad && `Appraisal district: ${input.cad}`,
      input.propertyType && `Property type: ${input.propertyType}`,
      input.taxYear && `Tax year: ${input.taxYear}`,
      input.landValue != null && `Land value: $${input.landValue.toLocaleString()}`,
      input.improvementValue != null &&
        `Improvement value: $${input.improvementValue.toLocaleString()}`,
      `Total assessed value: $${input.totalValue.toLocaleString()}`,
    ]
      .filter(Boolean)
      .join("\n");

    const system = `${PREAMBLE}\n\n${spec.instruction}\n\nReturn ONLY a JSON object with exactly this shape:\n${spec.schema}`;

    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: record }] }],
      generationConfig: { responseMimeType: "application/json" },
    };

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429) {
        return new Response(
          JSON.stringify({ error: "AI is rate-limited. Please retry in a moment." }),
          { status: 429, headers: corsHeaders },
        );
      }
      throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    // deno-lint-ignore no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const result = spec.parse(parsed ?? {});
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
