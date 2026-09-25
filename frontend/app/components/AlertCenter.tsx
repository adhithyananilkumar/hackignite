"use client";

import { useEffect, useState } from "react";
import { api, type Alert } from "../lib/api";
import { GlassPanel } from "./glass/GlassPanel";
import type { MapSelection } from "./KeralaMap";
import { RiskPill } from "./PanelParts";

export function AlertCenter({
  names,
  onSelect,
}: {
  names: Record<string, string>;
  onSelect: (selection: MapSelection) => void;
}) {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    const load = () => api.alerts().then(setAlerts).catch(() => {});
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function ack(id: string) {
    await api.ackAlert(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)));
  }

  const open = alerts.filter((a) => !a.acknowledged).length;

  return (
    <GlassPanel className="w-[340px] p-0">
      <div className="flex items-center justify-between px-4 pb-2 pt-3">
        <span className="text-[15px] font-medium text-[#202124]">Alerts</span>
        <span className="text-xs text-[#70757a]">{open ? `${open} need attention` : "All clear"}</span>
      </div>
      <div className="max-h-[22vh] overflow-y-auto varuna-scrollbar pb-2">
        {alerts.length === 0 && <div className="px-4 pb-2 text-sm text-[#5f6368]">No active alerts. All basins are normal.</div>}
        {alerts.map((alert) => (
          <div
            key={alert.id}
            className={`cursor-pointer border-t border-black/[0.05] px-4 py-2.5 hover:bg-white/60 ${alert.acknowledged ? "opacity-60" : ""}`}
            onClick={() => onSelect({ type: alert.target_type === "dam" ? "dam" : "river", id: alert.target_id })}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-[#202124]">{names[alert.target_id] ?? alert.target_id}</span>
              <RiskPill risk={alert.risk} compact />
            </div>
            <div className="mt-0.5 text-xs text-[#5f6368]">{alert.message}</div>
            {!alert.acknowledged && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  ack(alert.id);
                }}
                className="-ml-2 mt-1.5 cursor-pointer rounded-full px-2 py-0.5 text-xs font-medium text-[#1a73e8] hover:bg-[#e8f0fe]"
              >
                Acknowledge
              </button>
            )}
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
