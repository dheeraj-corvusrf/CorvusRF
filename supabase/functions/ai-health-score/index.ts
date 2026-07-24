// Deploy via CLI: `supabase functions deploy ai-health-score`.
// Requires the GEMINI_API_KEY secret (shared with classify-document/ask-about-document/route-intent).
//
// No Supabase auth check — same known-risk pattern already accepted for the other
// guest-accessible AI functions (classify-document, ask-about-document, route-intent):
// a rate-limited free API, no per-user state at stake.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type HealthScoreInput = {
  address?: string;
  cad?: string;
  propertyType?: string;
  landValue?: number;
  improvementValue?: number;
  totalValue?: number;
  taxYear?: number;
};

const SYSTEM = `You are CorvusRF's AI property tax analyst for Texas commercial properties.
Given the property's official CAD (county appraisal district) record below, produce a
"protest opportunity" health score from 0 to 100 (higher = stronger opportunity to
protest and potentially reduce the assessed value), a one-sentence summary, and 2-4
short supporting factors.

Base your reasoning only on what a CAD record alone can reasonably suggest — the ratio
of land value to improvement value, whether the total value looks high for the stated
property type, and general Texas commercial appraisal practice. Do NOT invent specific
comparable sales, specific square footage, or other facts not given below — if you
don't have enough information for a factor, say so instead of fabricating a number.

Return ONLY a JSON object: {"score": <0-100 integer>, "summary": "<one sentence>",
"factors": ["<short factor>", ...]}`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const input = (await req.json()) as HealthScoreInput;
    if (!input.totalValue) {
      return new Response(JSON.stringify({ error: "totalValue is required" }), {
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

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
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
    let parsed: { score?: number; summary?: string; factors?: string[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score) || 0)));
    const summary = parsed.summary ?? "AI could not generate a summary for this property.";
    const factors = Array.isArray(parsed.factors) ? parsed.factors.slice(0, 4) : [];

    return new Response(JSON.stringify({ score, summary, factors }), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
