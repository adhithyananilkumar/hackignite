import type { ExposedAsset, FloodHorizon } from "../lib/api";

const TYPE_ORDER: Record<ExposedAsset["type"], number> = { hospital: 0, shelter: 1, school: 2, bridge: 3 };
const TYPE_COLOR: Record<ExposedAsset["type"], string> = {
  hospital: "#d93025",
  shelter: "#1a73e8",
  school: "#e37400",
  bridge: "#5f6368",
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
      <div className="mb-2 text-xs text-[#70757a]">
        At {label.toLowerCase()} · modelled potential exposure, not confirmed damage
      </div>
      <div className="grid grid-cols-3 gap-2">
        {rows.map(([name, value]) => (
          <div key={name} className="rounded-lg bg-white/55 px-2.5 py-2">
            <div className="text-base font-medium tabular-nums text-[#202124]">{value}</div>
            <div className="text-[11px] text-[#5f6368]">{name}</div>
          </div>
        ))}
      </div>

      {facilities.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[13px] font-medium text-[#202124]">Facilities inside the flood area</div>
          <div className="flex flex-col gap-0.5">
            {facilities.map((a) => (
              <button
                key={a.id}
                onClick={() => onFocusAsset?.(a)}
                className="-mx-2 flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-[13px] text-[#202124] hover:bg-white/70"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLOR[a.type] }} />
                  <span className="truncate">{a.name}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-[#70757a]">~{a.depth_m.toFixed(1)} m deep</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
