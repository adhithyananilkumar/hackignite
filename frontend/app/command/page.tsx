"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCenter } from "../components/AlertCenter";
import { ChatPanel } from "../components/ChatPanel";
import { CoastalWidget } from "../components/CoastalWidget";
import { LandslideWidget, useLandslide } from "../components/LandslideWidget";
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
import { LocationPanel, type MapPin } from "../components/LocationPanel";
import { BasemapToggle, LayerChips } from "../components/MapChrome";
import { RiverPanel } from "../components/RiverPanel";
import { SearchBox, type SearchResult } from "../components/SearchBox";
import { api, type ChatAction, type ExposedAsset, type LiveSourceStatus, type SimulationSourceStatus } from "../lib/api";
import { useCoastal } from "../lib/useCoastal";
import { useFloodForecast } from "../lib/useFloodForecast";
import { useLiveData } from "../lib/useLiveData";
import { useVarunaChat } from "../lib/useVarunaChat";

// Screen space taken by floating UI (px), so map framing keeps Kerala visible.
const SIDE_PANEL_W = 408;
const RIGHT_COLUMN_W = 364;

export default function CommandCenter() {
  const { snapshot, connected } = useLiveData();
  const flood = useFloodForecast(snapshot?.mode);
  const coastal = useCoastal(snapshot?.mode);
  const landslide = useLandslide(snapshot?.mode);
  const [rivers, setRivers] = useState<PlaceMeta>({});
  const [dams, setDams] = useState<PlaceMeta>({});
  const [selection, setSelection] = useState<MapSelection>(null);
  const [horizonIndex, setHorizonIndex] = useState(0);
  const [focus, setFocus] = useState<MapFocus>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [basemap, setBasemap] = useState<Basemap>("map");
  const [layers, setLayers] = useState<LayerToggles>(DEFAULT_LAYERS);
  const [pin, setPin] = useState<MapPin | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  const flyTo = useCallback((lon: number, lat: number, id: string) => setFocus({ lon, lat, key: `${id}-${Date.now()}` }), []);
  const focusAsset = useCallback((a: ExposedAsset) => flyTo(a.lon, a.lat, a.id), [flyTo]);
  // A river/dam selection and a dropped pin are alternatives: setting one clears the other.
  const select = useCallback((s: MapSelection) => {
    setSelection(s);
    if (s) {
      setPin(null);
      setPanelOpen(true);
    }
  }, []);
  const dropPin = useCallback((p: Omit<MapPin, "key">) => {
    setSelection(null);
    setPin({ ...p, key: `${p.lat.toFixed(5)},${p.lon.toFixed(5)}-${Date.now()}` });
    setPanelOpen(true);
  }, []);

  const namePin = useCallback(
    (key: string, label: string) => setPin((p) => (p && p.key === key && !p.label ? { ...p, label } : p)),
    []
  );

  // Ask VARUNA answers with map actions: the last one decides where the map ends up.
  const applyChatAction = useCallback(
    (a: ChatAction) => {
      if (a.type === "select_river") select({ type: "river", id: a.id });
      else if (a.type === "select_dam") select({ type: "dam", id: a.id });
      else if (a.type === "pin") dropPin({ lat: a.lat, lon: a.lon, label: a.label, assessment: a.assessment, fly: true });
      else {
        setPin(null);
        setSelection(null);
      }
    },
    [select, dropPin]
  );
  const onChatActions = useCallback((actions: ChatAction[]) => applyChatAction(actions[actions.length - 1]), [applyChatAction]);
  const chat = useVarunaChat(onChatActions);

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
      if (r.kind === "place") dropPin({ lat: r.lat, lon: r.lon, label: r.name, fly: true });
      else if ("lon" in r) flyTo(r.lon, r.lat, r.id);
      else select({ type: r.kind, id: r.id });
    },
    [select, flyTo, dropPin]
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

  const pinLabel = pin ? (pin.label ?? pin.assessment?.place?.name ?? "the pinned location") : null;
  const selectedName = selection ? (names[selection.id] ?? selection.id) : null;
  const askVaruna = useCallback(
    (question?: string) => {
      setChatOpen(true);
      setPanelOpen(true);
      if (question) {
        chat.send(question, {
          pin: pin && { lat: pin.lat, lon: pin.lon, label: pinLabel ?? undefined },
          selection,
        });
      }
    },
    [chat, pin, pinLabel, selection]
  );

  return (
    <div className="maps-ui relative h-screen w-screen overflow-hidden bg-[#aadaff]">
      <KeralaMap
        snapshot={snapshot}
        selection={selection}
        flood={flood}
        horizonIndex={horizonIndex}
        focus={focus}
        coastal={coastal}
        basemap={basemap}
        layers={layers}
        padding={mapPadding}
        pin={pin}
        onSelectRiver={(id) => select({ type: "river", id })}
        onSelectDam={(id) => select({ type: "dam", id })}
        onDeselect={() => setSelection(null)}
        onPickPoint={(lon, lat) => dropPin({ lat, lon, fly: false })}
      />

      {/* Left: search bar + side panel (overview or place details) */}
      <div
        className="pointer-events-none absolute bottom-3 left-3 top-3 z-20 flex flex-col gap-3"
        style={{ width: SIDE_PANEL_W - 8 }}
      >
        <div className="pointer-events-auto">
          <SearchBox
            onPick={onSearchPick}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen((o) => !o)}
            chatOpen={chatOpen && panelOpen}
            onAsk={() => (chatOpen && panelOpen ? setChatOpen(false) : askVaruna())}
          />
        </div>
        {panelOpen && (
          <div
            className={`pointer-events-auto min-h-0 flex-1 maps-glass-strong ${chatOpen ? "overflow-hidden" : "overflow-y-auto varuna-scrollbar"}`}
          >
            {chatOpen ? (
              <ChatPanel
                messages={chat.messages}
                loading={chat.loading}
                names={names}
                pinLabel={pinLabel}
                selectedName={selectedName}
                onSend={(text) => askVaruna(text)}
                onReplay={(a) => {
                  applyChatAction(a);
                  if (a.type === "pin") setChatOpen(false);
                }}
                onReset={chat.reset}
                onClose={() => setChatOpen(false)}
              />
            ) : pin ? (
              <LocationPanel
                pin={pin}
                refreshKey={flood?.generated_at ?? ""}
                onClose={() => setPin(null)}
                onAsk={(q) => askVaruna(q)}
                onFocus={flyTo}
                onSelectRiver={(id) => select({ type: "river", id })}
                onPlaceName={namePin}
              />
            ) : selection?.type === "river" ? (
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
                damId={selection.id}
                riverNames={Object.fromEntries(Object.entries(rivers).map(([id, m]) => [id, m.name]))}
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
      <div className="varuna-scrollbar absolute bottom-3 right-3 top-3 z-10 flex flex-col gap-3 overflow-y-auto pb-1">
        <DataSourceSwitcher snapshot={snapshot} connected={connected} />
        <AlertCenter names={names} onSelect={select} />
        <LandslideWidget data={landslide} onFocus={flyTo} />
        <CoastalWidget data={coastal} />
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
