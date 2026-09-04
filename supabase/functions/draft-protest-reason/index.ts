// Deploy via CLI: `supabase functions deploy draft-protest-reason`.
// Requires the GEMINI_API_KEY secret (shared with classify-document,
// ask-about-document).
//
// Reads the user's own uploaded evidence documents (rent roll, appraisal
// report, comps, photos, etc.) and drafts a suggested paragraph for Form
// 50-132's "Facts that may help resolve this protest" field — the one
// piece of the Notice of Protest that's genuinely free text, not something
// getNoticeOfProtestDefaults() can already fill from real case data alone.
// Same real Gemini multimodal pattern as classify-document (inline_data
// per file, temperature 0), but the output here is prose the CUSTOMER
// still reviews, edits, and signs — never inserted or submitted
// automatically. See PdfFormEditor.tsx's "Generate Suggested Reason"
// button, which is the only thing that calls this.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

const MAX_DOCS = 5;

const SYSTEM = `You are CorvusPT's Texas property tax protest assistant. The user has uploaded evidence documents (e.g. a rent roll, an independent appraisal, comparable sales/equity data, a property condition assessment, photos of damage) for a property they are protesting the appraised value of. Draft a single suggested paragraph for the "Facts that may help resolve this protest" field on Texas Comptroller Form 50-132.

Rules:
- Base every claim ONLY on what is actually visible in the case data and the uploaded documents. Never invent a number, date, or fact that isn't actually there.
- If a document is unclear, low quality, or doesn't obviously support a value argument, do not fabricate what it might say — omit it rather than guess.
- If none of the documents provide anything usable, say so plainly instead of writing a generic paragraph — do not manufacture filler.
- Write in the voice of the property owner making their own case ("The property's..." / "Comparable properties..."), not as an AI describing the documents.
- Plain prose only — no markdown, no bullet points, no headers, no quotation marks around the whole thing.
- This is a SUGGESTION the property owner will review and can edit before signing — do not claim certainty beyond what the documents actually show.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { property, documents } = await req.json();
    if (!Array.isArray(documents) || documents.length === 0) {
      return new Response(JSON.stringify({ error: "At least one document is required." }), {
        status: 400,
        headers: corsHeaders,
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

    const contextLines = [
      property?.address ? `Property address: ${property.address}` : null,
      property?.cad ? `Appraisal district: ${property.cad}` : null,
      property?.taxYear ? `Tax year: ${property.taxYear}` : null,
      property?.totalValue ? `Current assessed value: $${property.totalValue}` : null,
      property?.strategyRecommendation
        ? `Case strategy on file: ${property.strategyRecommendation}`
        : null,
    ].filter(Boolean);

    const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [
      {
        text: `Case context:\n${contextLines.length > 0 ? contextLines.join("\n") : "(none on file)"}\n\nDraft the suggested paragraph from the ${documents.length} document(s) below.`,
      },
    ];
    for (const doc of documents.slice(0, MAX_DOCS)) {
      const base64 = String(doc.dataUrl ?? "").split(",", 2)[1] ?? "";
      if (!base64) continue;
      parts.push({ inline_data: { mime_type: doc.mimeType, data: base64 } });
    }

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0 },
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
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    return new Response(JSON.stringify({ text }), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
