"use client";

import { useEffect, useState } from "react";
import { api, type ExposedAsset, type RiverFloodForecast, type RiverReading } from "../lib/api";
import { horizonLabel } from "./FloodTimeline";
import { ImpactPanel } from "./ImpactPanel";
import { PanelHeader, Section } from "./PanelParts";

const SOURCE_LABELS: Record<string, string> = {
  simulation: "Simulated",
  "live:glofas": "Live · GloFAS-derived stage",
  "live:pending": "Live · awaiting feed",
};

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-white/55 px-3 py-2">
      <div className="text-base font-medium tabular-nums text-[#202124]">{value}</div>
      <div className="text-xs text-[#5f6368]">{label}</div>
    </div>
  );
}

export function RiverPanel({
  riverId,
  reading,
  name,
  subtitle,
  flood,
  horizonIndex,
  onHorizonChange,
  onFocusAsset,
  onClose,
}: {
  riverId: string;
  reading: RiverReading | undefined;
  name: string;
  subtitle?: string;
  flood: RiverFloodForecast | undefined;
  horizonIndex: number;
  onHorizonChange: (index: number) => void;
  onFocusAsset: (asset: ExposedAsset) => void;
  onClose: () => void;
}) {
  const [dangerCrossing, setDangerCrossing] = useState<number | null>(null);

  useEffect(() => {
    api
      .forecast(riverId)
      .then((f) => setDangerCrossing(f.danger_crossing_hours))
      .catch(() => setDangerCrossing(null));
  }, [riverId, reading?.risk]);

  if (!reading) return null;

  const pct = Math.min(100, (reading.level_m / reading.danger_level_m) * 100);
  const warningPct = Math.min(100, (reading.warning_level_m / reading.danger_level_m) * 100);
  const active = flood?.horizons[horizonIndex];
  const rising = reading.rise_rate_m_per_hr >= 0;

  return (
    <div>
      <PanelHeader
        title={name}
        subtitle={subtitle ?? "River"}
        risk={reading.risk}
        badge={SOURCE_LABELS[reading.source] ?? reading.source}
        onBack={onClose}
      />

      <Section title="Water level">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="text-[28px] font-normal tabular-nums text-[#202124]">{reading.level_m.toFixed(2)} m</span>
          <span className={`text-sm font-medium ${rising ? "text-[#c5221f]" : "text-[#137333]"}`}>
            {rising ? "↑" : "↓"} {Math.abs(reading.rise_rate_m_per_hr).toFixed(2)} m/h
          </span>
        </div>
        <div className="relative h-2 overflow-hidden rounded-full bg-black/[0.08]">
          <div className={`h-full risk-${reading.risk}`} style={{ width: `${pct}%` }} />
          <div className="absolute top-0 h-full w-0.5 bg-[#5f6368]" style={{ left: `${warningPct}%` }} title="Warning level" />
        </div>
        <div className="mt-1 flex justify-between text-xs text-[#70757a]">
          <span>Warning {reading.warning_level_m} m</span>
          <span>Danger {reading.danger_level_m} m</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat
            value={reading.level_m >= reading.danger_level_m ? "Crossed" : dangerCrossing != null ? `in ${dangerCrossing} h` : "Not forecast"}
            label="Danger level"
          />
          <Stat
            value={reading.discharge_m3s != null ? `${Math.round(reading.discharge_m3s).toLocaleString()} m³/s` : "—"}
            label="Discharge"
          />
          {reading.rain_next_24h_mm != null && (
            <>
              <Stat value={`${reading.rain_past_24h_mm ?? "—"} mm`} label="Rain, last 24 h" />
              <Stat value={`${reading.rain_next_24h_mm} mm`} label="Rain, next 24 h" />
            </>
          )}
        </div>
      </Section>

      {flood ? (
        <>
          <Section title="Level forecast">
            <div className="grid grid-cols-4 gap-1.5">
              {flood.horizons.map((h, i) => (
                <button
                  key={h.horizon_hours}
                  onClick={() => onHorizonChange(i)}
                  className={`cursor-pointer rounded-lg border px-2 py-1.5 text-left transition-colors ${
                    i === horizonIndex ? "border-[#1a73e8] bg-[#e8f0fe]" : "border-black/[0.08] bg-white/50 hover:bg-white/75"
                  }`}
                >
                  <div className={`text-[11px] ${i === horizonIndex ? "text-[#1967d2]" : "text-[#70757a]"}`}>
                    {horizonLabel(h.horizon_hours)}
                  </div>
                  <div className={`text-sm font-medium tabular-nums ${h.stage_m > 0 ? "text-[#c5221f]" : "text-[#202124]"}`}>
                    {h.level_m.toFixed(1)} m
                  </div>
                  <div className="text-[10px] text-[#70757a]">{Math.round(h.confidence_pct)}% conf.</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Flood impact">
            {active && active.flooded_area_km2 > 0 ? (
              <ImpactPanel horizon={active} label={horizonLabel(active.horizon_hours)} onFocusAsset={onFocusAsset} />
            ) : (
              <div className="text-sm text-[#5f6368]">
                No flooding forecast at {active ? horizonLabel(active.horizon_hours).toLowerCase() : "this horizon"}. The
                level stays below the danger threshold.
              </div>
            )}
          </Section>
        </>
      ) : (
        <Section title="Flood impact">
          <div className="text-sm text-[#5f6368]">Flood-extent model not yet built for this river.</div>
        </Section>
      )}
    </div>
  );
}
