"use client";

import { useEffect, useRef, useState } from "react";
import type { FloodForecast } from "../lib/api";
import { horizonTotals } from "../lib/useFloodForecast";
import { GlassPanel } from "./glass/GlassPanel";

const STEP_MS = 1800;

export function horizonLabel(hours: number) {
  return hours === 0 ? "Now" : `+${hours}h`;
}

export function FloodTimeline({
  forecast,
  horizonIndex,
  onHorizonChange,
}: {
  forecast: FloodForecast | null;
  horizonIndex: number;
  onHorizonChange: (index: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const indexRef = useRef(horizonIndex);
  useEffect(() => {
    indexRef.current = horizonIndex;
  }, [horizonIndex]);
  const horizons = forecast?.horizons_hours ?? [];

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      const next = indexRef.current + 1;
      if (next >= horizons.length) {
        setPlaying(false);
        return;
      }
      onHorizonChange(next);
    }, STEP_MS);
    return () => clearInterval(timer);
  }, [playing, horizons.length, onHorizonChange]);

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (horizonIndex >= horizons.length - 1) onHorizonChange(0);
    setPlaying(true);
  };

  if (!forecast) return null;
  const totals = horizonTotals(forecast, horizonIndex);
  const stats: [string, string][] = [
    ["Flooded area", `${Math.round(totals.flooded_area_km2).toLocaleString()} km²`],
    ["People", totals.population.toLocaleString()],
    ["Hospitals", String(totals.hospitals)],
    ["Schools", String(totals.schools)],
    ["Bridges", String(totals.bridges)],
  ];

  return (
    <GlassPanel strong className="w-[560px] py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--glass-text-dim)]">Flood forecast</span>
          <span
            className="rounded-full border border-[var(--glass-border)] px-2 py-px text-[10px] text-[var(--glass-text-dim)]"
            title={forecast.model_label}
          >
            MODELLED
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {forecast.depth_bands.map((band, i) => {
            const next = forecast.depth_bands[i + 1];
            return (
              <span key={band.min_m} className="flex items-center gap-1 text-[10px] text-[var(--glass-text-dim)]">
                <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: band.color }} />
                {next ? `${band.min_m}–${next.min_m}m` : `>${band.min_m}m`}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          aria-label={playing ? "Pause forecast" : "Play forecast"}
          className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--accent,#35c2f0)] text-[#04111a] hover:brightness-110"
        >
          {playing ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="ml-0.5 h-4 w-4" fill="currentColor">
              <path d="M7 4.5v15l13-7.5z" />
            </svg>
          )}
        </button>

        <div className="relative flex flex-1 items-center justify-between">
          <div className="absolute left-3 right-3 top-1/2 h-0.5 -translate-y-1/2 bg-[var(--glass-border)]" />
          <div
            className="absolute left-3 top-1/2 h-0.5 -translate-y-1/2 bg-[var(--accent,#35c2f0)] transition-all duration-500"
            style={{ width: `calc((100% - 1.5rem) * ${horizons.length > 1 ? horizonIndex / (horizons.length - 1) : 0})` }}
          />
          {horizons.map((h, i) => (
            <button
              key={h}
              onClick={() => {
                setPlaying(false);
                onHorizonChange(i);
              }}
              className={`relative z-10 cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                i === horizonIndex
                  ? "bg-[var(--accent,#35c2f0)] text-[#04111a]"
                  : i < horizonIndex
                    ? "bg-[var(--glass-bg-strong)] text-[var(--glass-text)]"
                    : "bg-[var(--glass-bg-strong)] text-[var(--glass-text-dim)] hover:text-[var(--glass-text)]"
              }`}
            >
              {horizonLabel(h)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-1.5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-[var(--glass-highlight)] px-2 py-1.5">
            <div className="text-sm font-semibold tabular-nums">{value}</div>
            <div className="text-[10px] text-[var(--glass-text-dim)]">{label}</div>
          </div>
        ))}
      </div>
      <div className="mt-1.5 text-[10px] text-[var(--glass-text-dim)]">
        {totals.rivers === 0
          ? "No flooding forecast at this horizon."
          : `Potential exposure across ${totals.rivers} river${totals.rivers > 1 ? "s" : ""} · modelled, not confirmed damage`}
      </div>
    </GlassPanel>
  );
}
