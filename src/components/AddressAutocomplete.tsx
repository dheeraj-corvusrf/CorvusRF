import { useEffect, useId, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onPlaceSelected?: (formattedAddress: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
};

type Suggestion = {
  id: string;
  label: string;
  // Set only for a Google suggestion — its placeId, used by selectSuggestion()
  // to fetch the zip-inclusive final address via a Place Details call (Google's
  // Autocomplete predictions don't include a postal code, only Place Details
  // does). Absent for a Nominatim suggestion, which already has everything
  // (including postcode) inline, so no follow-up call is needed there.
  googlePlaceId?: string;
};

// Texas bounding box. bounded=1 (Nominatim) / a hard rectangle restriction
// (Google) make this a hard restriction, not just a ranking preference, since
// this app only serves Texas properties.
const TEXAS_VIEWBOX = "-106.7,36.5,-93.5,25.8";
const TEXAS_RECTANGLE = {
  low: { latitude: 25.8, longitude: -106.7 },
  high: { latitude: 36.5, longitude: -93.5 },
};

// Nominatim's usage policy caps automated use at 1 request/second and asks that
// callers not fire a request per keystroke — the debounce below is what enforces that,
// not just a UX nicety. See https://operations.osmfoundation.org/policies/nominatim/
const DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 5;

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

type NominatimAddress = {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
};

type NominatimResult = {
  place_id: number;
  display_name: string;
  address?: NominatimAddress;
};

// USPS-style street suffix abbreviations, applied so composed addresses stay short
// enough to fit a single-line input (Chromium clips <input> text without an ellipsis —
// text-overflow has no effect there — so an overlong value would render as a silent cut
// off rather than "…").
const STREET_SUFFIXES: Record<string, string> = {
  street: "St",
  avenue: "Ave",
  boulevard: "Blvd",
  drive: "Dr",
  lane: "Ln",
  road: "Rd",
  court: "Ct",
  circle: "Cir",
  place: "Pl",
  parkway: "Pkwy",
  highway: "Hwy",
  trail: "Trl",
  terrace: "Ter",
  square: "Sq",
};

function abbreviateRoad(road: string): string {
  return road.replace(/\b(\w+)\b$/, (word) => STREET_SUFFIXES[word.toLowerCase()] ?? word);
}

// Nominatim's display_name includes every OSM component (neighbourhood, county,
// country, ...) which is too long to read in a single-line input. Compose a short
// US postal-style address instead, e.g. "500 Main St, Houston, TX 77002".
function formatNominatimAddress(r: NominatimResult): string | null {
  const a = r.address;
  if (!a) return r.display_name;
  const line1 = [a.house_number, a.road && abbreviateRoad(a.road)].filter(Boolean).join(" ");
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || "";
  const cityState = [city, a.state === "Texas" ? "TX" : a.state].filter(Boolean).join(", ");
  const tail = [cityState, a.postcode].filter(Boolean).join(" ");
  const formatted = [line1, tail].filter(Boolean).join(", ");
  return formatted || null;
}

// Texas road names are commonly typed/pasted without a space before the
// number ("FM1957", "CR304", "Loop410") — county CAD systems, and Nominatim's
// own tokenizer, both need the space ("FM 1957"). Confirmed via direct
// testing (FM1957 → [], FM 1957 → the real road; same for CR/Loop). Insert
// the space without changing what the user sees or types. Reused for the
// Google query too — Google itself tolerates either form, but consistency
// costs nothing and this was already proven correct.
const TX_ROAD_PREFIX = /\b(FM|RM|CR|SH|US|IH|LP|LOOP|SPUR)(\d)/gi;

function normalizeRoadPrefix(query: string): string {
  return query.replace(TX_ROAD_PREFIX, "$1 $2");
}

async function fetchNominatimSuggestions(
  query: string,
  signal: AbortSignal,
): Promise<Suggestion[]> {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "us",
    viewbox: TEXAS_VIEWBOX,
    bounded: "1",
    limit: "8",
    q: normalizeRoadPrefix(query),
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal });
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);
  const data = (await res.json()) as NominatimResult[];
  const seenLabels = new Set<string>();
  return data
    .filter((d) => d.address?.state === "Texas")
    .map((d) => ({ id: String(d.place_id), label: formatNominatimAddress(d) }))
    .filter((s): s is Suggestion => Boolean(s.label))
    .filter((s) => {
      // Nominatim frequently returns multiple distinct records (different place_id)
      // for the same physical address once formatAddress trims OSM detail down to a
      // short postal string — dedupe on the displayed label, not the source id.
      const key = s.label.toLowerCase();
      if (seenLabels.has(key)) return false;
      seenLabels.add(key);
      return true;
    });
}

type GooglePlacePrediction = {
  placeId?: string;
  text?: { text?: string };
};
type GoogleAutocompleteResponse = {
  suggestions?: Array<{ placePrediction?: GooglePlacePrediction }>;
};

// Google's Autocomplete predictions read "13158 FM1957, San Antonio, TX, USA"
// — no postal code (only Place Details has that) and a trailing ", USA" this
// app's short postal-style convention doesn't use elsewhere. Stripped here so
// a Google-sourced label looks the same shape as a Nominatim one; the missing
// zip gets filled in on selection (see fetchGooglePlaceDetails).
function cleanGoogleLabel(text: string): string {
  return text.replace(/,\s*USA$/i, "").trim();
}

async function fetchGoogleSuggestions(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GOOGLE_API_KEY! },
    body: JSON.stringify({
      input: normalizeRoadPrefix(query),
      includedRegionCodes: ["us"],
      locationRestriction: { rectangle: TEXAS_RECTANGLE },
      // No includedPrimaryTypes filter — deliberately left open rather than
      // narrowed to street_address/premise/route. A commercial property is
      // just as often searched by business name ("Quality Inn Denton") as by
      // its street address, and Google only resolves that name to a real
      // place at all under types like "lodging"/"establishment"/
      // "point_of_interest", not the address-only types. The onward flow is
      // unaffected either way — selectSuggestion() always follows up with a
      // Place Details call for `formattedAddress`, which turns a business
      // name into its real numbered street address (confirmed live: "Quality
      // Inn Denton" → "4211 N Interstate 35, Denton, TX 76207, USA") before
      // it ever reaches CAD lookup.
    }),
  });
  if (!res.ok) throw new Error(`Google Places request failed: ${res.status}`);
  const data = (await res.json()) as GoogleAutocompleteResponse;
  return (data.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is GooglePlacePrediction => Boolean(p?.placeId && p.text?.text))
    .map((p) => ({
      id: p.placeId!,
      label: cleanGoogleLabel(p.text!.text!),
      googlePlaceId: p.placeId,
    }));
}

// Only called once, when the user actually picks a Google suggestion (not on
// every keystroke) — fetches the one field Autocomplete itself doesn't
// return: a real postal code, needed for the same zip-priority matching
// cad-lookup's "nearby" fallback already relies on for a bare-road address
// (e.g. a property whose CAD situs has no house number at all — see
// extractZip() in supabase/functions/cad-lookup/index.ts). Falls back to the
// Autocomplete label itself (no zip) if this call fails for any reason,
// rather than blocking selection.
async function fetchGooglePlaceDetails(
  placeId: string,
  signal: AbortSignal,
): Promise<string | null> {
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${placeId}?fields=formattedAddress`,
    { signal, headers: { "X-Goog-Api-Key": GOOGLE_API_KEY! } },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { formattedAddress?: string };
  return data.formattedAddress ? cleanGoogleLabel(data.formattedAddress) : null;
}

// Wraps a plain <input> with address suggestions — Google Places (New) when
// VITE_GOOGLE_MAPS_API_KEY is configured and the request succeeds, falling
// back automatically to free, keyless Nominatim/OpenStreetMap otherwise
// (unset key, network error, or — expected in some environments — a 403 from
// Google's own website-restriction check on the current domain).
export function AddressAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder,
  className,
  ariaLabel,
}: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  // Triggered by any change to the controlled `value` — typing (below) or an
  // external setter like voice input — so suggestions show up either way instead
  // of only reacting to direct keystrokes in this input.
  useEffect(() => {
    scheduleSearch(value);
  }, [value]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function scheduleSearch(query: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    if (query.trim().length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setOpen(false);
      setError(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        let results: Suggestion[];
        if (GOOGLE_API_KEY) {
          try {
            results = await fetchGoogleSuggestions(query, controller.signal);
          } catch (err) {
            if ((err as Error).name === "AbortError") return;
            // Falls back silently to Nominatim rather than surfacing this as
            // a user-facing error — a blocked-referrer 403 (e.g. this domain
            // isn't in the key's website restrictions yet) is an expected,
            // recoverable condition here, not a real failure.
            results = await fetchNominatimSuggestions(query, controller.signal);
          }
        } else {
          results = await fetchNominatimSuggestions(query, controller.signal);
        }
        setSuggestions(results);
        setError(false);
        setOpen(results.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        // Silently console.error-only left this fully invisible to the user —
        // identical to "no results found," so a blocked/failed request (ad
        // blocker, network issue, Nominatim down) looked exactly like there
        // being nothing at this address. Surface it instead so it's at least
        // diagnosable, without blocking typing or manual submission.
        console.error(err);
        setSuggestions([]);
        setError(true);
        setOpen(true);
      }
    }, DEBOUNCE_MS);
  }

  async function selectSuggestion(s: Suggestion) {
    setSuggestions([]);
    setError(false);
    setOpen(false);
    setActiveIndex(-1);

    if (s.googlePlaceId) {
      onChange(s.label);
      const controller = new AbortController();
      abortRef.current = controller;
      const detailed = await fetchGooglePlaceDetails(s.googlePlaceId, controller.signal).catch(
        () => null,
      );
      const finalLabel = detailed ?? s.label;
      onChange(finalLabel);
      onPlaceSelected?.(finalLabel);
      return;
    }

    onChange(s.label);
    onPlaceSelected?.(s.label);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative flex-1">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (suggestions.length > 0 || error) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        title={value}
        className={`${className ?? ""} w-full truncate`}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={listboxId}
        autoComplete="off"
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border border-border bg-background text-sm text-foreground shadow-elev"
        >
          {error && (
            <li role="presentation" className="px-4 py-2 text-muted-foreground">
              Couldn&apos;t load address suggestions right now — you can still type the full address
              and submit.
            </li>
          )}
          {suggestions.map((s, i) => (
            <li key={s.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={i === activeIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectSuggestion(s)}
                className={`block w-full px-4 py-2 text-left ${
                  i === activeIndex ? "bg-secondary" : "hover:bg-secondary"
                }`}
              >
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
