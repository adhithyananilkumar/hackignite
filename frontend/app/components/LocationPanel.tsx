"use client";

import { useEffect, useState } from "react";
import { api, type NearbyPlace, type PointAssessment } from "../lib/api";
import { RiskPill, Section } from "./PanelParts";

export type MapPin = {
  lat: number;
  lon: number;
  label?: string;
  /** Present when the pin came from Ask VARUNA, which has already assessed it. */
  assessment?: PointAssessment;
  /** Fly the camera to the pin (search/chat pins); a click-dropped pin stays put. */
  fly: boolean;
  key: string;
};

export const LIKELIHOOD_COLORS: Record<string, { bg: string; fg: string; bar: string }> = {
  "Very high": { bg: "#c5221f", fg: "#ffffff", bar: "#c5221f" },
  High: { bg: "#fce8e6", fg: "#c5221f", bar: "#e8453c" },
  Moderate: { bg: "#feefe3", fg: "#c26401", bar: "#fa7b17" },
  Low: { bg: "#fef7e0", fg: "#b06000", bar: "#f9ab00" },
  "Very low": { bg: "#e6f4ea", fg: "#137333", bar: "#34a853" },
};

const horizonLabel = (h: number) => (h === 0 ? "Now" : `+${h}h`);

export function pinTitle(pin: MapPin, assessment: PointAssessment | null) {
  return pin.label ?? assessment?.place?.name ?? "Dropped pin";
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-white/55 px-3 py-2">
      <div className="text-base font-medium tabular-nums text-[#202124]">{value}</div>
      <div className="text-[11px] leading-tight text-[#5f6368]">{label}</div>
    </div>
  );
}

function NearbyList({ title, places, onFocus }: { title: string; places: NearbyPlace[]; onFocus: (p: NearbyPlace) => void }) {
  if (!places.length) return null;
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 text-xs text-[#5f6368]">{title}</div>
      {places.map((p) => (
        <button
          key={`${p.lat},${p.lon}`}
          onClick={() => onFocus(p)}
          className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/60"
        >
          <span className="truncate text-[#202124]">{p.name}</span>
          <span className="shrink-0 text-xs tabular-nums text-[#5f6368]">{p.distance_km.toFixed(1)} km</span>
        </button>
      ))}
    </div>
  );
}

export function LocationPanel({
  pin,
  refreshKey,
  onClose,
  onAsk,
  onFocus,
  onSelectRiver,
}: {
  pin: MapPin;
  /** Changes when the data source ticks, so the assessment follows the live forecast. */
  refreshKey: string;
  onClose: () => void;
  onAsk: (question: string) => void;
  onFocus: (lon: number, lat: number, id: string) => void;
  onSelectRiver: (id: string) => void;
}) {
  const [fetched, setFetched] = useState<{ key: string; data: PointAssessment | null; error: boolean } | null>(null);
  const fetchKey = `${pin.key}|${refreshKey}`;

  useEffect(() => {
    let cancelled = false;
    api
      .assessPoint(pin.lat, pin.lon)
      .then((data) => !cancelled && setFetched({ key: fetchKey, data, error: false }))
      .catch(() => !cancelled && setFetched({ key: fetchKey, data: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [pin.lat, pin.lon, fetchKey]);

  // Until a fetch for this pin lands, show the chat's assessment; on a refresh,
  // keep the previous result for the same pin.
  const samePin = fetched?.key.startsWith(`${pin.key}|`) ?? false;
  const assessment = (samePin ? fetched?.data : null) ?? pin.assessment ?? null;
  const failed = samePin && fetched?.error && !assessment;
  const title = pinTitle(pin, assessment);
  const lk = assessment?.likelihood;
  const colors = LIKELIHOOD_COLORS[lk?.level ?? "Very low"];

  return (
    <div>
      <div className="border-b border-black/[0.07] px-5 pb-4 pt-3">
        <button
          onClick={onClose}
          aria-label="Remove pin"
          className="-ml-2 mb-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-[#5f6368] hover:bg-white/70"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20z" />
          </svg>
        </button>
        <h2 className="text-[22px] font-normal leading-7 text-[#202124]">{title}</h2>
        <div className="mt-0.5 text-sm text-[#70757a]">
          {assessment?.place?.detail ? `${assessment.place.detail} · ` : ""}
          {pin.lat.toFixed(4)}, {pin.lon.toFixed(4)}
        </div>

        {lk ? (
          <div className="mt-4 rounded-xl bg-white/55 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-[#5f6368]">Flood likelihood · next 12h</div>
                <div className="mt-0.5 flex items-baseline gap-2">
                  <span className="text-[28px] font-normal leading-8 tabular-nums text-[#202124]">{lk.score}</span>
                  <span className="text-xs text-[#5f6368]">/ 100</span>
                </div>
              </div>
              <span className="rounded-full px-3 py-1 text-sm font-medium" style={{ background: colors.bg, color: colors.fg }}>
                {lk.level}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/[0.08]">
              <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${lk.score}%`, background: colors.bar }} />
            </div>
            <div className="mt-2 text-[13px] leading-5 text-[#3c4043]">{lk.driver}.</div>
          </div>
        ) : (
          <div className="mt-4 rounded-xl bg-white/55 p-3 text-sm text-[#5f6368]">
            {failed ? "Couldn't assess this point — is it inside Kerala?" : "Assessing flood risk at this point…"}
          </div>
        )}

        <button
          onClick={() => onAsk(`What's the flood and rain risk at ${title}? What should people there do?`)}
          className="mt-3 flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[#1a73e8] px-4 py-2 text-sm font-medium text-white hover:bg-[#1765cc]"
        >
          <SparkleIcon className="h-4 w-4" />
          Ask VARUNA about this place
        </button>
      </div>

      {assessment && (
        <>
          <Section title="River flooding">
            {assessment.rivers.length === 0 ? (
              <div className="text-sm text-[#5f6368]">
                Outside every modelled river floodplain. Nearest river:{" "}
                <button className="cursor-pointer text-[#1a73e8] hover:underline" onClick={() => onSelectRiver(assessment.nearest_river.river_id)}>
                  {assessment.nearest_river.name}
                </button>{" "}
                ({assessment.nearest_river.distance_km.toFixed(1)} km).
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {assessment.rivers.slice(0, 2).map((r) => (
                  <div key={r.river_id}>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <button className="cursor-pointer text-sm font-medium text-[#1a73e8] hover:underline" onClick={() => onSelectRiver(r.river_id)}>
                        {r.name}
                      </button>
                      <RiskPill risk={r.risk} compact />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Stat value={`${r.floods_at_river_level_m.toFixed(1)} m`} label={`River level that floods here (now ${r.river_level_m.toFixed(1)} m)`} />
                      <Stat value={`${r.height_above_river_m.toFixed(1)} m`} label="Ground height above the river" />
                    </div>
                    <div className="mt-2 flex gap-1.5">
                      {r.horizons.map((h) => (
                        <div
                          key={h.horizon_hours}
                          title={`${h.confidence_pct}% forecast confidence`}
                          className={`flex-1 rounded-lg px-1.5 py-1 text-center text-[11px] ${h.flooded ? "bg-[#d2e3fc] text-[#174ea6]" : "bg-white/55 text-[#5f6368]"}`}
                        >
                          <div className="font-medium">{horizonLabel(h.horizon_hours)}</div>
                          <div>{h.flooded ? `~${h.depth_m.toFixed(1)} m` : "Dry"}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Rain outlook">
            {assessment.rain.available ? (
              <div className="grid grid-cols-3 gap-2">
                <Stat value={`${assessment.rain.chance_of_rain_24h_pct}%`} label="Chance of rain, 24h" />
                <Stat value={`${assessment.rain.next_24h_mm} mm`} label={`Next 24h · ${assessment.rain.imd_category_24h}`} />
                <Stat value={`${assessment.rain.next_72h_mm} mm`} label="Next 72h" />
              </div>
            ) : (
              <div className="text-sm text-[#5f6368]">Rain forecast unavailable right now.</div>
            )}
          </Section>

          <Section title="Nearest refuge">
            <NearbyList title="Relief shelters" places={assessment.nearby.shelter} onFocus={(p) => onFocus(p.lon, p.lat, p.name)} />
            <NearbyList title="Hospitals" places={assessment.nearby.hospital} onFocus={(p) => onFocus(p.lon, p.lat, p.name)} />
          </Section>

          <div className="px-5 py-3 text-[11px] leading-4 text-[#70757a]">
            {assessment.note}
            {assessment.data_source.kind === "simulation" && " River levels come from a simulated scenario."}
          </div>
        </>
      )}
    </div>
  );
}

export function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 2.5c.4 3.9 1.4 5.9 3 7.2 1.5 1.2 3.4 1.8 6.5 2.3-3.1.5-5 1.1-6.5 2.3-1.6 1.3-2.6 3.3-3 7.2-.4-3.9-1.4-5.9-3-7.2-1.5-1.2-3.4-1.8-6.5-2.3 3.1-.5 5-1.1 6.5-2.3 1.6-1.3 2.6-3.3 3-7.2z" />
    </svg>
  );
}
