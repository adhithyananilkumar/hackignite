"use client";

import type { Basemap, LayerToggles } from "./KeralaMap";

const CHIPS: { key: keyof LayerToggles; label: string; color: string; icon: string }[] = [
  { key: "flood", label: "Flood forecast", color: "#1a73e8", icon: "M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11z" },
  { key: "hospital", label: "Hospitals", color: "#d93025", icon: "M12 6v12M6 12h12" },
  { key: "school", label: "Schools", color: "#e37400", icon: "M2 9l10-5 10 5-10 5zM6 11v5c3 2 9 2 12 0v-5" },
  { key: "shelter", label: "Relief shelters", color: "#1a73e8", icon: "M3 11l9-7 9 7M5 10v10h14V10" },
  { key: "bridge", label: "Bridges", color: "#5f6368", icon: "M3 17c3-6 15-6 18 0M3 17h18M7 13v4M12 11v6M17 13v4" },
];

export function LayerChips({ layers, onChange }: { layers: LayerToggles; onChange: (next: LayerToggles) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1" role="toolbar" aria-label="Map layers">
      {CHIPS.map((chip) => (
        <button
          key={chip.key}
          className="maps-chip"
          aria-pressed={layers[chip.key]}
          onClick={() => onChange({ ...layers, [chip.key]: !layers[chip.key] })}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke={layers[chip.key] ? "currentColor" : chip.color}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={chip.icon} />
          </svg>
          {chip.label}
        </button>
      ))}
    </div>
  );
}

// Thumbnail tiles over southern Kerala (z7/91/60) preview the *other* basemap,
// the way Google Maps' Layers button does.
const THUMBNAILS: Record<Basemap, string> = {
  map: "https://a.basemaps.cartocdn.com/rastertiles/voyager/7/91/60.png",
  satellite: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/7/60/91",
};

export function BasemapToggle({ basemap, onChange }: { basemap: Basemap; onChange: (next: Basemap) => void }) {
  const next: Basemap = basemap === "map" ? "satellite" : "map";
  return (
    <button
      onClick={() => onChange(next)}
      aria-label={`Switch to ${next} view`}
      title={`Switch to ${next} view`}
      className="group relative h-[72px] w-[72px] cursor-pointer overflow-hidden rounded-lg border-2 border-white bg-[#e8eaed] shadow-[var(--maps-shadow)]"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={THUMBNAILS[next]} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-110" />
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-gradient-to-t from-black/70 to-transparent pb-1 pt-3 text-[11px] font-medium text-white">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
          <path d="m11.99 18.54-7.37-5.73L3 14.07l9 7 9-7-1.63-1.27zM12 16l7.36-5.73L21 9l-9-7-9 7 1.63 1.27z" />
        </svg>
        {next === "satellite" ? "Satellite" : "Map"}
      </span>
    </button>
  );
}
