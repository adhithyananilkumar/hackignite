"use client";

import { useEffect, useState } from "react";
import { api, type LandslideLevel, type LandslideSnapshot } from "../lib/api";
import { GlassPanel } from "./glass/GlassPanel";

export const LANDSLIDE_LEVEL: Record<LandslideLevel, { label: string; bg: string; fg: string; dot: string }> = {
  GREEN: { label: "No trigger", bg: "#e6f4ea", fg: "#137333", dot: "#1e8e3e" },
  YELLOW: { label: "Watch", bg: "#fef7e0", fg: "#b06000", dot: "#f9ab00" },
  ORANGE: { label: "Alert", bg: "#feefe3", fg: "#c26401", dot: "#fa7b17" },
  RED: { label: "Warning", bg: "#c5221f", fg: "#ffffff", dot: "#c5221f" },
};

const POLL_MS = 60000;

export function useLandslide(sourceKey?: string) {
  const [data, setData] = useState<LandslideSnapshot | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => api.landslide().then((d) => !cancelled && setData(d)).catch(() => {});
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [sourceKey]);
  return data;
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-black/[0.08]">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: color }} />
    </div>
  );
}

export function LandslideWidget({ data, onFocus }: { data: LandslideSnapshot | null; onFocus: (lon: number, lat: number, id: string) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!data) return null;
  const active = data.sites.filter((s) => s.level !== "GREEN").length;
  const t72 = data.thresholds.rain_72h_mm;

  return (
    <GlassPanel className="w-[340px] p-0">
      <div className="px-4 pb-2 pt-3">
        <div className="text-[15px] font-medium text-[#202124]">Urulpottal · landslide watch</div>
        <div className="text-xs text-[#70757a]">
          {data.sites.length} hotspots · {active ? `${active} above normal` : "no triggers"} · rain + ground sensors
        </div>
      </div>
      <ul className="max-h-[28vh] overflow-y-auto varuna-scrollbar pb-1">
        {data.sites.map((s) => {
          const lvl = LANDSLIDE_LEVEL[s.level];
          const open = openId === s.id;
          return (
            <li key={s.id} className="border-t border-black/[0.05]">
              <button
                onClick={() => {
                  setOpenId(open ? null : s.id);
                  if (!open) onFocus(s.coordinates[0], s.coordinates[1], s.id);
                }}
                aria-expanded={open}
                className="w-full cursor-pointer px-4 py-2 text-left hover:bg-white/60"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-[#202124]">{s.name}</span>
                    <span className="block truncate text-[11px] text-[#70757a]">
                      {s.district} · {s.rain_72h_mm} mm / 72 h · {s.node.vibration_events_per_h} vib/h
                      {s.node.anomaly && " · ground movement"}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full px-2 py-px text-[10px] font-medium" style={{ background: lvl.bg, color: lvl.fg }}>
                    {lvl.label}
                  </span>
                </div>
                <div className="mt-1.5">
                  <Bar value={s.rain_72h_mm} max={t72.warning} color={lvl.dot} />
                </div>
              </button>
              {open && (
                <div className="space-y-2 px-4 pb-3 text-xs text-[#3c4043]">
                  <div className="text-[#5f6368]">{s.message}</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      [`${s.rain_24h_mm}`, "mm, last 24 h"],
                      [`${s.rain_72h_mm}`, "mm, last 72 h"],
                      [`${s.rain_next_24h_mm}`, "mm, next 24 h"],
                    ].map(([v, l]) => (
                      <div key={l} className="rounded-lg bg-white/55 px-2 py-1.5">
                        <div className="text-sm font-medium tabular-nums">{v}</div>
                        <div className="text-[10px] text-[#5f6368]">{l}</div>
                      </div>
                    ))}
                  </div>
                  <div className="rounded-lg bg-white/55 px-2.5 py-2">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-medium">Sensor node</span>
                      <span className="rounded-full border border-black/[0.1] px-1.5 text-[10px] text-[#5f6368]">{s.node.status}</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 tabular-nums">
                      <span>
                        <b className={s.node.vibration_events_per_h >= 25 ? "text-[#c5221f]" : ""}>{s.node.vibration_events_per_h}</b>/h
                        <span className="block text-[10px] text-[#70757a]">Geophone events</span>
                      </span>
                      <span>
                        <b className={s.node.tilt_deg_per_day >= 0.15 ? "text-[#c5221f]" : ""}>{s.node.tilt_deg_per_day}</b>°/d
                        <span className="block text-[10px] text-[#70757a]">Tilt rate</span>
                      </span>
                      <span>
                        <b>{s.node.pore_pressure_kpa}</b> kPa
                        <span className="block text-[10px] text-[#70757a]">Pore pressure</span>
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-[#70757a]">
                    Soil moisture {s.soil_moisture} m³/m³ · Next 24 h outlook: {LANDSLIDE_LEVEL[s.outlook_level].label} · {s.history}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="border-t border-black/[0.05] px-4 py-2 text-[10px] leading-snug text-[#70757a]">
        Rain: {data.rain_source}. Sensors: {data.sensor_source}. Thresholds are indicative.
      </div>
    </GlassPanel>
  );
}
