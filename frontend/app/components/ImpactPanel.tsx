import type { ExposedAsset, FloodHorizon } from "../lib/api";

const TYPE_ORDER: Record<ExposedAsset["type"], number> = { hospital: 0, shelter: 1, school: 2, bridge: 3 };
const TYPE_COLOR: Record<ExposedAsset["type"], string> = {
  hospital: "#ff6b6b",
  shelter: "#35c2f0",
  school: "#ffd166",
  bridge: "#b9c4cc",
};
const LISTED_FACILITIES = 6;

export function ImpactPanel({
  horizon,
  label,
  onFocusAsset,
}: {
  horizon: FloodHorizon;
  label: string;
  onFocusAsset?: (asset: ExposedAsset) => void;
}) {
  const rows: [string, string][] = [
    ["Flooded area", `${horizon.flooded_area_km2.toLocaleString()} km²`],
    ["Population", horizon.population.toLocaleString()],
    ["Hospitals", String(horizon.hospitals)],
    ["Schools", String(horizon.schools)],
    ["Shelters", String(horizon.shelters)],
    ["Bridges", String(horizon.bridges)],
  ];
  const facilities = horizon.exposed_assets
    .filter((a) => a.type !== "bridge")
    .sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || b.depth_m - a.depth_m)
    .slice(0, LISTED_FACILITIES);

  return (
    <div>
      <div className="mb-2 text-[11px] uppercase tracking-wider text-[var(--glass-text-dim)]">
        Forecast impact at {label} — modelled potential exposure
      </div>
      <div className="grid grid-cols-3 gap-2">
        {rows.map(([name, value]) => (
          <div key={name} className="rounded-lg bg-[var(--glass-highlight)] px-2.5 py-2">
            <div className="text-base font-semibold tabular-nums">{value}</div>
            <div className="text-[11px] text-[var(--glass-text-dim)]">{name}</div>
          </div>
        ))}
      </div>

      {facilities.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-[11px] uppercase tracking-wider text-[var(--glass-text-dim)]">
            Facilities inside the extent
          </div>
          <div className="flex flex-col gap-0.5">
            {facilities.map((a) => (
              <button
                key={a.id}
                onClick={() => onFocusAsset?.(a)}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-[var(--glass-highlight)]"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLOR[a.type] }} />
                  <span className="truncate">{a.name}</span>
                </span>
                <span className="shrink-0 tabular-nums text-[var(--glass-text-dim)]">~{a.depth_m.toFixed(1)} m</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
