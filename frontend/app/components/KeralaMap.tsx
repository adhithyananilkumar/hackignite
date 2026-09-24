"use client";

import type * as maplibregl from "maplibre-gl";
import { useEffect, useRef } from "react";
import { api } from "../lib/api";
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
  onSelectRiver,
  onSelectDam,
}: {
  snapshot: LiveSnapshot | null;
  onSelectRiver?: (id: string) => void;
  onSelectDam?: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const riversRef = useRef<any>(null);
  const damsRef = useRef<any>(null);
  const snapshotRef = useRef<LiveSnapshot | null>(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
    applySnapshotColors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

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
      map.addControl(new gl.NavigationControl({ visualizePitch: true }), "top-right");

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
          minzoom: 8,
          paint: {
            "circle-radius": 4,
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
            "circle-opacity": 0.9,
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

        const cursorPointer = () => (map.getCanvas().style.cursor = "pointer");
        const cursorDefault = () => (map.getCanvas().style.cursor = "");

        map.on("click", "rivers-line", (e: maplibregl.MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) onSelectRiver?.(id);
        });
        map.on("click", "dams-circle", (e: maplibregl.MapLayerMouseEvent) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) onSelectDam?.(id);
        });
        for (const layer of ["rivers-line", "dams-circle", "impact-points"]) {
          map.on("mouseenter", layer, cursorPointer);
          map.on("mouseleave", layer, cursorDefault);
        }

        applySnapshotColors();
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
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
