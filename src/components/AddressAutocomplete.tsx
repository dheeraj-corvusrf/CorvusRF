import { useEffect, useRef, useState } from "react";

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
};

// Texas bounding box. bounded=1 makes this a hard restriction (not just a ranking
// preference) since this app only serves Texas commercial properties.
const TEXAS_VIEWBOX = "-106.7,36.5,-93.5,25.8";

// Nominatim's usage policy caps automated use at 1 request/second and asks that
// callers not fire a request per keystroke — the debounce below is what enforces that,
// not just a UX nicety. See https://operations.osmfoundation.org/policies/nominatim/
const DEBOUNCE_MS = 500;
const MIN_QUERY_LENGTH = 5;

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
function formatAddress(r: NominatimResult): string | null {
  const a = r.address;
  if (!a) return r.display_name;
  const line1 = [a.house_number, a.road && abbreviateRoad(a.road)].filter(Boolean).join(" ");
  const city = a.city || a.town || a.village || a.hamlet || a.suburb || "";
  const cityState = [city, a.state === "Texas" ? "TX" : a.state].filter(Boolean).join(", ");
  const tail = [cityState, a.postcode].filter(Boolean).join(" ");
  const formatted = [line1, tail].filter(Boolean).join(", ");
  return formatted || null;
}

async function fetchSuggestions(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "us",
    viewbox: TEXAS_VIEWBOX,
    bounded: "1",
    limit: "8",
    q: query,
  });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal });
  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);
  const data = (await res.json()) as NominatimResult[];
  return data
    .filter((d) => d.address?.state === "Texas")
    .map((d) => ({ id: String(d.place_id), label: formatAddress(d) }))
    .filter((s): s is Suggestion => Boolean(s.label));
}

// Wraps a plain <input> with free, no-key OpenStreetMap (Nominatim) address suggestions.
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

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
      return;
    }

    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const results = await fetchSuggestions(query, controller.signal);
        setSuggestions(results);
        setOpen(results.length > 0);
        setActiveIndex(-1);
      } catch (err) {
        if ((err as Error).name !== "AbortError") console.error(err);
      }
    }, DEBOUNCE_MS);
  }

  function selectSuggestion(s: Suggestion) {
    onChange(s.label);
    onPlaceSelected?.(s.label);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
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
        onChange={(e) => {
          onChange(e.target.value);
          scheduleSearch(e.target.value);
        }}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        title={value}
        className={`${className ?? ""} w-full truncate`}
        aria-label={ariaLabel}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        autoComplete="off"
      />
      {open && (
        <ul className="absolute z-20 mt-1 w-full max-h-64 overflow-auto rounded-md border border-border bg-background text-sm text-foreground shadow-elev">
          {suggestions.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
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
