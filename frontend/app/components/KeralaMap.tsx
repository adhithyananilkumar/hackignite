"use client";

import type * as maplibregl from "maplibre-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { API_BASE, api, type FloodForecast } from "../lib/api";
import type { LiveSnapshot } from "../lib/useLiveData";

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

const RISK_COLORS: Record<string, string> = {
  NORMAL: "#3ddc84",
  WATCH: "#f4d35e",
  ADVISORY: "#f5a623",
  HIGH: "#f0623a",
  CRITICAL: "#ff3b3b",
};

const IMPACT_COLORS: Record<string, string> = {
  hospital: "#ff6b6b",
  school: "#ffd166",
  shelter: "#35c2f0",
  bridge: "#b9c4cc",
};

const DEEP_WATER = "#03060b";
const TERRAIN_DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const ROUTE_HIGHLIGHT_COLOR = "#9fe9ff";

export type MapSelection = { type: "river" | "dam"; id: string } | null;
export type MapFocus = { lon: number; lat: number; key: string } | null;

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

// A world rectangle with the Kerala outline punched out as a hole: filled in
// deep black, this hides every other state/country so only Kerala shows.
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
  onSelectRiver,
  onSelectDam,
  onDeselect,
}: {
  snapshot: LiveSnapshot | null;
  selection?: MapSelection;
  flood?: FloodForecast | null;
  horizonIndex?: number;
  focus?: MapFocus;
  onSelectRiver?: (id: string) => void;
  onSelectDam?: (id: string) => void;
  onDeselect?: () => void;
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
          { id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-fade-duration": 200 } },
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
  }, [onDeselect]);

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
      if (overview) {
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
          padding: { top: 140, bottom: 180, left: 320, right: 340 },
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
    map.setPaintProperty("rivers-line", "line-opacity", ["case", isSelected, 1, 0.12]);
    map.setPaintProperty("rivers-line", "line-width", ["case", isSelected, 4.4, 2]);
    map.setPaintProperty("rivers-glow", "line-color", [
      "case",
      isSelected,
      ROUTE_HIGHLIGHT_COLOR,
      ["coalesce", ["get", "color"], "#35c2f0"],
    ]);
    map.setPaintProperty("rivers-glow", "line-opacity", ["case", isSelected, 0.85, 0.05]);
    map.setPaintProperty("rivers-glow", "line-width", ["case", isSelected, 17, 9]);
    map.setPaintProperty("dams-circle", "circle-opacity", 0.3);
    map.setPaintProperty("dams-glow", "circle-opacity", 0.1);
    map.setPaintProperty("dams-label", "text-opacity", 0.3);
  }

  function highlightDam(map: maplibregl.Map, id: string) {
    const isSelected = ["==", ["get", "id"], id];
    map.setPaintProperty("dams-circle", "circle-opacity", ["case", isSelected, 1, 0.25]);
    map.setPaintProperty("dams-circle", "circle-radius", ["case", isSelected, 9, 6]);
    map.setPaintProperty("dams-glow", "circle-color", [
      "case",
      isSelected,
      ROUTE_HIGHLIGHT_COLOR,
      ["coalesce", ["get", "color"], "#35c2f0"],
    ]);
    map.setPaintProperty("dams-glow", "circle-opacity", ["case", isSelected, 0.6, 0.08]);
    map.setPaintProperty("dams-glow", "circle-radius", ["case", isSelected, 24, 14]);
    map.setPaintProperty("dams-label", "text-opacity", ["case", isSelected, 1, 0.3]);
    map.setPaintProperty("rivers-line", "line-opacity", 0.3);
    map.setPaintProperty("rivers-glow", "line-opacity", 0.08);
  }

  function resetHighlight(map: maplibregl.Map) {
    map.setPaintProperty("rivers-line", "line-opacity", 0.95);
    map.setPaintProperty("rivers-line", "line-width", 2.6);
    map.setPaintProperty("rivers-glow", "line-color", ["coalesce", ["get", "color"], "#35c2f0"]);
    map.setPaintProperty("rivers-glow", "line-opacity", 0.45);
    map.setPaintProperty("rivers-glow", "line-width", 9);
    map.setPaintProperty("dams-circle", "circle-opacity", 1);
    map.setPaintProperty("dams-circle", "circle-radius", 6);
    map.setPaintProperty("dams-glow", "circle-color", ["coalesce", ["get", "color"], "#35c2f0"]);
    map.setPaintProperty("dams-glow", "circle-opacity", 0.35);
    map.setPaintProperty("dams-glow", "circle-radius", 14);
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

  // Any style layer whose own id/source hints at open water gets recolored to a
  // near-black "deep sea" tone instead of the basemap's default blue.
  function blackenWater(map: maplibregl.Map) {
    for (const layer of map.getStyle().layers ?? []) {
      const id = layer.id.toLowerCase();
      if (!id.includes("water") && !id.includes("ocean")) continue;
      try {
        if (layer.type === "fill") map.setPaintProperty(layer.id, "fill-color", DEEP_WATER);
        if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", DEEP_WATER);
        if (layer.type === "line") map.setPaintProperty(layer.id, "line-color", DEEP_WATER);
      } catch {
        // Style-dependent; skip layers that don't support the property.
      }
    }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let resizeObserver: ResizeObserver | undefined;

    function mount(gl: typeof maplibregl) {
      if (!containerRef.current) return;
      const map = new gl.Map({
        container: containerRef.current,
        style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
        center: [76.4, 10.3],
        zoom: 6.6,
        pitch: 52,
        bearing: -12,
        minZoom: 6,
        maxZoom: 14,
        maxPitch: 75,
        antialias: true,
      });
      mapRef.current = map;
      (window as unknown as { __map: unknown }).__map = map; // TEMP debug
      // Google-Maps-style gestures: left-drag pans, right-drag (or ctrl+drag)
      // rotates and tilts, wheel zooms toward the cursor, double-click zooms in.
      map.dragRotate.enable();
      map.touchZoomRotate.enableRotation();
      map.keyboard.enable();
      map.on("rotate", () => setBearing(map.getBearing()));
      map.on("pitch", () => setPitch(map.getPitch()));

      resizeObserver = new ResizeObserver(() => map.resize());
      resizeObserver.observe(containerRef.current);

      map.on("load", async () => {
        map.resize();
        blackenWater(map);

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
        map.setTerrain({ source: "terrain-dem", exaggeration: 1.4 });
        map.addLayer({
          id: "hillshade",
          type: "hillshade",
          source: "terrain-dem",
          paint: {
            "hillshade-shadow-color": "#000814",
            "hillshade-highlight-color": "#3a4a52",
            "hillshade-accent-color": "#0a0e12",
            "hillshade-exaggeration": 0.55,
          },
        });
        if (typeof (map as any).setSky === "function") {
          try {
            (map as any).setSky({
              "sky-color": "#0a1620",
              "horizon-color": "#111c26",
              "fog-color": "#0a1620",
              "fog-ground-blend": 0.5,
              "horizon-fog-blend": 0.6,
              "sky-horizon-blend": 0.8,
              "atmosphere-blend": 0.7,
            });
          } catch {
            // Sky layer isn't supported by every style/runtime combination.
          }
        }

        // --- Kerala-only mask: black out the rest of the world ---
        const outerRing = boundary.features[0].geometry.coordinates[0] as [number, number][];
        map.addSource("kerala-mask", { type: "geojson", data: buildMask(outerRing) });
        map.addLayer({
          id: "kerala-mask-fill",
          type: "fill",
          source: "kerala-mask",
          paint: { "fill-color": "#01040a", "fill-opacity": 1 },
        });

        map.addSource("kerala-outline", { type: "geojson", data: boundary });
        map.addLayer({
          id: "kerala-outline-glow",
          type: "line",
          source: "kerala-outline",
          paint: { "line-color": "#35c2f0", "line-width": 6, "line-blur": 6, "line-opacity": 0.35 },
        });
        map.addLayer({
          id: "kerala-outline-line",
          type: "line",
          source: "kerala-outline",
          paint: { "line-color": "#7fd8f7", "line-width": 1.4, "line-opacity": 0.8 },
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
            "circle-stroke-color": "#04070c",
            "circle-opacity": 0.55,
          },
        });

        // --- Rivers: soft glow layer + crisp line on top ---
        map.addSource("rivers", { type: "geojson", data: riversRef.current });
        map.addLayer({
          id: "rivers-glow",
          type: "line",
          source: "rivers",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#35c2f0"],
            "line-width": 9,
            "line-blur": 5,
            "line-opacity": 0.45,
          },
        });
        map.addLayer({
          id: "rivers-line",
          type: "line",
          source: "rivers",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": ["coalesce", ["get", "color"], "#35c2f0"],
            "line-width": 2.6,
            "line-opacity": 0.95,
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
            "line-width": 7,
            "line-blur": 2,
            "line-opacity": 0.55,
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
            "circle-radius": assetSize(13, 9),
            "circle-color": assetColor,
            "circle-blur": 1,
            "circle-opacity": 0.45,
          },
        });
        map.addLayer({
          id: "exposed-points",
          type: "circle",
          source: "exposed",
          paint: {
            "circle-radius": assetSize(5.5, 4),
            "circle-color": assetColor,
            "circle-stroke-width": 1.5,
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
          paint: { "text-color": "#eaf2f6", "text-halo-color": "#04070c", "text-halo-width": 1.2 },
        });

        // --- Dams ---
        map.addSource("dams", { type: "geojson", data: damsRef.current });
        map.addLayer({
          id: "dams-glow",
          type: "circle",
          source: "dams",
          paint: {
            "circle-radius": 14,
            "circle-color": ["coalesce", ["get", "color"], "#35c2f0"],
            "circle-blur": 1,
            "circle-opacity": 0.35,
          },
        });
        map.addLayer({
          id: "dams-circle",
          type: "circle",
          source: "dams",
          paint: {
            "circle-radius": 6,
            "circle-color": ["coalesce", ["get", "color"], "#35c2f0"],
            "circle-stroke-width": 2,
            "circle-stroke-color": "#04070c",
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
            "text-size": 11,
            "text-offset": [0, 1.2],
            "text-anchor": "top",
            "text-font": ["Noto Sans Regular"],
          },
          paint: {
            "text-color": "#eaf2f6",
            "text-halo-color": "#04070c",
            "text-halo-width": 1.2,
          },
        });

        // --- Camera: frame Kerala exactly, then hold it on-state ---
        const { minLng, minLat, maxLng, maxLat } = ringBounds(outerRing);
        map.fitBounds(
          [
            [minLng, minLat],
            [maxLng, maxLat],
          ],
          { padding: 40, duration: 0 }
        );
        const pad = 1.1;
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
          | { kind: "asset"; name: string; type: string; depth: number | null; lngLat: [number, number] };
        const around = (x: number, y: number, r: number): [[number, number], [number, number]] => [
          [x - r, y - r],
          [x + r, y + r],
        ];
        const pick = ({ x, y }: { x: number; y: number }): Hit | null => {
          const dam = map.queryRenderedFeatures([x, y], { layers: ["dams-hit"] })[0];
          if (dam) return { kind: "dam", id: dam.properties?.id, name: dam.properties?.name };
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
          if (!hit) return onDeselectRef.current?.();
          if (hit.kind === "asset") {
            map.flyTo({ center: hit.lngLat, zoom: Math.max(map.getZoom(), 14), pitch: 62, duration: 1200, essential: true });
          } else if (hit.kind === "dam") onSelectDamRef.current?.(hit.id);
          else onSelectRiverRef.current?.(hit.id);
        });

        applySnapshotColors();
        mapReadyRef.current = true;
        syncFlood();
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
  const toggle3D = () => mapRef.current?.easeTo({ pitch: is3D ? 0 : 60, duration: 600 });
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
          className="pointer-events-none absolute z-20 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] px-2.5 py-1.5 text-xs text-[var(--glass-text)] shadow-lg backdrop-blur-md"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <span className="mr-1.5 text-[10px] uppercase tracking-wider text-[var(--glass-text-dim)]">{hover.label}</span>
          <span className="font-semibold">{hover.name}</span>
          <div className="mt-0.5 text-[10px] text-[var(--glass-text-dim)]">{hover.detail}</div>
        </div>
      )}

      <div className="absolute bottom-10 right-4 z-20 flex flex-col items-center gap-2">
        <MapButton title="Reset view" onClick={resetView}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
          </svg>
        </MapButton>
        <MapButton title={is3D ? "Switch to 2D" : "Switch to 3D"} onClick={toggle3D}>
          <span className="text-[11px] font-bold">{is3D ? "2D" : "3D"}</span>
        </MapButton>
        <MapButton title="Reset north (right-drag to rotate/tilt)" onClick={resetNorth}>
          <svg viewBox="0 0 24 24" className="h-5 w-5" style={{ transform: `rotate(${-bearing}deg)`, transition: "transform 80ms linear" }}>
            <path d="M12 3l3.5 9h-7z" fill="#ff5a5a" />
            <path d="M12 21l-3.5-9h7z" fill="currentColor" opacity="0.6" />
          </svg>
        </MapButton>
        <div className="flex flex-col overflow-hidden rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] backdrop-blur-md shadow-lg">
          <button
            title="Zoom in"
            onClick={() => zoomBy(1)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center text-lg text-[var(--glass-text)] hover:bg-[var(--glass-highlight)]"
          >
            +
          </button>
          <div className="mx-2 h-px bg-[var(--glass-border)]" />
          <button
            title="Zoom out"
            onClick={() => zoomBy(-1)}
            className="flex h-10 w-10 cursor-pointer items-center justify-center text-lg text-[var(--glass-text)] hover:bg-[var(--glass-highlight)]"
          >
            −
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
      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg-strong)] text-[var(--glass-text)] shadow-lg backdrop-blur-md hover:bg-[var(--glass-highlight)]"
    >
      {children}
    </button>
  );
}
