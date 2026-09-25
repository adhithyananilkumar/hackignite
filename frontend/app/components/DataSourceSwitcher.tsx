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
  ok: { color: "#3ddc84", label: "Live feeds" },
  degraded: { color: "#f5a623", label: "Partially live" },
  loading: { color: "#9fb3bd", label: "Connecting to live feeds…" },
  unavailable: { color: "#ff3b3b", label: "Live feeds unavailable" },
};

function minutesAgo(iso: string | null) {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return mins < 1 ? "just now" : `${mins} min ago`;
}

export function DataSourceSwitcher({ snapshot }: { snapshot: LiveSnapshot | null }) {
  const [sources, setSources] = useState<SourcesState | null>(null);
  const [busy, setBusy] = useState(false);

  // Static parts (mode list, scenarios) come from /sources; the active
  // provider's status streams in with every WebSocket snapshot.
  useEffect(() => {
    api.sources().then(setSources).catch(() => {});
  }, [snapshot?.mode]);

  if (!sources) return null;
  const mode = snapshot?.mode ?? sources.mode;
  const live = (mode === "live" && snapshot?.source_status) || sources.status.live;
  const sim = ((mode === "simulation" && snapshot?.source_status) || sources.status.simulation) as SimulationSourceStatus;

  const run = (request: Promise<SourcesState>) => {
    setBusy(true);
    request.then(setSources).catch(() => {}).finally(() => setBusy(false));
  };
  const switchTo = (next: SourceMode) => next !== mode && run(api.setSourceMode(next));

  return (
    <GlassPanel strong className="pointer-events-auto flex items-center gap-3 py-2">
      <div role="radiogroup" aria-label="Data source" className="flex rounded-full bg-[var(--glass-highlight)] p-0.5">
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
              className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                active ? "bg-[var(--accent,#35c2f0)] text-[#04111a]" : "text-[var(--glass-text-dim)] hover:text-[var(--glass-text)]"
              }`}
            >
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: m.id === "live" ? "#3ddc84" : "#f4d35e" }}
              />
              {m.label.toUpperCase()}
            </button>
          );
        })}
      </div>

      {mode === "live" ? (
        <LiveStatus status={live as LiveSourceStatus} />
      ) : (
        <SimulationControls status={sim} busy={busy} onControl={(body) => run(api.controlSimulation(body))} />
      )}
    </GlassPanel>
  );
}

function LiveStatus({ status }: { status: LiveSourceStatus }) {
  const s = LIVE_STATE[status.state];
  const updated = minutesAgo(status.last_updated);
  return (
    <div className="flex items-center gap-2 text-xs" title="Copernicus GloFAS discharge + Open-Meteo rainfall">
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />
      <span className="font-semibold">{s.label}</span>
      {status.state !== "loading" && (
        <span className="text-[var(--glass-text-dim)]">
          GloFAS · {status.gauges_live}/{status.gauges_total} gauges{updated ? ` · ${updated}` : ""}
        </span>
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
    "flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-[var(--glass-highlight)] text-[var(--glass-text)] hover:brightness-125 disabled:opacity-50";

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Scenario"
        value={status.scenario_id}
        disabled={busy}
        onChange={(e) => onControl({ scenario_id: e.target.value })}
        title={status.scenarios.find((s) => s.id === status.scenario_id)?.description}
        className="max-w-[210px] cursor-pointer truncate rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-2 py-1 text-xs text-[var(--glass-text)] outline-none"
      >
        {status.scenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <button
        className={iconButton}
        disabled={busy}
        aria-label={status.playing ? "Pause scenario" : "Play scenario"}
        onClick={() => onControl({ action: status.playing ? "pause" : "play" })}
      >
        {status.playing ? (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="ml-0.5 h-3.5 w-3.5" fill="currentColor">
            <path d="M7 4.5v15l13-7.5z" />
          </svg>
        )}
      </button>
      <button className={iconButton} disabled={busy} aria-label="Restart scenario" onClick={() => onControl({ action: "restart" })}>
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <path d="M4 12a8 8 0 1 0 2.4-5.7" />
          <path d="M4 4v4h4" />
        </svg>
      </button>

      <div className="flex rounded-full bg-[var(--glass-highlight)] p-0.5">
        {status.speeds.map((speed) => (
          <button
            key={speed}
            disabled={busy}
            onClick={() => onControl({ speed })}
            className={`cursor-pointer rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              speed === status.speed ? "bg-[var(--glass-bg-strong)] text-[var(--glass-text)]" : "text-[var(--glass-text-dim)]"
            }`}
          >
            {speed}×
          </button>
        ))}
      </div>

      <div className="flex w-[118px] flex-col gap-0.5" title="Scenario time">
        <div className="h-1 overflow-hidden rounded-full bg-[var(--glass-highlight)]">
          <div className="h-full bg-[#f4d35e] transition-all duration-1000" style={{ width: `${status.progress * 100}%` }} />
        </div>
        <div className="text-[10px] tabular-nums text-[var(--glass-text-dim)]">
          T+{status.scenario_hours}h of {status.represents_hours}h · SIMULATED
        </div>
      </div>
    </div>
  );
}
