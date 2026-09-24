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
}

export interface DamReading {
  dam_id: string;
  storage_pct: number;
  inflow_m3s: number;
  outflow_m3s: number;
  rule_level_status: string;
  risk: RiskLevel;
  updated_at: string;
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

export interface ImpactSummary {
  basin_id: string;
  population: number;
  hospitals: number;
  schools: number;
  shelters: number;
  bridges: number;
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

export const api = {
  riversGeoJson: () => getJson<GeoJSON.FeatureCollection>("/rivers/geojson"),
  damsGeoJson: () => getJson<GeoJSON.FeatureCollection>("/dams/geojson"),
  boundaryGeoJson: () => getJson<GeoJSON.FeatureCollection>("/boundary/geojson"),
  impactGeoJson: () => getJson<GeoJSON.FeatureCollection>("/impact/geojson"),
  forecast: (riverId: string) => getJson<RiverForecast>(`/forecast/rivers/${riverId}`),
  impact: (basinId: string) => getJson<ImpactSummary>(`/impact/${basinId}`),
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
