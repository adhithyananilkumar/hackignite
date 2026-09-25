"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AIAssistant } from "../components/AIAssistant";
import { AlertCenter } from "../components/AlertCenter";
import { DamPanel } from "../components/DamPanel";
import { DataHealthPanel } from "../components/DataHealthPanel";
import { FloodTimeline } from "../components/FloodTimeline";
import { GlassPanel } from "../components/glass/GlassPanel";
import { KeralaMap, type MapFocus, type MapSelection } from "../components/KeralaMap";
import { RiverPanel } from "../components/RiverPanel";
import { api, type ExposedAsset } from "../lib/api";
import { useFloodForecast } from "../lib/useFloodForecast";
import { useLiveData } from "../lib/useLiveData";

const RISK_ORDER = ["NORMAL", "WATCH", "ADVISORY", "HIGH", "CRITICAL"];

export default function CommandCenter() {
  const { snapshot, connected } = useLiveData();
  const flood = useFloodForecast();
  const [riverNames, setRiverNames] = useState<Record<string, string>>({});
  const [damNames, setDamNames] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<MapSelection>(null);
  const [horizonIndex, setHorizonIndex] = useState(0);
  const [focus, setFocus] = useState<MapFocus>(null);
  const focusAsset = useCallback(
    (a: ExposedAsset) => setFocus({ lon: a.lon, lat: a.lat, key: `${a.id}-${Date.now()}` }),
    []
  );

  useEffect(() => {
    api.riversGeoJson().then((fc) => {
      const map: Record<string, string> = {};
      for (const f of fc.features) map[(f.properties as any).id] = (f.properties as any).name;
      setRiverNames(map);
    });
    api.damsGeoJson().then((fc) => {
      const map: Record<string, string> = {};
      for (const f of fc.features) map[(f.properties as any).id] = (f.properties as any).name;
      setDamNames(map);
    });
  }, []);

  const rivers = snapshot ? Object.values(snapshot.rivers) : [];
  const dams = snapshot ? Object.values(snapshot.dams) : [];

  const worstRisk = [...rivers, ...dams].reduce(
    (worst, r) => (RISK_ORDER.indexOf(r.risk) > RISK_ORDER.indexOf(worst) ? r.risk : worst),
    "NORMAL"
  );

  const sortedRivers = [...rivers].sort((a, b) => RISK_ORDER.indexOf(b.risk) - RISK_ORDER.indexOf(a.risk));
  const sortedDams = [...dams].sort((a, b) => RISK_ORDER.indexOf(b.risk) - RISK_ORDER.indexOf(a.risk));

  return (
    <div className="relative h-screen w-screen overflow-hidden" data-theme="dark">
      <KeralaMap
        snapshot={snapshot}
        selection={selection}
        flood={flood}
        horizonIndex={horizonIndex}
        focus={focus}
        onSelectRiver={(id) => setSelection({ type: "river", id })}
        onSelectDam={(id) => setSelection({ type: "dam", id })}
        onDeselect={() => setSelection(null)}
      />
      <div className="atmosphere-vignette" />
      <div className="atmosphere-overlay" />

      {/* Top bar */}
      <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between gap-4 pointer-events-none">
        <GlassPanel strong className="pointer-events-auto flex items-center gap-4 py-2.5">
          <Link href="/" className="text-sm font-semibold tracking-wide">
            ← VARUNA
          </Link>
          <span className="text-[var(--glass-text-dim)] text-xs">Kerala Flood Intelligence</span>
        </GlassPanel>
        <GlassPanel strong className="pointer-events-auto flex items-center gap-3 py-2.5">
          <span className={`text-xs font-semibold risk-text-${worstRisk}`}>
            <span className={`risk-dot risk-${worstRisk} mr-1.5`} />
            {worstRisk}
          </span>
          <span className="text-xs text-[var(--glass-text-dim)]">
            {connected ? "LIVE ●" : "reconnecting…"}
          </span>
        </GlassPanel>
      </div>

      {/* Left column: basins + dams */}
      <div className="absolute top-24 left-4 z-10 flex flex-col gap-4">
        <GlassPanel title="Rivers" className="w-[260px] max-h-[32vh] overflow-y-auto varuna-scrollbar">
          <div className="flex flex-col gap-1">
            {sortedRivers.map((r) => (
              <button
                key={r.river_id}
                onClick={() => setSelection({ type: "river", id: r.river_id })}
                className="flex items-center justify-between text-sm rounded-lg px-2 py-1.5 hover:bg-[var(--glass-highlight)] cursor-pointer text-left"
              >
                <span className="flex items-center gap-2">
                  <span className={`risk-dot risk-${r.risk}`} />
                  {riverNames[r.river_id] ?? r.river_id}
                </span>
                <span className="text-[11px] text-[var(--glass-text-dim)]">{r.level_m}m</span>
              </button>
            ))}
          </div>
        </GlassPanel>

        <GlassPanel title="Dams" className="w-[260px] max-h-[28vh] overflow-y-auto varuna-scrollbar">
          <div className="flex flex-col gap-1">
            {sortedDams.map((d) => (
              <button
                key={d.dam_id}
                onClick={() => setSelection({ type: "dam", id: d.dam_id })}
                className="flex items-center justify-between text-sm rounded-lg px-2 py-1.5 hover:bg-[var(--glass-highlight)] cursor-pointer text-left"
              >
                <span className="flex items-center gap-2">
                  <span className={`risk-dot risk-${d.risk}`} />
                  {damNames[d.dam_id] ?? d.dam_id}
                </span>
                <span className="text-[11px] text-[var(--glass-text-dim)]">{d.storage_pct}%</span>
              </button>
            ))}
          </div>
        </GlassPanel>

        <DataHealthPanel />
      </div>

      {/* Right column: alerts + AI */}
      <div className="absolute top-24 right-4 z-10 flex flex-col gap-4">
        <AlertCenter />
        <AIAssistant />
      </div>

      {/* Flood forecast timeline */}
      <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
        <FloodTimeline forecast={flood} horizonIndex={horizonIndex} onHorizonChange={setHorizonIndex} />
      </div>

      {/* Detail panel */}
      {selection && (
        <div className="absolute bottom-4 left-4 z-10">
          {selection.type === "river" ? (
            <RiverPanel
              riverId={selection.id}
              reading={snapshot?.rivers?.[selection.id]}
              name={riverNames[selection.id] ?? selection.id}
              flood={flood?.rivers.find((r) => r.river_id === selection.id)}
              horizonIndex={horizonIndex}
              onHorizonChange={setHorizonIndex}
              onFocusAsset={focusAsset}
              onClose={() => setSelection(null)}
            />
          ) : (
            <DamPanel
              name={damNames[selection.id] ?? selection.id}
              reading={snapshot?.dams?.[selection.id]}
              onClose={() => setSelection(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
