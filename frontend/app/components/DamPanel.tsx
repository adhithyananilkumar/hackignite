"use client";

import { useEffect, useState } from "react";
import { api, type DamReading, type ReservoirOutlook, type ReservoirStatus } from "../lib/api";
import { DRAINAGE } from "./CoastalWidget";
import { MiniChart } from "./MiniChart";
import { PanelHeader, Section } from "./PanelParts";

const REFRESH_MS = 30000;

const STATUS: Record<ReservoirStatus, { label: string; bg: string; fg: string }> = {
  COMFORTABLE: { label: "Comfortable", bg: "#e6f4ea", fg: "#137333" },
  WATCH: { label: "Watch", bg: "#fef7e0", fg: "#b06000" },
  PRE_RELEASE_REVIEW: { label: "Pre-release review advised", bg: "#feefe3", fg: "#c26401" },
  CRITICAL: { label: "Critical — review now", bg: "#c5221f", fg: "#ffffff" },
  INSUFFICIENT_DATA: { label: "Partial data", bg: "rgba(60,64,67,0.08)", fg: "#5f6368" },
};

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg bg-white/55 px-3 py-2">
      <div className="text-base font-medium tabular-nums text-[#202124]">{value}</div>
      <div className="text-xs text-[#5f6368]">{label}</div>
    </div>
  );
}

function useOutlook(damId: string, refreshKey: string) {
  const [outlook, setOutlook] = useState<ReservoirOutlook | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .reservoirOutlook(damId)
        .then((o) => {
          if (cancelled) return;
          setOutlook(o);
          setError(false);
        })
        .catch(() => !cancelled && setError(true));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [damId, refreshKey]);
  return { outlook: outlook?.dam_id === damId ? outlook : null, error };
}

export function DamPanel({
  damId,
  name,
  subtitle,
  reading,
  riverNames,
  onClose,
}: {
  damId: string;
  name: string;
  subtitle?: string;
  reading: DamReading | undefined;
  riverNames: Record<string, string>;
  onClose: () => void;
}) {
  const { outlook, error } = useOutlook(damId, reading?.source ?? "");
  if (!reading) return null;
  const noFeed = reading.source === "static";
  const status = outlook ? STATUS[outlook.status] : null;
  const rec = outlook?.recommendation;
  const down = outlook?.downstream;

  return (
    <div>
      <PanelHeader
        title={name}
        subtitle={subtitle ?? "Reservoir"}
        risk={reading.risk}
        badge={noFeed ? "No live storage feed" : reading.source === "simulation" ? "Simulated" : "Live"}
        onBack={onClose}
      />

      <Section title="Storage & flows">
        {noFeed ? (
          <div className="mb-3 text-xs text-[#5f6368]">
            Storage and gate outflow need KSEB / Irrigation telemetry, which isn&apos;t publicly available; inflow below is
            estimated from GloFAS.
          </div>
        ) : (
          <>
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-[#5f6368]">Current storage</span>
              <span className="font-medium">{reading.storage_pct}%</span>
            </div>
            <div className="mb-3 h-2 overflow-hidden rounded-full bg-black/[0.08]">
              <div className={`h-full risk-${reading.risk}`} style={{ width: `${reading.storage_pct}%` }} />
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Stat
            value={outlook ? `${Math.round(outlook.inflow_forecast[0].median_m3s).toLocaleString()} m³/s` : noFeed ? "…" : `${reading.inflow_m3s.toLocaleString()} m³/s`}
            label={noFeed ? "Est. inflow (GloFAS)" : "Inflow"}
          />
          <Stat value={noFeed ? "—" : `${reading.outflow_m3s.toLocaleString()} m³/s`} label="Outflow" />
        </div>
      </Section>

      <Section title="Inflow outlook · next 72 h">
        {outlook ? (
          <>
            <MiniChart
              height={64}
              bands={[{
                upper: outlook.inflow_forecast.map((p) => [p.hours, p.worst_m3s]),
                lower: outlook.inflow_forecast.map((p) => [p.hours, p.median_m3s]),
                color: "#d93025",
                opacity: 0.15,
              }]}
              lines={[
                { points: outlook.inflow_forecast.map((p) => [p.hours, p.median_m3s]), color: "#1a73e8" },
                { points: outlook.inflow_forecast.map((p) => [p.hours, p.worst_m3s]), color: "#d93025", width: 1.4, dash: "4 3" },
              ]}
              xLabels={[{ x: 0, label: "now" }, { x: 72, label: "+72h" }]}
            />
            <div className="mt-2 text-xs text-[#5f6368]">
              <span className="font-medium text-[#1a73e8]">Median</span> vs{" "}
              <span className="font-medium text-[#d93025]">worst case</span>. Worst-case volume in 72 h:{" "}
              <span className="font-medium text-[#202124]">{outlook.worst_case_inflow_72h_mcm.toLocaleString()} million m³</span>
              {outlook.worst_case_inflow_72h_pct_of_capacity != null && ` (${outlook.worst_case_inflow_72h_pct_of_capacity}% of capacity)`}.
              <div className="mt-0.5 text-[11px] text-[#70757a]">{outlook.inputs.inflow_source}</div>
            </div>
          </>
        ) : (
          <div className="text-xs text-[#5f6368]">{error ? "Inflow outlook unavailable right now." : "Loading inflow outlook…"}</div>
        )}
      </Section>

      {outlook && status && (
        <Section title="Release advisory">
          <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: status.bg, color: status.fg }}>
            {status.label}
          </span>
          <p className="mt-2 text-[13px] leading-snug text-[#202124]">{outlook.headline}</p>

          {outlook.projection && (
            <div className="mt-3">
              <MiniChart
                height={70}
                lines={[
                  { points: outlook.projection.map((p) => [p.hours, p.median_pct]), color: "#1a73e8" },
                  { points: outlook.projection.map((p) => [p.hours, p.worst_pct]), color: "#d93025", width: 1.4, dash: "4 3" },
                ]}
                refs={[
                  { y: outlook.upper_rule_pct, color: "#c26401", label: `${outlook.upper_rule_pct}% upper rule level` },
                  { y: 100, color: "#c5221f", label: "Full" },
                ]}
                xLabels={[{ x: 0, label: "now" }, { x: 72, label: "+72h" }]}
              />
              <div className="mt-1 text-[11px] text-[#70757a]">Projected storage (%) at current outflow</div>
            </div>
          )}

          {rec && (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat value={`${rec.volume_to_release_mcm.toLocaleString()} Mm³`} label="Volume to pre-release" />
              <Stat value={`+${Math.round(rec.extra_release_if_started_now_m3s).toLocaleString()} m³/s`} label="Extra release if started now" />
              <Stat value={rec.latest_start ? fmt(rec.latest_start) : "Now"} label="Latest start (at downstream capacity)" />
              <Stat
                value={rec.fits_downstream_capacity == null ? "Unknown" : rec.fits_downstream_capacity ? "Yes" : "No"}
                label="Fits downstream capacity"
              />
            </div>
          )}

          {down?.river_id && (
            <div className="mt-3 text-xs text-[#5f6368]">
              Downstream: <span className="font-medium text-[#202124]">{riverNames[down.river_id] ?? down.river_id}</span>
              {down.link === "nearest" && " (nearest modelled river)"}
              {down.headroom_m3s != null &&
                ` · ${Math.round(down.flow_now_m3s ?? 0).toLocaleString()} of ${Math.round(down.warning_flow_m3s ?? 0).toLocaleString()} m³/s warning flow · ${Math.round(down.headroom_m3s).toLocaleString()} m³/s spare`}
            </div>
          )}

          {outlook.coast && (
            <div className="mt-3 rounded-lg bg-white/55 px-3 py-2 text-xs text-[#3c4043]">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">Sea at {outlook.coast.outlet}</span>
                <span
                  className="rounded-full px-2 py-px text-[10px] font-medium"
                  style={{ background: DRAINAGE[outlook.coast.drainage].bg, color: DRAINAGE[outlook.coast.drainage].fg }}
                >
                  {DRAINAGE[outlook.coast.drainage].label}
                </span>
              </div>
              {outlook.coast.low_tide_windows.length > 0 && (
                <div>
                  Low-tide windows (released water drains freely):{" "}
                  {outlook.coast.low_tide_windows.slice(0, 3).map((w) => `${fmt(w.start)}–${new Date(w.end).toLocaleTimeString("en-IN", { hour: "numeric", timeZone: "Asia/Kolkata" })}`).join(", ")}
                </div>
              )}
              {outlook.coast.high_water_windows.length > 0 && (
                <div className="mt-0.5">
                  Avoid peak releases around high water: {outlook.coast.high_water_windows.slice(0, 2).map((w) => fmt(w.start)).join(", ")}
                </div>
              )}
            </div>
          )}

          <div className="mt-3 text-[11px] leading-snug text-[#70757a]">{outlook.disclaimer}</div>
        </Section>
      )}
    </div>
  );
}
