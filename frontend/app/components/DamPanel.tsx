import type { DamReading } from "../lib/api";
import { PanelHeader, Section } from "./PanelParts";

export function DamPanel({
  name,
  subtitle,
  reading,
  onClose,
}: {
  name: string;
  subtitle?: string;
  reading: DamReading | undefined;
  onClose: () => void;
}) {
  if (!reading) return null;
  const noFeed = reading.source === "static";

  return (
    <div>
      <PanelHeader title={name} subtitle={subtitle ?? "Reservoir"} risk={reading.risk} badge={noFeed ? "No live feed" : reading.source === "simulation" ? "Simulated" : "Live"} onBack={onClose} />

      <Section title="Storage">
        <div className="mb-1 flex justify-between text-sm">
          <span className="text-[#5f6368]">Current storage</span>
          <span className="font-medium">{reading.storage_pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#e8eaed]">
          <div className={`h-full risk-${reading.risk}`} style={{ width: `${reading.storage_pct}%` }} />
        </div>
      </Section>

      <Section title="Flows">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-[#f1f3f4] px-3 py-2">
            <div className="text-lg font-medium tabular-nums">{reading.inflow_m3s.toLocaleString()} m³/s</div>
            <div className="text-xs text-[#5f6368]">Inflow</div>
          </div>
          <div className="rounded-lg bg-[#f1f3f4] px-3 py-2">
            <div className="text-lg font-medium tabular-nums">{reading.outflow_m3s.toLocaleString()} m³/s</div>
            <div className="text-xs text-[#5f6368]">Outflow</div>
          </div>
        </div>
      </Section>

      <Section title="Rule curve">
        <div className="text-sm">
          Status: <span className="font-medium risk-text-WATCH">{reading.rule_level_status}</span>
        </div>
        <div className="mt-1 text-xs text-[#5f6368]">
          {noFeed
            ? "No public KSEB telemetry is connected; values are a static placeholder."
            : "Reflects Kerala's approved rule curve / EAP thresholds, not a control command."}
        </div>
      </Section>
    </div>
  );
}
