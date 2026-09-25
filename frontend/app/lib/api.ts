export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export type RiskLevel = "NORMAL" | "WATCH" | "ADVISORY" | "HIGH" | "CRITICAL";

export interface RiverReading {
  river_id: string;
  level_m: number;
  danger_level_m: number;
  warning_level_m: number;
  rise_rate_m_per_hr: number;
  risk: RiskLevel;
  updated_at: string;
  source: string;
  discharge_m3s: number | null;
  rain_past_24h_mm: number | null;
  rain_next_24h_mm: number | null;
}

export interface DamReading {
  dam_id: string;
  storage_pct: number;
  inflow_m3s: number;
  outflow_m3s: number;
  rule_level_status: string;
  risk: RiskLevel;
  updated_at: string;
  source: string;
}

export type SourceMode = "live" | "simulation";

export interface LiveSourceStatus {
  state: "loading" | "ok" | "degraded" | "unavailable";
  last_updated: string | null;
  gauges_live: number;
  gauges_total: number;
  errors: number;
}

export interface SimulationSourceStatus {
  scenario_id: string;
  scenarios: { id: string; name: string; description: string }[];
  playing: boolean;
  speed: number;
  speeds: number[];
  progress: number;
  scenario_hours: number;
  represents_hours: number;
}

export interface SourcesState {
  mode: SourceMode;
  modes: { id: SourceMode; label: string; kind: string; description: string }[];
  status: { live: LiveSourceStatus; simulation: SimulationSourceStatus };
}

export interface ForecastPoint {
  horizon_hours: number;
  level_m: number;
  confidence_pct: number;
}

export interface RiverForecast {
  river_id: string;
  points: ForecastPoint[];
  danger_crossing_hours: number | null;
}

export interface ImpactCounts {
  population: number;
  hospitals: number;
  schools: number;
  shelters: number;
  bridges: number;
}

export interface ExposedAsset {
  id: string;
  name: string;
  type: "hospital" | "school" | "shelter" | "bridge";
  depth_m: number;
  lon: number;
  lat: number;
}

export interface FloodHorizon extends ImpactCounts {
  horizon_hours: number;
  level_m: number;
  stage_m: number;
  confidence_pct: number;
  flooded_area_km2: number;
  max_depth_m: number;
  exposed_assets: ExposedAsset[];
}

export interface RiverFloodForecast {
  river_id: string;
  danger_level_m: number;
  horizons: FloodHorizon[];
}

export interface FloodForecast {
  model: string;
  model_label: string;
  generated_at: string;
  horizons_hours: number[];
  horizon_tiles: (string | null)[];
  depth_bands: { min_m: number; color: string }[];
  rivers: RiverFloodForecast[];
  unmodelled_rivers: string[];
}

export interface Alert {
  id: string;
  target_id: string;
  target_type: string;
  risk: RiskLevel;
  message: string;
  created_at: string;
  acknowledged: boolean;
}

export interface DataHealthSource {
  name: string;
  status: string;
  detail: string;
  as_of: string;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

// Static layers are requested by several components (map, search, panels):
// fetch each once per page load.
const staticCache = new Map<string, Promise<GeoJSON.FeatureCollection>>();
function staticGeoJson(path: string): Promise<GeoJSON.FeatureCollection> {
  let pending = staticCache.get(path);
  if (!pending) {
    pending = getJson<GeoJSON.FeatureCollection>(path);
    pending.catch(() => staticCache.delete(path));
    staticCache.set(path, pending);
  }
  return pending;
}

export const api = {
  riversGeoJson: () => staticGeoJson("/rivers/geojson"),
  damsGeoJson: () => staticGeoJson("/dams/geojson"),
  boundaryGeoJson: () => staticGeoJson("/boundary/geojson"),
  impactGeoJson: () => staticGeoJson("/impact/geojson"),
  forecast: (riverId: string) => getJson<RiverForecast>(`/forecast/rivers/${riverId}`),
  floodForecast: () => getJson<FloodForecast>("/flood/forecast"),
  sources: () => getJson<SourcesState>("/sources"),
  setSourceMode: (mode: SourceMode) => postJson<SourcesState>("/sources/mode", { mode }),
  controlSimulation: (body: { scenario_id?: string; action?: "play" | "pause" | "restart"; speed?: number }) =>
    postJson<SourcesState>("/sources/simulation", body),
  alerts: () => getJson<Alert[]>("/alerts"),
  health: () => getJson<{ sources: DataHealthSource[] }>("/health"),
  ackAlert: (id: string) => fetch(`${API_BASE}/alerts/${id}/ack`, { method: "POST" }),
  askAi: (question: string) =>
    fetch(`${API_BASE}/ai/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    }).then((r) => r.json() as Promise<{ answer: string }>),
};
