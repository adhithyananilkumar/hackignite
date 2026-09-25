"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCenter } from "../components/AlertCenter";
import { DamPanel } from "../components/DamPanel";
import { DataSourceSwitcher } from "../components/DataSourceSwitcher";
import { FloodTimeline } from "../components/FloodTimeline";
import {
  type Basemap,
  DEFAULT_LAYERS,
  KeralaMap,
  type LayerToggles,
  type MapFocus,
  type MapSelection,
} from "../components/KeralaMap";
import { KeralaOverview, type PlaceMeta } from "../components/KeralaOverview";
import { BasemapToggle, LayerChips } from "../components/MapChrome";
import { RiverPanel } from "../components/RiverPanel";
import { SearchBox, type SearchResult } from "../components/SearchBox";
import { api, type ExposedAsset, type LiveSourceStatus, type SimulationSourceStatus } from "../lib/api";
import { useFloodForecast } from "../lib/useFloodForecast";
import { useLiveData } from "../lib/useLiveData";

// Screen space taken by floating UI (px), so map framing keeps Kerala visible.
const SIDE_PANEL_W = 408;
const RIGHT_COLUMN_W = 364;

export default function CommandCenter() {
  const { snapshot, connected } = useLiveData();
  const flood = useFloodForecast(snapshot?.mode);
  const [rivers, setRivers] = useState<PlaceMeta>({});
  const [dams, setDams] = useState<PlaceMeta>({});
  const [selection, setSelection] = useState<MapSelection>(null);
  const [horizonIndex, setHorizonIndex] = useState(0);
  const [focus, setFocus] = useState<MapFocus>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [basemap, setBasemap] = useState<Basemap>("map");
  const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYERS);

  const flyTo = useCallback((lon: number, lat: number, id: string) => setFocus({ lon, lat, key: `${id}-${Date.now()}` }), []);
  const focusAsset = useCallback((a: ExposedAsset) => flyTo(a.lon, a.lat, a.id), [flyTo]);
  const select = useCallback((s: MapSelection) => {
    setSelection(s);
    if (s) setPanelOpen(true);
  }, []);

  useEffect(() => {
    api.riversGeoJson().then((fc) => {
      const meta: PlaceMeta = {};
      for (const f of fc.features) {
        const p = f.properties as Record<string, string>;
        meta[p.id] = { name: p.name, subtitle: `Gauge at ${p.gauge_town}` };
      }
      setRivers(meta);
    });
    api.damsGeoJson().then((fc) => {
      const meta: PlaceMeta = {};
      for (const f of fc.features) {
        const p = f.properties as Record<string, string>;
        meta[p.id] = { name: p.name, subtitle: `${p.river} · ${p.district} district` };
      }
      setDams(meta);
    });
  }, []);

  const onSearchPick = useCallback(
    (r: SearchResult) => {
      if ("lon" in r) flyTo(r.lon, r.lat, r.id);
      else select({ type: r.kind, id: r.id });
    },
    [select, flyTo]
  );

  const liveStatus = snapshot?.mode === "live" ? (snapshot.source_status as LiveSourceStatus) : null;
  const healthKey = `${snapshot?.mode}:${liveStatus?.state ?? ""}:${liveStatus?.last_updated ?? ""}`;
  const simStatus = snapshot?.mode === "simulation" ? (snapshot.source_status as SimulationSourceStatus) : null;
  const modeLabel = simStatus
    ? `Simulation: ${simStatus.scenarios?.find((s) => s.id === simStatus.scenario_id)?.name ?? simStatus.scenario_id}`
    : "Live data";
  const names = useMemo(
    () => Object.fromEntries([...Object.entries(rivers), ...Object.entries(dams)].map(([id, m]) => [id, m.name])),
    [rivers, dams]
  );
  const mapPadding = useMemo(
    () => ({ top: 72, bottom: 190, left: panelOpen ? SIDE_PANEL_W + 24 : 40, right: RIGHT_COLUMN_W + 16 }),
    [panelOpen]
  );
  const leftEdge = panelOpen ? SIDE_PANEL_W + 16 : 16;

  return (
    <div className="maps-ui relative h-screen w-screen overflow-hidden bg-[#aadaff]">
      <KeralaMap
        snapshot={snapshot}
        selection={selection}
        flood={flood}
        horizonIndex={horizonIndex}
        focus={focus}
        basemap={basemap}
        layers={layers}
        padding={mapPadding}
        onSelectRiver={(id) => select({ type: "river", id })}
        onSelectDam={(id) => select({ type: "dam", id })}
        onDeselect={() => setSelection(null)}
      />

      {/* Left: search bar + side panel (overview or place details) */}
      <div
        className="pointer-events-none absolute bottom-3 left-3 top-3 z-20 flex flex-col gap-3"
        style={{ width: SIDE_PANEL_W - 8 }}
      >
        <div className="pointer-events-auto">
          <SearchBox onPick={onSearchPick} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((o) => !o)} />
        </div>
        {panelOpen && (
          <div className="pointer-events-auto min-h-0 flex-1 overflow-y-auto rounded-xl bg-white shadow-[var(--maps-shadow)] varuna-scrollbar">
            {selection?.type === "river" ? (
              <RiverPanel
                riverId={selection.id}
                reading={snapshot?.rivers?.[selection.id]}
                name={rivers[selection.id]?.name ?? selection.id}
                subtitle={`River · ${rivers[selection.id]?.subtitle ?? ""}`}
                flood={flood?.rivers.find((r) => r.river_id === selection.id)}
                horizonIndex={horizonIndex}
                onHorizonChange={setHorizonIndex}
                onFocusAsset={focusAsset}
                onClose={() => setSelection(null)}
              />
            ) : selection?.type === "dam" ? (
              <DamPanel
                name={dams[selection.id]?.name ?? selection.id}
                subtitle={`Reservoir · ${dams[selection.id]?.subtitle ?? ""}`}
                reading={snapshot?.dams?.[selection.id]}
                onClose={() => setSelection(null)}
              />
            ) : (
              <KeralaOverview
                snapshot={snapshot}
                flood={flood}
                rivers={rivers}
                dams={dams}
                modeLabel={modeLabel}
                healthKey={healthKey}
                onSelect={select}
              />
            )}
          </div>
        )}
      </div>

      {/* Top: layer chips beside the search bar */}
      <div className="absolute top-4 z-10" style={{ left: SIDE_PANEL_W + 16, right: RIGHT_COLUMN_W + 16 }}>
        <LayerChips layers={layers} onChange={setLayers} />
      </div>

      {/* Right: data source + alerts */}
      <div className="absolute right-3 top-3 z-10 flex flex-col gap-3">
        <DataSourceSwitcher snapshot={snapshot} connected={connected} />
        <AlertCenter names={names} onSelect={select} />
      </div>

      {/* Bottom: layers toggle (left) and forecast timeline (centre of the free map area) */}
      <div className="absolute bottom-6 z-10 transition-[left] duration-200" style={{ left: leftEdge + 8 }}>
        <BasemapToggle basemap={basemap} onChange={setBasemap} />
      </div>
      <div
        className="absolute bottom-6 z-10 -translate-x-1/2"
        style={{ left: `calc(${leftEdge}px + (100% - ${leftEdge + RIGHT_COLUMN_W}px) / 2 + 40px)` }}
      >
        <FloodTimeline forecast={flood} horizonIndex={horizonIndex} onHorizonChange={setHorizonIndex} />
      </div>
    </div>
  );
}
