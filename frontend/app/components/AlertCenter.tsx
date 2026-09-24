"use client";

import { useEffect, useState } from "react";
import { api, type Alert } from "../lib/api";
import { GlassPanel } from "./glass/GlassPanel";

export function AlertCenter() {
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

  return (
    <GlassPanel title={`Active alerts (${alerts.filter((a) => !a.acknowledged).length})`} className="w-[320px] max-h-[38vh] overflow-y-auto varuna-scrollbar">
      {alerts.length === 0 && (
        <div className="text-sm text-[var(--glass-text-dim)]">No active alerts — all basins NORMAL.</div>
      )}
      <div className="flex flex-col gap-2">
        {alerts.map((alert) => (
          <div key={alert.id} className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold risk-text-${alert.risk}`}>
                <span className={`risk-dot risk-${alert.risk} mr-1.5`} />
                {alert.risk}
              </span>
              <span className="text-[10px] uppercase text-[var(--glass-text-dim)]">{alert.target_type}</span>
            </div>
            <div className="text-sm font-medium mt-1 capitalize">{alert.target_id}</div>
            <div className="text-xs text-[var(--glass-text-dim)] mt-0.5">{alert.message}</div>
            {!alert.acknowledged && (
              <button
                onClick={() => ack(alert.id)}
                className="mt-2 text-[11px] glass-button px-2.5 py-1"
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
