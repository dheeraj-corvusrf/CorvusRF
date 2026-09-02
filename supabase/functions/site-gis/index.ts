// Deploy via CLI: `supabase functions deploy site-gis`.
// No secrets required — both upstream sources are free, public, keyless federal
// GIS services. Proxied server-side (not called directly from the browser) purely
// because neither sets an Access-Control-Allow-Origin header — confirmed live,
// there's no API key or rate limit to protect here.
//
// Returns REAL point-in-place site facts for the "Site Condition" AI module (4):
// - FEMA NFHL flood zone at the given lat/lng (National Flood Hazard Layer).
// - USGS ground elevation at the given lat/lng (Elevation Point Query Service).
// Both are single-point facts, not a parcel-wide assessment — this app has no
// parcel boundary polygon for any property, so there's no honest way to compute
// e.g. "% of the site in the floodplain." A point either falls in a mapped flood
// zone or it doesn't; that's the ceiling of what's real here. See
// ai-report-modules/index.ts's MODULE_SPECS.site for how this feeds the module,
// and the "never fabricate" enforcement in enforceSiteFactorRealData there.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Content-Type": "application/json",
};

type SiteGisInput = { lat?: number; lng?: number };

type SiteGisResult = {
  floodZone: { zone: string; label: string; inSFHA: boolean } | null;
  elevationFt: number | null;
};

// Standard FEMA NFHL zone-code meanings — kept here as one canonical lookup so
// the label is worded consistently everywhere, rather than left to the AI to
// phrase (and potentially get wrong) on every call. See
// https://www.fema.gov/glossary/flood-zones for the official definitions.
const FLOOD_ZONE_LABELS: Record<string, string> = {
  X: "Minimal Flood Hazard",
  "X (SHADED)": "0.2% Annual Chance Flood Hazard",
  A: "1% Annual Chance Flood Hazard (Special Flood Hazard Area)",
  AE: "1% Annual Chance Flood Hazard (Special Flood Hazard Area)",
  AH: "1% Annual Chance Flood Hazard, Shallow Ponding (Special Flood Hazard Area)",
  AO: "1% Annual Chance Flood Hazard, Sheet Flow (Special Flood Hazard Area)",
  AR: "Area of Reduced Flood Risk From a Decertified Levee (Special Flood Hazard Area)",
  A99: "1% Annual Chance Flood Hazard, To Be Protected by a Federal Levee (Special Flood Hazard Area)",
  V: "Coastal High Hazard Area (Special Flood Hazard Area)",
  VE: "Coastal High Hazard Area (Special Flood Hazard Area)",
  D: "Undetermined Flood Risk — Not Studied",
};

function floodZoneLabel(zone: string): string {
  return FLOOD_ZONE_LABELS[zone] ?? `FEMA Flood Zone ${zone}`;
}

async function fetchFloodZone(lat: number, lng: number): Promise<SiteGisResult["floodZone"]> {
  const url =
    `https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query` +
    `?geometry=${lng},${lat}&geometryType=esriGeometryPoint&inSR=4326` +
    `&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,SFHA_TF` +
    `&returnGeometry=false&f=json`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as {
    features?: Array<{ attributes?: Record<string, unknown> }>;
  };
  const attrs = json.features?.[0]?.attributes;
  const zone = typeof attrs?.FLD_ZONE === "string" ? attrs.FLD_ZONE.trim() : null;
  if (!zone) return null;
  return {
    zone,
    label: floodZoneLabel(zone),
    inSFHA: attrs?.SFHA_TF === "T",
  };
}

async function fetchElevationFt(lat: number, lng: number): Promise<number | null> {
  const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Feet&wkid=4326&includeDate=false`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as { value?: number | string };
  const value = typeof json.value === "string" ? Number(json.value) : json.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const empty: SiteGisResult = { floodZone: null, elevationFt: null };

  try {
    const input = (await req.json()) as SiteGisInput;
    if (typeof input.lat !== "number" || typeof input.lng !== "number") {
      return new Response(JSON.stringify(empty), { status: 200, headers: corsHeaders });
    }

    // Each source is independently tolerant of failure — a dead/slow FEMA
    // endpoint should never take the elevation result down with it, and
    // vice versa. Real value or null either way, never a guess.
    const [floodResult, elevationResult] = await Promise.allSettled([
      fetchFloodZone(input.lat, input.lng),
      fetchElevationFt(input.lat, input.lng),
    ]);

    const result: SiteGisResult = {
      floodZone: floodResult.status === "fulfilled" ? floodResult.value : null,
      elevationFt: elevationResult.status === "fulfilled" ? elevationResult.value : null,
    };
    return new Response(JSON.stringify(result), { status: 200, headers: corsHeaders });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "unknown error" }),
      { status: 500, headers: corsHeaders },
    );
  }
});
