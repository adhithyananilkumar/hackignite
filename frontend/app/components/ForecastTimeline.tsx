"use client";

import { useState } from "react";
import type { ForecastPoint } from "../lib/api";

export function ForecastTimeline({ points }: { points: ForecastPoint[] }) {
  const [index, setIndex] = useState(0);
  const active = points[index];

  if (!points.length) return null;

  return (
    <div>
      <div className="flex justify-between text-[11px] text-[var(--glass-text-dim)] mb-1">
        <span>T+0h (now)</span>
        <span>T+{points[points.length - 1].horizon_hours}h</span>
      </div>
      <input
        type="range"
        min={0}
        max={points.length - 1}
        step={1}
        value={index}
        onChange={(e) => setIndex(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
      {active && (
        <div className="mt-2 flex items-baseline justify-between">
          <span className="text-xs text-[var(--glass-text-dim)]">
            T+{active.horizon_hours}h forecast
          </span>
          <span className="text-lg font-semibold">{active.level_m} m</span>
          <span className="text-xs text-[var(--glass-text-dim)]">
            {active.confidence_pct}% confidence
          </span>
        </div>
      )}
    </div>
  );
}
