"use client";

import { useEffect, useState } from "react";
import { api, type ExposedAsset, type RiverFloodForecast, type RiverReading } from "../lib/api";
import { horizonLabel } from "./FloodTimeline";
import { GlassPanel } from "./glass/GlassPanel";
import { ImpactPanel } from "./ImpactPanel";

const SOURCE_LABELS: Record<string, string> = {
  simulation: "SIMULATED",
  "live:glofas": "LIVE · GloFAS-derived stage",
  "live:pending": "LIVE · awaiting feed",
};

export function RiverPanel({
  riverId,
  reading,
  name,
  flood,
  horizonIndex,
  onHorizonChange,
  onFocusAsset,
  onClose,
}: {
  riverId: string;
  reading: RiverReading | undefined;
  name: string;
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

  return (
    <GlassPanel strong className="w-[360px] max-h-[calc(100vh-7rem)] overflow-y-auto varuna-scrollbar">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm text-[var(--glass-text-dim)]">RIVER — LIVE</div>
          <div className="text-xl font-semibold">{name}</div>
        </div>
        <button onClick={onClose} className="text-[var(--glass-text-dim)] hover:text-[var(--glass-text)] cursor-pointer">
          ✕
        </button>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold risk-text-${reading.risk}`}>
          <span className={`risk-dot risk-${reading.risk} mr-1.5`} />
          {reading.risk}
        </span>
        <span className="rounded-full border border-[var(--glass-border)] px-2 py-px text-[10px] text-[var(--glass-text-dim)]">
          {SOURCE_LABELS[reading.source] ?? reading.source}
        </span>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span>Level</span>
          <span className="font-semibold">{reading.level_m} m</span>
        </div>
        <div className="relative h-3 rounded-full bg-[var(--glass-highlight)] overflow-hidden">
          <div className={`h-full risk-${reading.risk}`} style={{ width: `${pct}%` }} />
          <div
            className="absolute top-0 h-full w-[2px] bg-white/60"
            style={{ left: `${warningPct}%` }}
            title="Warning level"
          />
        </div>
        <div className="flex justify-between text-[11px] text-[var(--glass-text-dim)] mt-1">
          <span>Warning {reading.warning_level_m} m</span>
          <span>Danger {reading.danger_level_m} m</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2">
          <div className="text-lg font-semibold">↑ {reading.rise_rate_m_per_hr} m/h</div>
          <div className="text-[11px] text-[var(--glass-text-dim)]">Rise rate</div>
        </div>
        <div className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2">
          <div className="text-lg font-semibold">
            {reading.level_m >= reading.danger_level_m ? "Crossed" : dangerCrossing != null ? `${dangerCrossing}h` : "—"}
          </div>
          <div className="text-[11px] text-[var(--glass-text-dim)]">Danger crossing</div>
        </div>
      </div>

      {(reading.discharge_m3s != null || reading.rain_next_24h_mm != null) && (
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2">
            <div className="text-sm font-semibold tabular-nums">
              {reading.discharge_m3s != null ? `${Math.round(reading.discharge_m3s).toLocaleString()} m³/s` : "—"}
            </div>
            <div className="text-[11px] text-[var(--glass-text-dim)]">Discharge</div>
          </div>
          <div className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2">
            <div className="text-sm font-semibold tabular-nums">{reading.rain_past_24h_mm ?? "—"} mm</div>
            <div className="text-[11px] text-[var(--glass-text-dim)]">Rain, last 24h</div>
          </div>
          <div className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2">
            <div className="text-sm font-semibold tabular-nums">{reading.rain_next_24h_mm ?? "—"} mm</div>
            <div className="text-[11px] text-[var(--glass-text-dim)]">Rain, next 24h</div>
          </div>
        </div>
      )}

      {flood ? (
        <>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-[var(--glass-text-dim)]">Level forecast</div>
          <div className="mb-4 grid grid-cols-4 gap-1.5">
            {flood.horizons.map((h, i) => {
              const aboveDanger = h.stage_m > 0;
              return (
                <button
                  key={h.horizon_hours}
                  onClick={() => onHorizonChange(i)}
                  className={`cursor-pointer rounded-lg border px-2 py-1.5 text-left transition-colors ${
                    i === horizonIndex
                      ? "border-[var(--accent,#35c2f0)] bg-[var(--glass-highlight)]"
                      : "border-transparent bg-[var(--glass-highlight)] hover:border-[var(--glass-border)]"
                  }`}
                >
                  <div className="text-[10px] text-[var(--glass-text-dim)]">{horizonLabel(h.horizon_hours)}</div>
                  <div className={`text-sm font-semibold tabular-nums ${aboveDanger ? "risk-text-CRITICAL" : ""}`}>
                    {h.level_m.toFixed(1)} m
                  </div>
                  <div className="text-[10px] text-[var(--glass-text-dim)]">{Math.round(h.confidence_pct)}% conf.</div>
                </button>
              );
            })}
          </div>

          {active && active.flooded_area_km2 > 0 ? (
            <ImpactPanel horizon={active} label={horizonLabel(active.horizon_hours)} onFocusAsset={onFocusAsset} />
          ) : (
            <div className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2 text-xs text-[var(--glass-text-dim)]">
              No flooding forecast at {active ? horizonLabel(active.horizon_hours) : "this horizon"} — level stays below the
              danger threshold.
            </div>
          )}
        </>
      ) : (
        <div className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2 text-xs text-[var(--glass-text-dim)]">
          Flood-extent model not yet built for this river.
        </div>
      )}
    </GlassPanel>
  );
}
