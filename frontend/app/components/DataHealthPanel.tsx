"use client";

import { useEffect, useState } from "react";
import { api, type DataHealthSource } from "../lib/api";

const STATUS_COLOR: Record<string, string> = {
  LIVE: "#1e8e3e",
  SIMULATED: "#f9ab00",
  STATIC: "#fa7b17",
  MODELLED: "#1a73e8",
  DEGRADED: "#fa7b17",
  "NOT CONNECTED": "#9aa0a6",
  OFFLINE: "#d93025",
  UNAVAILABLE: "#d93025",
};

// `refreshKey` changes when the data source or its feed state changes.
export function DataHealthList({ refreshKey }: { refreshKey?: string }) {
  const [sources, setSources] = useState<DataHealthSource[]>([]);

  useEffect(() => {
    const load = () => api.health().then((r) => setSources(r.sources)).catch(() => {});
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, [refreshKey]);

  return (
    <ul className="flex flex-col">
      {sources.map((s) => {
        const color = STATUS_COLOR[s.status] ?? "#9aa0a6";
        return (
          <li key={s.name} className="flex items-start gap-3 py-2">
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-[#202124]">{s.name}</div>
              <div className="truncate text-xs text-[#70757a]" title={s.detail}>
                {s.detail}
              </div>
            </div>
            <span className="shrink-0 text-[11px] font-medium" style={{ color }}>
              {s.status}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
