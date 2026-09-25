"use client";

import type * as maplibregl from "maplibre-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { API_BASE, api, type CoastalSnapshot, type FloodForecast } from "../lib/api";
import type { LiveSnapshot } from "../lib/useLiveData";
import type { MapPin } from "./LocationPanel";

// maplibre-gl is loaded from a CDN <script>, injected manually below, instead
// of the npm bundle: Next.js/Turbopack fails to resolve maplibre-gl's worker
// chunk at dev time, which breaks map rendering entirely. The CDN UMD build
// sidesteps that and matches the version pinned in package.json.
declare global {
  interface Window {
    maplibregl: typeof maplibregl;
  }
}

const MAPLIBRE_CDN_URL = "https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js";
let maplibreLoadPromise: Promise<typeof maplibregl> | null = null;

function loadMapLibre(): Promise<typeof maplibregl> {
  if (typeof window !== "undefined" && window.maplibregl) {
    return Promise.resolve(window.maplibregl);
  }
  if (!maplibreLoadPromise) {
    maplibreLoadPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${MAPLIBRE_CDN_URL}"]`);
      const script = existing ?? document.createElement("script");
      if (!existing) {
        script.src = MAPLIBRE_CDN_URL;
        document.head.appendChild(script);
      }
      script.addEventListener("load", () => resolve(window.maplibregl));
      script.addEventListener("error", () => reject(new Error("Failed to load maplibre-gl from CDN")));
      if (window.maplibregl) resolve(window.maplibregl);
    });
  }
  return maplibreLoadPromise;
}

// A river at NORMAL is drawn as water blue; anything above it takes the
// status colour, so on a light map only rivers at risk stand out.
const RISK_COLORS: Record<string, string> = {
  NORMAL: "#4285f4",
  WATCH: "#f9ab00",
  ADVISORY: "#fa7b17",
  HIGH: "#e8453c",
  CRITICAL: "#c5221f",
};

const IMPACT_COLORS: Record<string, string> = {
  hospital: "#d93025",
  school: "#e37400",
  shelter: "#1a73e8",
  bridge: "#5f6368",
};

// Google-Maps-like basemap: CARTO Voyager (key-free) with water recoloured.
const BASEMAP_STYLE = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
const WATER_COLOR = "#aadaff";
// Outside Kerala in satellite view: close to the imagery's deep Arabian Sea.
const SATELLITE_SEA_COLOR = "#0b2b4c";
const SATELLITE_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TERRAIN_DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const ROUTE_HIGHLIGHT_COLOR = "#1a73e8";
const LABEL_TEXT = "#3c4043";
const PIN_ZOOM = 12.5;

// Google-style red drop pin, anchored at its tip.
function createPinElement() {
  const el = document.createElement("div");
  el.style.cssText = "width:30px;height:42px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));cursor:pointer";
  el.innerHTML =
    '<svg viewBox="0 0 30 42" width="30" height="42"><path d="M15 1C7.3 1 1 7.2 1 14.9 1 25.4 15 41 15 41s14-15.6 14-26.1C29 7.2 22.7 1 15 1z" fill="#ea4335" stroke="#b31412" stroke-width="1.2"/><circle cx="15" cy="15" r="5" fill="#a50e0e"/></svg>';
  return el;
}

export type MapSelection = { type: "river" | "dam"; id: string } | null;
export type MapFocus = { lon: number; lat: number; key: string } | null;
export type Basemap = "map" | "satellite";
export type AssetType = "hospital" | "school" | "shelter" | "bridge";
export type LayerToggles = { flood: boolean } & Record<AssetType, boolean>;
export const DEFAULT_LAYERS: LayerToggles = { flood: true, hospital: true, school: true, shelter: true, bridge: true };
const ASSET_TYPES: AssetType[] = ["hospital", "school", "shelter", "bridge"];
const ASSET_LAYERS = ["impact-points", "exposed-halo", "exposed-points", "exposed-label"];

type Expr = maplibregl.ExpressionSpecification;
const RIVER_COLOR_EXPR = ["coalesce", ["get", "color"], RISK_COLORS.NORMAL] as unknown as Expr;
// Only rivers above NORMAL glow; a calm river is just a blue line.
const RIVER_GLOW_OPACITY_EXPR = ["case", ["==", ["coalesce", ["get", "risk"], "NORMAL"], "NORMAL"], 0, 0.3] as unknown as Expr;
const RIVER_WIDTH_EXPR = ["interpolate", ["linear"], ["zoom"], 6, 2, 10, 3.2, 14, 5] as unknown as Expr;
const RIVER_CASING_WIDTH_EXPR = ["interpolate", ["linear"], ["zoom"], 6, 4.5, 10, 6.5, 14, 9] as unknown as Expr;

const ASSET_LABELS: Record<string, string> = {
  hospital: "Hospital",
  school: "School",
  shelter: "Relief shelter",
  bridge: "Bridge",
};
const FLOOD_OPACITY = 0.9;
const FLOOD_CROSSFADE_MS = 700;
// The model grid is ~75 m (z11); beyond z12 MapLibre overzooms with smoothing.
const FLOOD_TILE_MAXZOOM = 12;

type HoverInfo = { x: number; y: number; label: string; name: string; detail: string };

function exposedCollection(flood: FloodForecast | null, horizonIndex: number) {
  const seen = new Set<string>();
  const features: GeoJSON.Feature[] = [];
  for (const river of flood?.rivers ?? []) {
    for (const a of river.horizons[horizonIndex]?.exposed_assets ?? []) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      features.push({
        type: "Feature",
        properties: { id: a.id, name: a.name, type: a.type, depth_m: a.depth_m },
        geometry: { type: "Point", coordinates: [a.lon, a.lat] },
      });
    }
  }
  return { type: "FeatureCollection" as const, features };
}

const DRAINAGE_COLORS: Record<string, string> = {
  FREE_DRAINING: "#1e8e3e",
  TIDAL_CONSTRAINT: "#f9ab00",
  BACKWATER_RISK: "#d93025",
};

function outletCollection(coastal: CoastalSnapshot | null) {
  return {
    type: "FeatureCollection" as const,
    features: (coastal?.outlets ?? []).map((o) => ({
      type: "Feature" as const,
      properties: {
        id: o.id,
        name: o.name,
        drainage: o.drainage,
        color: DRAINAGE_COLORS[o.drainage],
        label: `${o.name.split(" (")[0]} ${o.level_m >= 0 ? "+" : ""}${o.level_m.toFixed(2)} m`,
        level_m: o.level_m,
      },
      geometry: { type: "Point" as const, coordinates: o.coordinates },
    })),
  };
}

function ringBounds(ring: [number, number][]) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return { minLng, minLat, maxLng, maxLat };
}

// Rivers are stored as LineString or MultiLineString; flatten either into one
// coordinate list so bounds/bearing math doesn't need to care which.
function flattenLineCoords(geometry: any): [number, number][] {
  if (geometry?.type === "LineString") return geometry.coordinates;
  if (geometry?.type === "MultiLineString") return geometry.coordinates.flat();
  return [];
}

function bearingBetween([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const toRad = Math.PI / 180, toDeg = 180 / Math.PI;
  const y = Math.sin((lon2 - lon1) * toRad) * Math.cos(lat2 * toRad);
  const x =
    Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) -
    Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lon2 - lon1) * toRad);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

// A world rectangle with the Kerala outline punched out as a hole: painted as
// sea, it leaves Kerala as the only land on the map.
function buildMask(keralaOuterRing: [number, number][]) {
  const world: [number, number][] = [
    [-179.9, -85],
    [179.9, -85],
    [179.9, 85],
    [-179.9, 85],
    [-179.9, -85],
  ];
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "Polygon" as const,
      coordinates: [world, keralaOuterRing],
    },
  };
}

export function KeralaMap({
  snapshot,
  selection = null,
  flood = null,
  horizonIndex = 0,
  focus = null,
  coastal = null,
  basemap = "map",
  layers = DEFAULT_LAYERS,
  padding = { top: 80, bottom: 160, left: 60, right: 60 },
  pin = null,
  onSelectRiver,
  onSelectDam,
  onDeselect,
  onPickPoint,
}: {
  snapshot: LiveSnapshot | null;
  selection?: MapSelection;
  flood?: FloodForecast | null;
  horizonIndex?: number;
  focus?: MapFocus;
  coastal?: CoastalSnapshot | null;
  basemap?: Basemap;
  layers?: LayerToggles;
  /** Screen space covered by floating UI, kept clear when framing Kerala or a river. */
  padding?: { top: number; bottom: number; left: number; right: number };
  onSelectRiver?: (id: string) => void;
  onSelectDam?: (id: string) => void;
  onDeselect?: () => void;
  /** Dropped pin, shown as a marker; the map flies to it when `pin.fly` is set. */
  pin?: MapPin | null;
  /** Click on empty map: drop a pin there (otherwise the click deselects). */
  onPickPoint?: (lon: number, lat: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const riversRef = useRef<any>(null);
  const damsRef = useRef<any>(null);
  const snapshotRef = useRef<LiveSnapshot | null>(snapshot);
  const overviewRef = useRef<{ center: [number, number]; zoom: number; pitch: number; bearing: number } | null>(null);
  const onDeselectRef = useRef<(() => void) | undefined>(onDeselect);
  const onSelectRiverRef = useRef(onSelectRiver);
  const onSelectDamRef = useRef(onSelectDam);
  const hoverIdRef = useRef<string | null>(null);
  const [bearing, setBearing] = useState(0);
  const [pitch, setPitch] = useState(52);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const floodRef = useRef<FloodForecast | null>(flood);
  const horizonRef = useRef(horizonIndex);
  const floodUrlsRef = useRef<Record<string, string>>({});
  const mapReadyRef = useRef(false);
  const paddingRef = useRef(padding);
  const coastalRef = useRef<CoastalSnapshot | null>(coastal);

  useEffect(() => {
    coastalRef.current = coastal;
    (mapRef.current?.getSource("outlets") as maplibregl.GeoJSONSource | undefined)?.setData(outletCollection(coastal));
  }, [coastal]);
  const basemapRef = useRef<Basemap>(basemap);
  const layersRef = useRef<LayerToggles>(layers);
  const pinRef = useRef<MapPin | null>(pin);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onPickPointRef = useRef(onPickPoint);

  useEffect(() => {
    paddingRef.current = padding;
  }, [padding]);

  useEffect(() => {
    basemapRef.current = basemap;
    layersRef.current = layers;
    applyDisplayOptions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap, layers]);

  // Basemap (map vs satellite) and layer chips: visibility/filters only, no rebuild.
  function applyDisplayOptions() {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const satellite = basemapRef.current === "satellite";
    map.setLayoutProperty("satellite", "visibility", satellite ? "visible" : "none");
    map.setLayoutProperty("hillshade", "visibility", satellite ? "none" : "visible");
    map.setPaintProperty("kerala-outline-line", "line-color", satellite ? "#ffffff" : "#5f6368");
    map.setPaintProperty("kerala-outline-casing", "line-opacity", satellite ? 0 : 0.9);
    map.setPaintProperty("kerala-mask-fill", "fill-color", satellite ? SATELLITE_SEA_COLOR : WATER_COLOR);

    const enabled = ASSET_TYPES.filter((t) => layersRef.current[t]);
    const assetFilter = ["in", ["get", "type"], ["literal", enabled]] as unknown as maplibregl.FilterSpecification;
    for (const id of ASSET_LAYERS) map.setFilter(id, assetFilter);

    for (const id of Object.keys(floodUrlsRef.current)) {
      map.setLayoutProperty(id, "visibility", layersRef.current.flood ? "visible" : "none");
    }
  }

  useEffect(() => {
    floodRef.current = flood;
    horizonRef.current = horizonIndex;
    syncFlood();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flood, horizonIndex]);

  useEffect(() => {
    if (!focus) return;
    mapRef.current?.flyTo({ center: [focus.lon, focus.lat], zoom: 14.2, pitch: 62, duration: 1600, essential: true });
  }, [focus]);

  // One raster tile layer per forecast horizon, each compositing every river.
  // Tile sources (unlike image sources) drape onto 3D terrain. Moving along the
  // timeline crossfades opacity; a new forecast swaps the layer's tile URL.
  function syncFlood() {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    const forecast = floodRef.current;
    const active = horizonRef.current;
    const wanted = new Set<string>();

    (forecast?.horizon_tiles ?? []).forEach((template, i) => {
      if (!template) return;
      const id = `flood-h${i}`;
      const url = `${API_BASE}${template}`;
      wanted.add(id);
      if (!map.getSource(id)) {
        map.addSource(id, { type: "raster", tiles: [url], tileSize: 256, minzoom: 5, maxzoom: FLOOD_TILE_MAXZOOM });
        map.addLayer(
          {
            id,
            type: "raster",
            source: id,
            layout: { visibility: layersRef.current.flood ? "visible" : "none" },
            paint: { "raster-opacity": 0, "raster-fade-duration": 200 },
          },
          "rivers-glow"
        );
        map.setPaintProperty(id, "raster-opacity-transition", { duration: FLOOD_CROSSFADE_MS, delay: 0 });
      } else if (floodUrlsRef.current[id] !== url) {
        (map.getSource(id) as maplibregl.RasterTileSource).setTiles([url]);
      }
      floodUrlsRef.current[id] = url;
      map.setPaintProperty(id, "raster-opacity", i === active ? FLOOD_OPACITY : 0);
    });

    for (const id of Object.keys(floodUrlsRef.current)) {
      if (wanted.has(id)) continue;
      map.removeLayer(id);
      map.removeSource(id);
      delete floodUrlsRef.current[id];
    }

    (map.getSource("exposed") as maplibregl.GeoJSONSource | undefined)?.setData(exposedCollection(forecast, active));
  }

  useEffect(() => {
    onSelectRiverRef.current = onSelectRiver;
    onSelectDamRef.current = onSelectDam;
  }, [onSelectRiver, onSelectDam]);

  useEffect(() => {
    onDeselectRef.current = onDeselect;
    onPickPointRef.current = onPickPoint;
  }, [onDeselect, onPickPoint]);

  // Declared before the selection effect so a pin dropped while clearing a
  // selection is already known there (and the camera stays with the pin).
  useEffect(() => {
    pinRef.current = pin;
    syncPin(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin?.key]);

  function syncPin(moveCamera: boolean) {
    const map = mapRef.current;
    const current = pinRef.current;
    if (!map || !mapReadyRef.current) return;
    if (!current) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new window.maplibregl.Marker({ element: createPinElement(), anchor: "bottom" });
    }
    markerRef.current.setLngLat([current.lon, current.lat]).addTo(map);
    if (moveCamera && current.fly) {
      map.flyTo({
        center: [current.lon, current.lat],
        zoom: Math.max(map.getZoom(), PIN_ZOOM),
        pitch: 55,
        padding: paddingRef.current,
        duration: 1600,
        essential: true,
      });
    }
  }

  useEffect(() => {
    snapshotRef.current = snapshot;
    applySnapshotColors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // --- Fly the camera to the selected river/dam and highlight its route,
  // like a Google Maps route pop while everything else fades back. ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !riversRef.current || !damsRef.current) return;

    if (!selection) {
      resetHighlight(map);
      const overview = overviewRef.current;
      if (overview && !pinRef.current) {
        map.flyTo({ ...overview, duration: 1600, essential: true });
      }
      return;
    }

    if (selection.type === "river") {
      const feature = riversRef.current.features.find((f: any) => f.properties?.id === selection.id);
      const coords = flattenLineCoords(feature?.geometry);
      if (!coords.length) return;
      highlightRiver(map, selection.id);
      const { minLng, minLat, maxLng, maxLat } = ringBounds(coords);
      const bearing = bearingBetween(coords[0], coords[coords.length - 1]);
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: paddingRef.current,
          pitch: 66,
          bearing,
          duration: 1800,
          maxZoom: 12.2,
          essential: true,
        }
      );
    } else {
      const feature = damsRef.current.features.find((f: any) => f.properties?.id === selection.id);
      if (!feature) return;
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      highlightDam(map, selection.id);
      map.flyTo({
        center: [lng, lat],
        zoom: 13.4,
        pitch: 72,
        bearing: -18,
        duration: 1800,
        essential: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  function highlightRiver(map: maplibregl.Map, id: string) {
    const isSelected = ["==", ["get", "id"], id];
    map.setPaintProperty("rivers-line", "line-opacity", ["case", isSelected, 1, 0.3]);
    map.setPaintProperty("rivers-line", "line-width", ["case", isSelected, 5, 2]);
    map.setPaintProperty("rivers-casing", "line-width", ["case", isSelected, 9, 5]);
    map.setPaintProperty("rivers-glow", "line-color", ["case", isSelected, ROUTE_HIGHLIGHT_COLOR, RIVER_COLOR_EXPR]);
    map.setPaintProperty("rivers-glow", "line-opacity", ["case", isSelected, 0.35, 0]);
    map.setPaintProperty("rivers-glow", "line-width", ["case", isSelected, 18, 10]);
    map.setPaintProperty("dams-circle", "circle-opacity", 0.4);
    map.setPaintProperty("dams-circle", "circle-stroke-opacity", 0.4);
    map.setPaintProperty("dams-label", "text-opacity", 0.4);
  }

  function highlightDam(map: maplibregl.Map, id: string) {
    const isSelected = ["==", ["get", "id"], id];
    map.setPaintProperty("dams-circle", "circle-opacity", ["case", isSelected, 1, 0.35]);
    map.setPaintProperty("dams-circle", "circle-stroke-opacity", ["case", isSelected, 1, 0.35]);
    map.setPaintProperty("dams-circle", "circle-radius", ["case", isSelected, 10, 6.5]);
    map.setPaintProperty("dams-glow", "circle-color", ["case", isSelected, ROUTE_HIGHLIGHT_COLOR, "#000000"]);
    map.setPaintProperty("dams-glow", "circle-opacity", ["case", isSelected, 0.3, 0.06]);
    map.setPaintProperty("dams-glow", "circle-radius", ["case", isSelected, 24, 11]);
    map.setPaintProperty("dams-label", "text-opacity", ["case", isSelected, 1, 0.35]);
    map.setPaintProperty("rivers-line", "line-opacity", 0.45);
    map.setPaintProperty("rivers-glow", "line-opacity", 0);
  }

  function resetHighlight(map: maplibregl.Map) {
    map.setPaintProperty("rivers-line", "line-opacity", 1);
    map.setPaintProperty("rivers-line", "line-width", RIVER_WIDTH_EXPR);
    map.setPaintProperty("rivers-casing", "line-width", RIVER_CASING_WIDTH_EXPR);
    map.setPaintProperty("rivers-glow", "line-color", RIVER_COLOR_EXPR);
    map.setPaintProperty("rivers-glow", "line-opacity", RIVER_GLOW_OPACITY_EXPR);
    map.setPaintProperty("rivers-glow", "line-width", 12);
    map.setPaintProperty("dams-circle", "circle-opacity", 1);
    map.setPaintProperty("dams-circle", "circle-stroke-opacity", 1);
    map.setPaintProperty("dams-circle", "circle-radius", 6.5);
    map.setPaintProperty("dams-glow", "circle-color", "#000000");
    map.setPaintProperty("dams-glow", "circle-opacity", 0.18);
    map.setPaintProperty("dams-glow", "circle-radius", 11);
    map.setPaintProperty("dams-label", "text-opacity", 1);
  }

  function applySnapshotColors() {
    const map = mapRef.current;
    if (!map || !riversRef.current || !damsRef.current) return;
    const snap = snapshotRef.current;

    const riverData = {
      ...riversRef.current,
      features: riversRef.current.features.map((f: any) => {
        const id = f.properties?.id as string;
        const risk = snap?.rivers?.[id]?.risk ?? "NORMAL";
        return { ...f, properties: { ...f.properties, color: RISK_COLORS[risk], risk } };
      }),
    };
    const damData = {
      ...damsRef.current,
      features: damsRef.current.features.map((f: any) => {
        const id = f.properties?.id as string;
        const risk = snap?.dams?.[id]?.risk ?? "NORMAL";
        return { ...f, properties: { ...f.properties, color: RISK_COLORS[risk], risk } };
      }),
    };

    (map.getSource("rivers") as maplibregl.GeoJSONSource | undefined)?.setData(riverData);
    (map.getSource("dams") as maplibregl.GeoJSONSource | undefined)?.setData(damData);
  }

  // Recolour the basemap's water to Google-Maps blue (the same colour the
  // outside-Kerala mask uses, so the two read as one sea).
  function styleWater(map: maplibregl.Map) {
    for (const layer of map.getStyle().layers ?? []) {
      const id = layer.id.toLowerCase();
      if (!id.includes("water") && !id.includes("ocean")) continue;
      if (layer.type === "fill") {
        map.setPaintProperty(layer.id, "fill-color", WATER_COLOR);
      } else if (layer.type === "line" && !id.includes("label")) {
        map.setPaintProperty(layer.id, "line-color", "#8ec9f5");
      }
    }
  }

  // Satellite imagery slots in above land/water fills but below roads and
  // labels, giving a Google-style "hybrid" view.
  function firstRoadOrLabelLayer(map: maplibregl.Map): string | undefined {
    return (map.getStyle().layers ?? []).find(
      (l) => l.type === "symbol" || (l.type === "line" && !/water|boundary|admin/i.test(l.id))
    )?.id;
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    function mount(gl: typeof maplibregl) {
      if (!containerRef.current) return;
      const map = new gl.Map({
        container: containerRef.current,
        style: BASEMAP_STYLE,
        center: [76.4, 10.3],
        zoom: 6.6,
        pitch: 40,
        bearing: -12,
        minZoom: 6,
        maxZoom: 14,
        maxPitch: 75,
        antialias: true,
      });
      mapRef.current = map;
      // Google-Maps-style gestures: left-drag pans, right-drag (or ctrl+drag)
      // rotates and tilts, wheel zooms toward the cursor, double-click zooms in.
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.keyboard.enable();
      // Swapping flood tile URLs cancels in-flight tile requests; MapLibre reports
      // those as AbortErrors. They're expected, so only surface real failures.
      map.on("error", (e: { error?: Error }) => {
        if (e.error?.name === "AbortError" || e.error?.message === "AbortError") return;
        console.error(e.error);
      });
      map.on("rotate", () => setBearing(map.getBearing()));
      map.on("pitch", () => setPitch(map.getPitch()));

      resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(containerRef.current);

      map.on("load", async () => {
        map.resize();
        styleWater(map);
        const satelliteBefore = firstRoadOrLabelLayer(map);

        let boundary: any, rivers: any, dams: any, impact: any;
        try {
          [boundary, rivers, dams, impact] = await Promise.all([
            api.boundaryGeoJson(),
            api.riversGeoJson(),
            api.damsGeoJson(),
            api.impactGeoJson(),
          ]);
          riversRef.current = rivers;
          damsRef.current = dams;
        } catch {
          return;
        }

        // --- Terrain + relief (Western Ghats read as real elevation) ---
        map.addSource("terrain-dem", {
          type: "raster-dem",
          tiles: [TERRAIN_DEM_URL],
          tileSize: 256,
          encoding: "terrarium",
          maxzoom: 14,
        });
        map.setTerrain({ source: "terrain-dem", exaggeration: 1.3 });

        // --- Satellite ("hybrid") imagery, hidden until the Layers toggle asks ---
        map.addSource("satellite", {
          type: "raster",
          tiles: [SATELLITE_TILES],
          tileSize: 256,
          maxzoom: 18,
          attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
        });
        map.addLayer(
          { id: "satellite", type: "raster", source: "satellite", layout: { visibility: "none" } },
          satelliteBefore
        );

        // Soft relief, like Google's terrain shading: shadows, no dark wash.
        map.addLayer(
          {
            id: "hillshade",
            type: "hillshade",
            source: "terrain-dem",
            paint: {
              "hillshade-shadow-color": "#6d7b86",
              "hillshade-highlight-color": "#ffffff",
              "hillshade-accent-color": "#8a98a3",
              "hillshade-exaggeration": 0.35,
            },
          },
          satelliteBefore
        );
        if (typeof (map as any).setSky === "function") {
          try {
            (map as any).setSky({
              "sky-color": "#bcdcff",
              "horizon-color": "#f2f7fc",
              "fog-color": "#ffffff",
              "fog-ground-blend": 0.6,
              "horizon-fog-blend": 0.5,
              "sky-horizon-blend": 0.6,
              "atmosphere-blend": 0.4,
            });
          } catch {
            // Sky layer isn't supported by every style/runtime combination.
          }
        }

        const outerRing = boundary.features[0].geometry.coordinates[0] as [number, number][];
        map.addSource("kerala-mask", { type: "geojson", data: buildMask(outerRing) });
        map.addSource("kerala-outline", { type: "geojson", data: boundary });
        map.addLayer({
          id: "kerala-outline-casing",
          type: "line",
          source: "kerala-outline",
          paint: { "line-color": "#ffffff", "line-width": 4, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: "kerala-outline-line",
          type: "line",
          source: "kerala-outline",
          paint: { "line-color": "#5f6368", "line-width": 1.5, "line-dasharray": [3, 2] },
        });

        // --- Impact points (hospitals / schools / shelters / bridges) ---
        map.addSource("impact", { type: "geojson", data: impact });
        map.addLayer({
          id: "impact-points",
          type: "circle",
          source: "impact",
          minzoom: 10,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 2.5, 14, 5],
            "circle-color": [
              "match",
              ["get", "type"],
              "hospital", IMPACT_COLORS.hospital,
              "school", IMPACT_COLORS.school,
              "shelter", IMPACT_COLORS.shelter,
              "bridge", IMPACT_COLORS.bridge,
              "#b9c4cc",
            ],
            "circle-stroke-width": 1,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.7,
          },
        });

        // --- Rivers: risk halo, white casing, coloured line (Google road styling) ---
        map.addSource("rivers", { type: "geojson", data: riversRef.current });
        map.addLayer({
          id: "rivers-glow",
          type: "line",
          source: "rivers",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": RIVER_COLOR_EXPR,
            "line-width": 12,
            "line-blur": 5,
            "line-opacity": RIVER_GLOW_OPACITY_EXPR,
          },
        });
        map.addLayer({
          id: "rivers-casing",
          type: "line",
          source: "rivers",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#ffffff", "line-width": RIVER_CASING_WIDTH_EXPR, "line-opacity": 0.9 },
        });
        map.addLayer({
          id: "rivers-line",
          type: "line",
          source: "rivers",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": RIVER_COLOR_EXPR,
            "line-width": RIVER_WIDTH_EXPR,
            "line-opacity": 1,
          },
        });
        map.addLayer({
          id: "rivers-hover",
          type: "line",
          source: "rivers",
          filter: ["==", ["get", "id"], ""],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ROUTE_HIGHLIGHT_COLOR,
            "line-width": 10,
            "line-blur": 2,
            "line-opacity": 0.3,
          },
        });
        // Near-invisible wide stroke: the visible river is ~2.6px, far too thin
        // to hit reliably, so clicks/hover are tested against this instead.
        map.addLayer({
          id: "rivers-hit",
          type: "line",
          source: "rivers",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: { "line-color": "#000", "line-width": 34, "line-opacity": 0.01 },
        });

        // --- Assets inside the forecast flood extent at the active horizon ---
        const assetColor = [
          "match",
          ["get", "type"],
          "hospital", IMPACT_COLORS.hospital,
          "school", IMPACT_COLORS.school,
          "shelter", IMPACT_COLORS.shelter,
          "bridge", IMPACT_COLORS.bridge,
          "#b9c4cc",
        ] as unknown as maplibregl.ExpressionSpecification;
        const assetSize = (big: number, small: number) =>
          ["match", ["get", "type"], "hospital", big, "shelter", big, small] as unknown as maplibregl.ExpressionSpecification;
        map.addSource("exposed", { type: "geojson", data: exposedCollection(null, 0) });
        map.addLayer({
          id: "exposed-halo",
          type: "circle",
          source: "exposed",
          paint: {
            "circle-radius": assetSize(12, 9),
            "circle-color": assetColor,
            "circle-blur": 0.9,
            "circle-opacity": 0.3,
          },
        });
        map.addLayer({
          id: "exposed-points",
          type: "circle",
          source: "exposed",
          paint: {
            "circle-radius": assetSize(6, 4.5),
            "circle-color": assetColor,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "exposed-label",
          type: "symbol",
          source: "exposed",
          minzoom: 11.5,
          layout: {
            "text-field": ["get", "name"],
            "text-size": 10.5,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-optional": true,
            "text-font": ["Noto Sans Regular"],
          },
          paint: { "text-color": LABEL_TEXT, "text-halo-color": "#ffffff", "text-halo-width": 1.5 },
        });

        // --- Dams ---
        map.addSource("dams", { type: "geojson", data: damsRef.current });
        map.addLayer({
          id: "dams-glow",
          type: "circle",
          source: "dams",
          // Soft drop shadow under the marker, like a Google pin.
          paint: {
            "circle-radius": 11,
            "circle-color": "#000000",
            "circle-blur": 1,
            "circle-opacity": 0.18,
            "circle-translate": [0, 1.5],
          },
        });
        map.addLayer({
          id: "dams-circle",
          type: "circle",
          source: "dams",
          paint: {
            "circle-radius": 6.5,
            "circle-color": ["match", ["coalesce", ["get", "risk"], "NORMAL"], "NORMAL", "#1a73e8", ["get", "color"]],
            "circle-stroke-width": 2.5,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "dams-hit",
          type: "circle",
          source: "dams",
          paint: { "circle-radius": 18, "circle-color": "#000", "circle-opacity": 0.01 },
        });
        map.addLayer({
          id: "dams-label",
          type: "symbol",
          source: "dams",
          layout: {
            "text-field": ["get", "name"],
            "text-size": 11.5,
            "text-offset": [0, 1.2],
            "text-anchor": "top",
            "text-font": ["Noto Sans Regular"],
          },
          paint: {
            "text-color": "#1967d2",
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.6,
          },
        });

        // --- Sea level at river mouths (offshore, in the Arabian Sea) ---
        map.addSource("outlets", { type: "geojson", data: outletCollection(coastalRef.current) });
        map.addLayer({
          id: "outlets-ring",
          type: "circle",
          source: "outlets",
          paint: {
            "circle-radius": 11,
            "circle-color": ["get", "color"],
            "circle-opacity": 0.18,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": ["get", "color"],
            "circle-pitch-alignment": "map",
          },
        });
        map.addLayer({
          id: "outlets-circle",
          type: "circle",
          source: "outlets",
          paint: {
            "circle-radius": 5,
            "circle-color": ["get", "color"],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
        map.addLayer({
          id: "outlets-label",
          type: "symbol",
          source: "outlets",
          layout: {
            "text-field": ["get", "label"],
            "text-size": 11,
            "text-anchor": "right",
            "text-offset": [-1.4, 0],
            "text-font": ["Noto Sans Regular"],
            "text-optional": true,
          },
          paint: { "text-color": "#174ea6", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
        });

        // --- Show only Kerala: everything outside it (neighbouring land, roads,
        // labels, relief, satellite imagery, and river stretches beyond the
        // border) is painted over as sea. Only the offshore sea-level markers
        // and the state outline sit above it. ---
        map.addLayer(
          {
            id: "kerala-mask-fill",
            type: "fill",
            source: "kerala-mask",
            paint: { "fill-color": WATER_COLOR, "fill-opacity": 1, "fill-antialias": false },
          },
          "outlets-ring"
        );
        map.moveLayer("kerala-outline-casing", "outlets-ring");
        map.moveLayer("kerala-outline-line", "outlets-ring");

        // --- Camera: frame Kerala exactly, then hold it on-state ---
        const { minLng, minLat, maxLng, maxLat } = ringBounds(outerRing);
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: paddingRef.current, duration: 0 }
        );
        const pad = 2;
        map.setMaxBounds([
          [minLng - pad, minLat - pad],
          [maxLng + pad, maxLat + pad],
        ]);
        const center = map.getCenter();
        overviewRef.current = {
          center: [center.lng, center.lat],
          zoom: map.getZoom(),
          pitch: map.getPitch(),
          bearing: map.getBearing(),
        };
        setBearing(map.getBearing());
        setPitch(map.getPitch());

        // Priority when several things are under the cursor: dams, then assets
        // (small targets), then rivers (wide hit area).
        const TOLERANCE = 8;
        const ASSET_TOLERANCE = 5;
        type Hit =
          | { kind: "dam" | "river"; id: string; name: string }
          | { kind: "asset"; name: string; type: string; depth: number | null; lngLat: [number, number] }
          | { kind: "outlet"; name: string; detail: string; lngLat: [number, number] };
        const around = (x: number, y: number, r: number): [[number, number], [number, number]] => [
          [x - r, y - r],
          [x + r, y + r],
        ];
        const pick = ({ x, y }: { x: number; y: number }): Hit | null => {
          const dam = map.queryRenderedFeatures([x, y], { layers: ["dams-hit"] })[0];
          if (dam) return { kind: "dam", id: dam.properties?.id, name: dam.properties?.name };
          const outlet = map.queryRenderedFeatures(around(x, y, TOLERANCE), { layers: ["outlets-ring", "outlets-circle"] })[0];
          if (outlet) {
            const p = outlet.properties ?? {};
            const drainage = String(p.drainage).replace("_", " ").toLowerCase();
            return {
              kind: "outlet",
              name: p.name,
              detail: `${Number(p.level_m) >= 0 ? "+" : ""}${Number(p.level_m).toFixed(2)} m · ${drainage}`,
              lngLat: (outlet.geometry as GeoJSON.Point).coordinates as [number, number],
            };
          }
          const asset =
            map.queryRenderedFeatures(around(x, y, ASSET_TOLERANCE), { layers: ["exposed-points"] })[0] ??
            map.queryRenderedFeatures(around(x, y, ASSET_TOLERANCE), { layers: ["impact-points"] })[0];
          if (asset) {
            return {
              kind: "asset",
              name: asset.properties?.name,
              type: asset.properties?.type,
              depth: asset.layer.id === "exposed-points" ? Number(asset.properties?.depth_m) : null,
              lngLat: (asset.geometry as GeoJSON.Point).coordinates as [number, number],
            };
          }
          const river = map.queryRenderedFeatures(around(x, y, TOLERANCE), { layers: ["rivers-hit"] })[0];
          if (river) return { kind: "river", id: river.properties?.id, name: river.properties?.name };
          return null;
        };

        const describe = (hit: Hit): Omit<HoverInfo, "x" | "y"> => {
          if (hit.kind === "outlet") return { label: "Sea level", name: hit.name, detail: hit.detail };
          if (hit.kind !== "asset") {
            return { label: hit.kind === "dam" ? "Dam" : "River", name: hit.name, detail: "Click to fly in" };
          }
          return {
            label: ASSET_LABELS[hit.type] ?? hit.type,
            name: hit.name,
            detail:
              hit.depth === null
                ? "Outside forecast flood extent"
                : `Inside forecast extent · ~${hit.depth.toFixed(1)} m modelled depth`,
          };
        };

        const setRiverHover = (id: string | null) => {
          if (hoverIdRef.current === id) return;
          hoverIdRef.current = id;
          map.setFilter("rivers-hover", ["==", ["get", "id"], id ?? ""]);
        };

        const clearHover = () => {
          map.getCanvas().style.cursor = "";
          setRiverHover(null);
          setHover(null);
        };

        // Pointer only over something clickable; everywhere else MapLibre's own
        // grab/grabbing hand shows, so it's clear where dragging pans the map.
        map.on("mousemove", (e: maplibregl.MapMouseEvent) => {
          if (map.isMoving()) return;
          const hit = pick(e.point);
          if (!hit) return clearHover();
          map.getCanvas().style.cursor = "pointer";
          setRiverHover(hit.kind === "river" ? hit.id : null);
          setHover({ x: e.point.x, y: e.point.y, ...describe(hit) });
        });
        map.on("mouseout", clearHover);
        map.on("movestart", clearHover);

        map.on("click", (e: maplibregl.MapMouseEvent) => {
          const hit = pick(e.point);
          if (!hit) {
            if (onPickPointRef.current) return onPickPointRef.current(e.lngLat.lng, e.lngLat.lat);
            return onDeselectRef.current?.();
          }
          if (hit.kind === "asset") {
            map.flyTo({ center: hit.lngLat, zoom: Math.max(map.getZoom(), 14), pitch: 62, duration: 1200, essential: true });
          } else if (hit.kind === "outlet") {
            map.flyTo({ center: hit.lngLat, zoom: Math.max(map.getZoom(), 10.5), duration: 1200, essential: true });
          } else if (hit.kind === "dam") onSelectDamRef.current?.(hit.id);
          else onSelectRiverRef.current?.(hit.id);
        });

        applySnapshotColors();
        mapReadyRef.current = true;
        syncFlood();
        applyDisplayOptions();
        syncPin(true);
      });
    }

    loadMapLibre()
      .then((gl) => {
        if (!cancelled) mount(gl);
      })
      .catch((err) => console.error(err));

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MapLibre applies its own `.maplibregl-map` class (position: relative) to the
  // container element it's given. That collided with Tailwind's `absolute inset-0`
  // utility class on the same node and collapsed it to zero height, so the map
  // container is a plain div sized with inline styles (which win on specificity)
  // inside a Tailwind-positioned wrapper.
  const is3D = pitch > 5;
  const zoomBy = (delta: number) => mapRef.current?.easeTo({ zoom: mapRef.current.getZoom() + delta, duration: 300 });
  const resetNorth = () => mapRef.current?.easeTo({ bearing: 0, duration: 500 });
  const toggle3D = () => mapRef.current?.easeTo({ pitch: is3D ? 0 : 55, duration: 600 });
  const resetView = () => {
    const overview = overviewRef.current;
    if (overview) mapRef.current?.flyTo({ ...overview, duration: 1400, essential: true });
    onDeselect?.();
  };

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {hover && (
        <div
          className="pointer-events-none absolute z-20 max-w-[260px] maps-glass-strong !rounded-xl px-3 py-2 text-[13px] text-[#202124]"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="font-medium leading-tight">{hover.name}</div>
          <div className="mt-0.5 text-xs text-[#5f6368]">
            {hover.label} · {hover.detail}
          </div>
        </div>
      )}

      <div className="absolute bottom-8 right-4 z-20 flex flex-col items-center gap-2.5">
        <MapButton title="Show all of Kerala" onClick={resetView}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3.5" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
          </svg>
        </MapButton>
        <MapButton title={is3D ? "Switch to 2D" : "Switch to 3D"} onClick={toggle3D}>
          <span className="text-[13px] font-medium">{is3D ? "2D" : "3D"}</span>
        </MapButton>
        <MapButton title="Reset north (right-drag to rotate/tilt)" onClick={resetNorth}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" style={{ transform: `rotate(${-bearing}deg)`, transition: "transform 80ms linear" }}>
            <path d="M12 3l3.5 9h-7z" fill="#ea4335" />
            <path d="M12 21l-3.5-9h7z" fill="#9aa0a6" />
          </svg>
        </MapButton>
        <div className="maps-glass flex flex-col overflow-hidden !rounded-xl">
          <button
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => zoomBy(1)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center text-[#5f6368] hover:bg-white/70 hover:text-[#202124]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z" />
            </svg>
          </button>
          <div className="mx-2 h-px bg-black/[0.08]" />
          <button
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => zoomBy(-1)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center text-[#5f6368] hover:bg-white/70 hover:text-[#202124]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M19 13H5v-2h14z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function MapButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-10 w-10 cursor-pointer items-center justify-center maps-glass !rounded-xl text-[#5f6368] hover:!bg-white/80 hover:text-[#202124]"
    >
      {children}
    </button>
  );
}
