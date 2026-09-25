"use client";

import { useState } from "react";
import type { FloodForecast, RiskLevel } from "../lib/api";
import { horizonTotals } from "../lib/useFloodForecast";
import type { LiveSnapshot } from "../lib/useLiveData";
import { AIAssistant } from "./AIAssistant";
import { DataHealthList } from "./DataHealthPanel";
import type { MapSelection } from "./KeralaMap";
import { RiskPill, Section } from "./PanelParts";

export type PlaceMeta = Record<string, { name: string; subtitle: string }>;

const RISK_ORDER: RiskLevel[] = ["NORMAL", "WATCH", "ADVISORY", "HIGH", "CRITICAL"];
const byRisk = <T extends { risk: RiskLevel }>(a: T, b: T) => RISK_ORDER.indexOf(b.risk) - RISK_ORDER.indexOf(a.risk);

function ListIcon({ kind }: { kind: "river" | "dam" }) {
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e8f0fe] text-[#1a73e8]">
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path
          d={
            kind === "river"
              ? "M2 12c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1.5M2 17c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1.5"
              : "M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6"
          }
        />
      </svg>
    </span>
  );
}

export function KeralaOverview({
  snapshot,
  flood,
  rivers: riverMeta,
  dams: damMeta,
  modeLabel,
  healthKey,
  onSelect,
}: {
  snapshot: LiveSnapshot | null;
  flood: FloodForecast | null;
  rivers: PlaceMeta;
  dams: PlaceMeta;
  modeLabel: string;
  healthKey: string;
  onSelect: (selection: MapSelection) => void;
}) {
  const [tab, setTab] = useState<"rivers" | "dams">("rivers");
  const rivers = snapshot ? Object.values(snapshot.rivers).sort(byRisk) : [];
  const dams = snapshot ? Object.values(snapshot.dams).sort(byRisk) : [];
  const worst = [...rivers, ...dams].reduce<RiskLevel>(
    (w, r) => (RISK_ORDER.indexOf(r.risk) > RISK_ORDER.indexOf(w) ? r.risk : w),
    "NORMAL"
  );
  const lastHorizon = (flood?.horizons_hours.length ?? 1) - 1;
  // Peak exposure across the forecast window, not just its last step: a
  // receding flood can be large now and small at +12h.
  const peakPeople = Math.max(0, ...(flood?.horizons_hours ?? []).map((_, i) => horizonTotals(flood, i).population));
  const riversAtRisk = rivers.filter((r) => r.risk !== "NORMAL").length;
  const damsOnWatch = dams.filter((d) => d.risk !== "NORMAL").length;

  return (
    <div>
      <div className="border-b border-[#e8eaed] px-5 pb-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-normal leading-7 text-[#202124]">Kerala</h2>
            <div className="mt-0.5 text-sm text-[#70757a]">Flood intelligence · {modeLabel}</div>
          </div>
          <RiskPill risk={worst} />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            [`${riversAtRisk}/${rivers.length}`, "Rivers at risk"],
            [peakPeople.toLocaleString(), `Peak people in flood area, next ${flood?.horizons_hours[lastHorizon] ?? 12}h`],
            [`${damsOnWatch}/${dams.length}`, "Dams on watch"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-lg bg-[#f1f3f4] px-2.5 py-2">
              <div className="text-base font-medium tabular-nums text-[#202124]">{value}</div>
              <div className="text-[11px] leading-tight text-[#5f6368]">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <Section title="Ask VARUNA">
        <AIAssistant />
      </Section>

      <div role="tablist" className="flex border-b border-[#e8eaed] px-2">
        {(["rivers", "dams"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`relative flex-1 cursor-pointer py-3 text-sm font-medium ${tab === t ? "text-[#1a73e8]" : "text-[#5f6368] hover:text-[#202124]"}`}
          >
            {t === "rivers" ? `Rivers (${rivers.length})` : `Dams (${dams.length})`}
            {tab === t && <span className="absolute inset-x-6 bottom-0 h-[3px] rounded-t bg-[#1a73e8]" />}
          </button>
        ))}
      </div>

      <ul className="py-1">
        {tab === "rivers"
          ? rivers.map((r) => (
              <li key={r.river_id}>
                <button
                  onClick={() => onSelect({ type: "river", id: r.river_id })}
                  className="flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left hover:bg-[#f8f9fa]"
                >
                  <ListIcon kind="river" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-[#202124]">{riverMeta[r.river_id]?.name ?? r.river_id}</div>
                    <div className="truncate text-xs text-[#70757a]">
                      {r.source === "live:pending" ? "Awaiting live feed" : `${r.level_m.toFixed(2)} m of ${r.danger_level_m} m danger`}
                      {riverMeta[r.river_id]?.subtitle ? ` · ${riverMeta[r.river_id].subtitle}` : ""}
                    </div>
                  </div>
                  <RiskPill risk={r.risk} compact />
                </button>
              </li>
            ))
          : dams.map((d) => (
              <li key={d.dam_id}>
                <button
                  onClick={() => onSelect({ type: "dam", id: d.dam_id })}
                  className="flex w-full cursor-pointer items-center gap-3 px-5 py-2.5 text-left hover:bg-[#f8f9fa]"
                >
                  <ListIcon kind="dam" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-[#202124]">{damMeta[d.dam_id]?.name ?? d.dam_id}</div>
                    <div className="truncate text-xs text-[#70757a]">
                      {d.storage_pct}% storage{d.source === "static" ? " · no live feed" : ""}
                    </div>
                  </div>
                  <RiskPill risk={d.risk} compact />
                </button>
              </li>
            ))}
      </ul>

      <Section title="Data sources">
        <DataHealthList refreshKey={healthKey} />
      </Section>
    </div>
  );
}
