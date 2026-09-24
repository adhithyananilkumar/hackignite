"use client";

import { useEffect, useState } from "react";
import { api, type ImpactSummary, type RiverForecast, type RiverReading } from "../lib/api";
import { ForecastTimeline } from "./ForecastTimeline";
import { GlassPanel } from "./glass/GlassPanel";
import { ImpactPanel } from "./ImpactPanel";

export function RiverPanel({
  riverId,
  reading,
  name,
  onClose,
}: {
  riverId: string;
  reading: RiverReading | undefined;
  name: string;
  onClose: () => void;
}) {
  const [forecast, setForecast] = useState<RiverForecast | null>(null);
  const [impact, setImpact] = useState<ImpactSummary | null>(null);

  useEffect(() => {
    setForecast(null);
    setImpact(null);
    api.forecast(riverId).then(setForecast).catch(() => setForecast(null));
    api.impact(riverId).then(setImpact).catch(() => setImpact(null));
  }, [riverId, reading?.risk]);

  if (!reading) return null;

  const pct = Math.min(100, (reading.level_m / reading.danger_level_m) * 100);
  const warningPct = Math.min(100, (reading.warning_level_m / reading.danger_level_m) * 100);

  return (
    <GlassPanel strong className="w-[360px] max-h-[calc(100vh-32px)] overflow-y-auto varuna-scrollbar">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm text-[var(--glass-text-dim)]">RIVER — LIVE</div>
          <div className="text-xl font-semibold">{name}</div>
        </div>
        <button onClick={onClose} className="text-[var(--glass-text-dim)] hover:text-[var(--glass-text)] cursor-pointer">
          ✕
        </button>
      </div>

      <div className={`inline-block mb-3 rounded-full px-2.5 py-0.5 text-xs font-semibold risk-text-${reading.risk}`}>
        <span className={`risk-dot risk-${reading.risk} mr-1.5`} />
        {reading.risk}
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span>Level</span>
          <span className="font-semibold">{reading.level_m} m</span>
        </div>
        <div className="relative h-3 rounded-full bg-[var(--glass-highlight)] overflow-hidden">
          <div
            className={`h-full risk-${reading.risk}`}
            style={{ width: `${pct}%` }}
          />
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
            {forecast?.danger_crossing_hours != null ? `${forecast.danger_crossing_hours}h` : "—"}
          </div>
          <div className="text-[11px] text-[var(--glass-text-dim)]">Danger crossing</div>
        </div>
      </div>

      {forecast && (
        <div className="mb-4">
          <div className="text-[11px] uppercase tracking-wider text-[var(--glass-text-dim)] mb-2">
            Play forecast
          </div>
          <ForecastTimeline points={forecast.points} />
        </div>
      )}

      {impact && <ImpactPanel impact={impact} />}
    </GlassPanel>
  );
}
