import { useEffect, useState } from "react";
import "leaflet/dist/leaflet.css";
import { currency } from "@/lib/intake-store";

export type CompProperty = {
  pid: number;
  address: string;
  latitude: number;
  longitude: number;
  marketValue: number | null;
  ownerName: string | null;
};

// Leaflet touches `window` as soon as its module is evaluated (confirmed live via
// a prerender crash: "ReferenceError: window is not defined" inside
// leaflet-src.js, thrown at import time, not at map-instantiation time) — this app
// prerenders every route server-side at build time, so a plain top-level
// `import "leaflet"` breaks /ai-report's prerendered HTML even though the map JSX
// itself only ever renders after a real browser mounts it. Loading both packages
// via a dynamic import() inside useEffect (which never runs during SSR) keeps
// leaflet's module code out of the server bundle entirely.
type LeafletMods = {
  L: typeof import("leaflet");
  MapContainer: typeof import("react-leaflet").MapContainer;
  TileLayer: typeof import("react-leaflet").TileLayer;
  Marker: typeof import("react-leaflet").Marker;
  Popup: typeof import("react-leaflet").Popup;
  useMap: typeof import("react-leaflet").useMap;
};

let cachedMods: LeafletMods | null = null;

function useLeaflet(): LeafletMods | null {
  const [mods, setMods] = useState<LeafletMods | null>(cachedMods);
  useEffect(() => {
    if (cachedMods) return;
    let cancelled = false;
    Promise.all([import("leaflet"), import("react-leaflet")]).then(([leaflet, rl]) => {
      if (cancelled) return;
      cachedMods = {
        L: leaflet.default,
        MapContainer: rl.MapContainer,
        TileLayer: rl.TileLayer,
        Marker: rl.Marker,
        Popup: rl.Popup,
        useMap: rl.useMap,
      };
      setMods(cachedMods);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return mods;
}

export function CompsMap({ subject, comps }: { subject: CompProperty; comps: CompProperty[] }) {
  const mods = useLeaflet();

  if (!mods) {
    return (
      <div className="mt-3 h-[280px] animate-pulse rounded-lg border border-border bg-secondary/40" />
    );
  }
  return <CompsMapInner subject={subject} comps={comps} mods={mods} />;
}

// Plain colored dots instead of Leaflet's default pin images — sidesteps the
// well-known bundler issue where Leaflet's default marker icon URLs (relative
// paths baked into the package) 404 once Vite rehashes asset filenames, and lets
// the subject property read as visually distinct (bigger, accent-colored) from
// the comps (smaller, neutral) without needing any external icon assets at all.
function dotIcon(L: typeof import("leaflet"), color: string, size: number) {
  return L.divIcon({
    className: "",
    html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.45);"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function CompsMapInner({
  subject,
  comps,
  mods,
}: {
  subject: CompProperty;
  comps: CompProperty[];
  mods: LeafletMods;
}) {
  const { L, MapContainer, TileLayer, Marker, Popup, useMap } = mods;
  const subjectIcon = dotIcon(L, "var(--accent)", 20);
  const compIcon = dotIcon(L, "var(--success)", 12);

  function FitBounds({ points }: { points: Array<[number, number]> }) {
    const map = useMap();
    useEffect(() => {
      if (points.length > 1) map.fitBounds(points, { padding: [28, 28] });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [map]);
    return null;
  }

  const center: [number, number] = [subject.latitude, subject.longitude];
  const allPoints: Array<[number, number]> = [
    center,
    ...comps.map((c): [number, number] => [c.latitude, c.longitude]),
  ];

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border" style={{ height: 280 }}>
      <MapContainer
        center={center}
        zoom={16}
        scrollWheelZoom={false}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={allPoints} />
        <Marker position={center} icon={subjectIcon}>
          <Popup>
            <strong>Subject Property</strong>
            <br />
            {subject.address}
            {subject.marketValue != null && (
              <>
                <br />
                {currency(subject.marketValue)}
              </>
            )}
          </Popup>
        </Marker>
        {comps.map((c) => (
          <Marker key={c.pid} position={[c.latitude, c.longitude]} icon={compIcon}>
            <Popup>
              {c.address}
              {c.marketValue != null && (
                <>
                  <br />
                  {currency(c.marketValue)}
                </>
              )}
              {c.ownerName && (
                <>
                  <br />
                  <span className="text-xs text-muted-foreground">{c.ownerName}</span>
                </>
              )}
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
