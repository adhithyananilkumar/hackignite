"use client";

import { useEffect, useState } from "react";
import {
  api,
  type LiveSourceStatus,
  type SimulationSourceStatus,
  type SourceMode,
  type SourcesState,
} from "../lib/api";
import type { LiveSnapshot } from "../lib/useLiveData";
import { GlassPanel } from "./glass/GlassPanel";

const LIVE_STATE: Record<LiveSourceStatus["state"], { color: string; label: string }> = {
  ok: { color: "#1e8e3e", label: "All live feeds reporting" },
  degraded: { color: "#f9ab00", label: "Some live feeds missing" },
  loading: { color: "#9aa0a6", label: "Connecting to live feeds…" },
  unavailable: { color: "#d93025", label: "Live feeds unavailable" },
};

function minutesAgo(iso: string | null) {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return mins < 1 ? "just now" : `${mins} min ago`;
}

export function DataSourceSwitcher({ snapshot, connected }: { snapshot: LiveSnapshot | null; connected: boolean }) {
  const [sources, setSources] = useState<SourcesState | null>(null);
  const [busy, setBusy] = useState(false);

  // Static parts (mode list, scenarios) come from /sources; the active
  // provider's status streams in with every WebSocket snapshot.
  useEffect(() => {
    api.sources().then(setSources).catch(() => {});
  }, [snapshot?.mode]);

  if (!sources) return null;
  const mode = snapshot?.mode ?? sources.mode;
  const live = ((mode === "live" && snapshot?.source_status) || sources.status.live) as LiveSourceStatus;
  const sim = ((mode === "simulation" && snapshot?.source_status) || sources.status.simulation) as SimulationSourceStatus;

  const run = (request: Promise<SourcesState>) => {
    setBusy(true);
    request.then(setSources).catch(() => {}).finally(() => setBusy(false));
  };
  const switchTo = (next: SourceMode) => next !== mode && run(api.setSourceMode(next));

  return (
    <GlassPanel className="pointer-events-auto w-[340px] p-0">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span className="text-[15px] font-medium text-[#202124]">Data source</span>
        <span className="flex items-center gap-1.5 text-xs text-[#5f6368]" title="Streaming connection to the VARUNA backend">
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-[#1e8e3e]" : "bg-[#9aa0a6]"}`} />
          {connected ? "Connected" : "Reconnecting…"}
        </span>
      </div>

      <div className="px-4 pb-3">
        <div role="radiogroup" aria-label="Data source" className="flex rounded-lg border border-black/[0.1] bg-white/35 p-0.5">
          {sources.modes.map((m) => {
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                role="radio"
                aria-checked={active}
                title={m.description}
                disabled={busy}
                onClick={() => switchTo(m.id)}
                className={`flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] font-medium transition-colors ${
                  active ? "bg-[#e8f0fe] text-[#1967d2]" : "text-[#5f6368] hover:bg-white/60"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.id === "live" ? "#1e8e3e" : "#f9ab00" }} />
                {m.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3">
          {mode === "live" ? (
            <LiveStatus status={live} />
          ) : (
            <SimulationControls status={sim} busy={busy} onControl={(body) => run(api.controlSimulation(body))} />
          )}
        </div>
      </div>
    </GlassPanel>
  );
}

function LiveStatus({ status }: { status: LiveSourceStatus }) {
  const s = LIVE_STATE[status.state];
  const updated = minutesAgo(status.last_updated);
  return (
    <div className="text-xs" title="Copernicus GloFAS discharge + Open-Meteo rainfall">
      <div className="flex items-center gap-2 text-[13px] text-[#202124]">
        <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
        {s.label}
      </div>
      {status.state !== "loading" && (
        <div className="mt-0.5 pl-4 text-[#70757a]">
          GloFAS + Open-Meteo · {status.gauges_live}/{status.gauges_total} gauges{updated ? ` · updated ${updated}` : ""}
        </div>
      )}
    </div>
  );
}

function SimulationControls({
  status,
  busy,
  onControl,
}: {
  status: SimulationSourceStatus;
  busy: boolean;
  onControl: (body: { scenario_id?: string; action?: "play" | "pause" | "restart"; speed?: number }) => void;
}) {
  const iconButton =
    "flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[#5f6368] hover:bg-white/70 disabled:opacity-50";

  return (
    <div>
      <select
        aria-label="Scenario"
        value={status.scenario_id}
        disabled={busy}
        onChange={(e) => onControl({ scenario_id: e.target.value })}
        title={status.scenarios.find((s) => s.id === status.scenario_id)?.description}
        className="w-full cursor-pointer rounded-lg border border-black/[0.1] bg-white/60 px-2.5 py-1.5 text-[13px] text-[#202124] outline-none focus:border-[#1a73e8]"
      >
        {status.scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <div className="mt-2 flex items-center gap-1">
        <button
          className={iconButton}
          disabled={busy}
          aria-label={status.playing ? "Pause scenario" : "Play scenario"}
          onClick={() => onControl({ action: status.playing ? "pause" : "play" })}
        >
          {status.playing ? (
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
        <button className={iconButton} disabled={busy} aria-label="Restart scenario" onClick={() => onControl({ action: "restart" })}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 12a8 8 0 1 0 2.4-5.7" />
            <path d="M4 4v4h4" />
          </svg>
        </button>

        <div className="ml-1 flex flex-1 flex-col gap-1" title="Scenario time">
          <div className="h-1 overflow-hidden rounded-full bg-black/[0.08]">
            <div className="h-full bg-[#1a73e8] transition-all duration-1000" style={{ width: `${status.progress * 100}%` }} />
          </div>
          <div className="text-[11px] tabular-nums text-[#70757a]">
            T+{status.scenario_hours}h of {status.represents_hours}h · simulated
          </div>
        </div>

        <div className="ml-1 flex rounded-full border border-black/[0.1] bg-white/35 p-0.5">
          {status.speeds.map((speed) => (
            <button
              key={speed}
              disabled={busy}
              onClick={() => onControl({ speed })}
              className={`cursor-pointer rounded-full px-1.5 py-0.5 text-[11px] font-medium ${
                speed === status.speed ? "bg-[#e8f0fe] text-[#1967d2]" : "text-[#5f6368] hover:bg-white/70"
              }`}
            >
              {speed}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
