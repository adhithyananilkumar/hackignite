"use client";

import { useEffect, useState } from "react";
import { api, type DataHealthSource } from "../lib/api";
import { GlassPanel } from "./glass/GlassPanel";

const STATUS_COLOR: Record<string, string> = {
  LIVE: "risk-text-NORMAL",
  SIMULATED: "risk-text-WATCH",
  STATIC: "risk-text-ADVISORY",
  OFFLINE: "risk-text-CRITICAL",
  UNAVAILABLE: "risk-text-CRITICAL",
};

export function DataHealthPanel() {
  const [sources, setSources] = useState<DataHealthSource[]>([]);

  useEffect(() => {
    const load = () => api.health().then((r) => setSources(r.sources)).catch(() => {});
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  return (
    <GlassPanel title="Data health" className="w-[280px]">
      <div className="flex flex-col gap-1.5">
        {sources.map((s) => (
          <div key={s.name} className="flex items-center justify-between text-xs">
            <span className="text-[var(--glass-text-dim)]">{s.name}</span>
            <span className={`font-semibold ${STATUS_COLOR[s.status] ?? ""}`}>{s.status}</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
