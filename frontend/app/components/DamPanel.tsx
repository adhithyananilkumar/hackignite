import type { DamReading } from "../lib/api";
import { GlassPanel } from "./glass/GlassPanel";

export function DamPanel({
  name,
  reading,
  onClose,
}: {
  name: string;
  reading: DamReading | undefined;
  onClose: () => void;
}) {
  if (!reading) return null;

  return (
    <GlassPanel strong className="w-[360px]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-sm text-[var(--glass-text-dim)]">DAM</div>
          <div className="text-xl font-semibold">{name}</div>
        </div>
        <button onClick={onClose} className="text-[var(--glass-text-dim)] hover:text-[var(--glass-text)] cursor-pointer">
          ✕
        </button>
      </div>

      <div className={`inline-block mb-3 rounded-full px-2.5 py-0.5 text-xs font-semibold risk-text-${reading.risk}`}>
        <span className={`risk-dot risk-${reading.risk} mr-1.5`} />
        {reading.risk}
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm mb-1">
          <span>Storage</span>
          <span className="font-semibold">{reading.storage_pct}%</span>
        </div>
        <div className="h-3 rounded-full bg-[var(--glass-highlight)] overflow-hidden">
          <div className={`h-full risk-${reading.risk}`} style={{ width: `${reading.storage_pct}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2">
          <div className="text-lg font-semibold">{reading.inflow_m3s} m³/s</div>
          <div className="text-[11px] text-[var(--glass-text-dim)]">Inflow</div>
        </div>
        <div className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2">
          <div className="text-lg font-semibold">{reading.outflow_m3s} m³/s</div>
          <div className="text-[11px] text-[var(--glass-text-dim)]">Outflow</div>
        </div>
      </div>

      <div className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2">
        <div className="text-sm font-semibold">
          Rule curve status: <span className="risk-text-WATCH">{reading.rule_level_status}</span>
        </div>
        <div className="text-[11px] text-[var(--glass-text-dim)] mt-1">
          Reflects Kerala&apos;s approved rule curve / EAP thresholds, not a control command.
        </div>
      </div>
    </GlassPanel>
  );
}
