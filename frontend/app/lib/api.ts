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

export interface FlowDay {
  date: string;
  forecast: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
}

export interface FlowOutlook {
  source: string;
  cell: [number, number];
  unit: string;
  days: FlowDay[];
  warning_flow_m3s?: number | null;
  danger_flow_m3s?: number | null;
}

export interface TimeWindow {
  start: string;
  end: string;
  extreme_m: number;
}

export type Drainage = "FREE_DRAINING" | "TIDAL_CONSTRAINT" | "BACKWATER_RISK";

export interface CoastalOutlet {
  id: string;
  name: string;
  coordinates: [number, number];
  level_m: number;
  trend: "rising" | "falling";
  tide_filtered_anomaly_m: number;
  status: "NORMAL" | "ELEVATED" | "HIGH";
  drainage: Drainage;
  rivers: { id: string; name: string; risk: RiskLevel | null }[];
  thresholds: { p50: number; p90: number; p98: number; max: number };
  next_highs: { time: string; level_m: number }[];
  next_lows: { time: string; level_m: number }[];
  high_water_windows: TimeWindow[];
  low_tide_windows: TimeWindow[];
  series: { time: string; level_m: number | null }[];
}

export interface CoastalSnapshot {
  source: string;
  generated_at: string;
  now: string;
  simulated_surge_m: number;
  outlets: CoastalOutlet[];
}

export type ReservoirStatus = "COMFORTABLE" | "WATCH" | "PRE_RELEASE_REVIEW" | "CRITICAL" | "INSUFFICIENT_DATA";

export interface ReservoirOutlook {
  dam_id: string;
  name: string;
  status: ReservoirStatus;
  headline: string;
  downstream: {
    river_id: string | null;
    link: string;
    outlet_id: string | null;
    flow_now_m3s?: number;
    warning_flow_m3s?: number;
    headroom_m3s?: number;
    risk?: RiskLevel;
  };
  inputs: {
    storage_pct: number | null;
    capacity_mcm: number | null;
    outflow_m3s: number | null;
    storage_source: string;
    inflow_source: string;
  };
  inflow_forecast: { hours: number; median_m3s: number; worst_m3s: number }[];
  projection?: { hours: number; median_pct: number; worst_pct: number }[];
  peak_worst_pct?: number;
  hours_to_full_worst?: number | null;
  worst_case_inflow_72h_mcm: number;
  worst_case_inflow_72h_pct_of_capacity: number | null;
  upper_rule_pct: number;
  recommendation?: {
    extra_release_if_started_now_m3s: number;
    total_release_if_started_now_m3s: number;
    volume_to_release_mcm: number;
    latest_start: string | null;
    duration_at_downstream_capacity_h: number | null;
    fits_downstream_capacity: boolean | null;
  };
  coast?: { outlet: string; drainage: Drainage; low_tide_windows: TimeWindow[]; high_water_windows: TimeWindow[] };
  disclaimer: string;
}

export interface PointHorizon {
  horizon_hours: number;
  river_level_m: number;
  confidence_pct: number;
  flooded: boolean;
  depth_m: number;
}

export interface PointRiverExposure {
  river_id: string;
  name: string;
  risk: RiskLevel;
  river_level_m: number;
  danger_level_m: number;
  height_above_river_m: number;
  floods_when_above_danger_by_m: number;
  floods_at_river_level_m: number;
  margin_m: number;
  in_river_channel: boolean;
  horizons: PointHorizon[];
}

export interface NearbyPlace {
  name: string;
  distance_km: number;
  lon: number;
  lat: number;
}

export interface RainOutlook {
  available: boolean;
  next_24h_mm?: number;
  next_72h_mm?: number;
  chance_of_rain_24h_pct?: number;
  peak_hourly_mm?: number;
  imd_category_24h?: string;
}

export interface PointAssessment {
  lat: number;
  lon: number;
  data_source: { mode: string; kind: string };
  likelihood: { score: number; level: string; driver: string };
  nearest_river: { river_id: string; name: string; distance_km: number };
  modelled_floodplain: boolean;
  rivers: PointRiverExposure[];
  rain: RainOutlook;
  nearby: { shelter: NearbyPlace[]; hospital: NearbyPlace[] };
  note: string;
  place?: { name: string; detail: string } | null;
}

export interface PlaceMatch {
  name: string;
  detail: string;
  lat: number;
  lon: number;
  kind: string;
}

export type ChatAction =
  | { type: "select_river" | "select_dam"; id: string }
  | { type: "pin"; lat: number; lon: number; label: string; assessment: PointAssessment }
  | { type: "overview" };

export interface ChatStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
}

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ChatReply {
  answer: string;
  actions: ChatAction[];
  steps: ChatStep[];
}

export interface ChatUiContext {
  pin?: { lat: number; lon: number; label?: string } | null;
  selection?: { type: "river" | "dam"; id: string } | null;
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
  riverFlow: (riverId: string) => getJson<FlowOutlook>(`/flow/rivers/${riverId}`),
  damFlow: (damId: string) => getJson<FlowOutlook>(`/flow/dams/${damId}`),
  reservoirOutlook: (damId: string) => getJson<ReservoirOutlook>(`/reservoirs/${damId}/outlook`),
  coastal: () => getJson<CoastalSnapshot>("/coastal"),
  sources: () => getJson<SourcesState>("/sources"),
  setSourceMode: (mode: SourceMode) => postJson<SourcesState>("/sources/mode", { mode }),
  controlSimulation: (body: { scenario_id?: string; action?: "play" | "pause" | "restart"; speed?: number }) =>
    postJson<SourcesState>("/sources/simulation", body),
  alerts: () => getJson<Alert[]>("/alerts"),
  health: () => getJson<{ sources: DataHealthSource[] }>("/health"),
  ackAlert: (id: string) => fetch(`${API_BASE}/alerts/${id}/ack`, { method: "POST" }),
  assessPoint: (lat: number, lon: number) =>
    getJson<PointAssessment>(`/locate/assess?lat=${lat.toFixed(5)}&lon=${lon.toFixed(5)}`),
  searchPlaces: (q: string) => getJson<PlaceMatch[]>(`/locate/search?q=${encodeURIComponent(q)}`),
  chat: (message: string, history: ChatTurn[], ui: ChatUiContext) =>
    postJson<ChatReply>("/chat", { message, history, ui }),
};
