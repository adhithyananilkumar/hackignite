"use client";

import { useState } from "react";
import type { CoastalOutlet, CoastalSnapshot, Drainage } from "../lib/api";
import { GlassPanel } from "./glass/GlassPanel";
import { MiniChart } from "./MiniChart";

export const DRAINAGE: Record<Drainage, { label: string; bg: string; fg: string; dot: string }> = {
  FREE_DRAINING: { label: "Free draining", bg: "#e6f4ea", fg: "#137333", dot: "#1e8e3e" },
  TIDAL_CONSTRAINT: { label: "Tidal constraint", bg: "#fef7e0", fg: "#b06000", dot: "#f9ab00" },
  BACKWATER_RISK: { label: "Backwater risk", bg: "#fce8e6", fg: "#c5221f", dot: "#d93025" },
};

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function OutletRow({ outlet, now, open, onToggle }: { outlet: CoastalOutlet; now: number; open: boolean; onToggle: () => void }) {
  const d = DRAINAGE[outlet.drainage];
  const points = outlet.series
    .filter((s) => s.level_m !== null)
    .map((s) => [(new Date(s.time).getTime() - now) / 3.6e6, s.level_m as number] as [number, number]);
  const nextHigh = outlet.next_highs[0];

  return (
    <li className="border-t border-black/[0.05]">
      <button onClick={onToggle} className="w-full cursor-pointer px-4 py-2 text-left hover:bg-white/60" aria-expanded={open}>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-[13px] font-medium text-[#202124]">{outlet.name}</span>
          <span className="flex shrink-0 items-center gap-2">
            <span className="text-[13px] tabular-nums text-[#202124]">
              {outlet.level_m >= 0 ? "+" : ""}
              {outlet.level_m.toFixed(2)} m {outlet.trend === "rising" ? "↑" : "↓"}
            </span>
            <span className="rounded-full px-2 py-px text-[10px] font-medium" style={{ background: d.bg, color: d.fg }}>
              {d.label}
            </span>
          </span>
        </div>
        <MiniChart
          height={30}
          lines={[{ points, color: "#1a73e8", width: 1.6 }]}
          refs={[{ y: outlet.thresholds.p90, color: "#d93025" }]}
          nowX={0}
        />
      </button>
      {open && (
        <div className="space-y-1 px-4 pb-3 text-xs text-[#5f6368]">
          <div>
            Next high: {nextHigh ? `${fmtTime(nextHigh.time)} · ${nextHigh.level_m.toFixed(2)} m` : "—"} · local high-water line{" "}
            {outlet.thresholds.p90.toFixed(2)} m (90th pct.)
          </div>
          <div>
            Tide-averaged sea level {outlet.tide_filtered_anomaly_m >= 0 ? "+" : ""}
            {outlet.tide_filtered_anomaly_m.toFixed(2)} m vs. normal (monsoon set-up / surge)
          </div>
          {outlet.high_water_windows[0] && (
            <div>
              High water ≥ line: {fmtTime(outlet.high_water_windows[0].start)} → {fmtTime(outlet.high_water_windows[0].end)} (peak{" "}
              {outlet.high_water_windows[0].extreme_m.toFixed(2)} m)
            </div>
          )}
          {outlet.rivers.length > 0 && <div>Drains: {outlet.rivers.map((r) => r.name).join(", ")}</div>}
        </div>
      )}
    </li>
  );
}

export function CoastalWidget({ data }: { data: CoastalSnapshot | null }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  if (!data) return null;
  const now = new Date(data.now).getTime();
  const constrained = data.outlets.filter((o) => o.drainage !== "FREE_DRAINING").length;

  return (
    <GlassPanel className="w-[340px] p-0">
      <div className="flex items-start justify-between gap-2 px-4 pb-2 pt-3">
        <div>
          <div className="text-[15px] font-medium text-[#202124]">Arabian Sea · Kerala coast</div>
          <div className="text-xs text-[#70757a]">
            Sea level at river mouths · {constrained ? `${constrained} constrained` : "all free draining"}
            {data.simulated_surge_m > 0 && ` · +${data.simulated_surge_m.toFixed(2)} m simulated surge`}
          </div>
        </div>
        <button
          onClick={() => setShowInfo((s) => !s)}
          aria-label="Why sea level matters"
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-[#5f6368] hover:bg-white/70"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
            <path d="M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2m0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8" />
          </svg>
        </button>
      </div>
      {showInfo && (
        <div className="mx-4 mb-2 rounded-lg bg-white/55 px-3 py-2 text-xs leading-relaxed text-[#3c4043]">
          Rivers can only empty into the sea as fast as the sea allows. When high tide or monsoon surge raises the sea at a
          river mouth while the river is in spate, water backs up into the lower reaches and backwaters (Vembanad,
          Kuttanad) — a drainage failure reported during the August 2018 floods. Levels are hourly from the Copernicus
          Marine global ocean model (tide + surge, assimilating satellite altimetry). “Backwater risk” = high water within
          24 h while a river draining there is at Advisory or above.
        </div>
      )}
      <ul className="max-h-[30vh] overflow-y-auto varuna-scrollbar pb-1">
        {data.outlets.map((o) => (
          <OutletRow key={o.id} outlet={o} now={now} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? null : o.id)} />
        ))}
      </ul>
    </GlassPanel>
  );
}
