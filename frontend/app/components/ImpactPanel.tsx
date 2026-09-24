import type { ImpactSummary } from "../lib/api";

export function ImpactPanel({ impact }: { impact: ImpactSummary }) {
  const rows: [string, number][] = [
    ["Population", impact.population],
    ["Hospitals", impact.hospitals],
    ["Schools", impact.schools],
    ["Shelters", impact.shelters],
    ["Bridges", impact.bridges],
  ];

  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[var(--glass-text-dim)] mb-2">
        Forecast impact — modelled potential exposure
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-[var(--glass-highlight)] px-3 py-2">
            <div className="text-lg font-semibold">{value.toLocaleString()}</div>
            <div className="text-[11px] text-[var(--glass-text-dim)]">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
