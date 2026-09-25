from enum import Enum

from pydantic import BaseModel


class RiskLevel(str, Enum):
    NORMAL = "NORMAL"
    WATCH = "WATCH"
    ADVISORY = "ADVISORY"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class RiverReading(BaseModel):
    river_id: str
    level_m: float
    danger_level_m: float
    warning_level_m: float
    rise_rate_m_per_hr: float
    risk: RiskLevel
    updated_at: str
    source: str = "simulation"
    # Populated by live feeds; absent in simulation.
    discharge_m3s: float | None = None
    rain_past_24h_mm: float | None = None
    rain_next_24h_mm: float | None = None


class DamReading(BaseModel):
    dam_id: str
    storage_pct: float
    inflow_m3s: float
    outflow_m3s: float
    rule_level_status: str
    risk: RiskLevel
    updated_at: str
    source: str = "simulation"


class ForecastPoint(BaseModel):
    horizon_hours: float
    level_m: float
    confidence_pct: float


class RiverForecast(BaseModel):
    river_id: str
    points: list[ForecastPoint]
    danger_crossing_hours: float | None = None


class ImpactSummary(BaseModel):
    """Modelled potential exposure inside the forecast flood extent — not confirmed damage."""
    basin_id: str
    horizon_hours: float
    flooded_area_km2: float
    population: int
    hospitals: int
    schools: int
    shelters: int
    bridges: int
    model: str


class ExposedAsset(BaseModel):
    id: str
    name: str
    type: str
    depth_m: float
    lon: float
    lat: float


class FloodHorizon(BaseModel):
    horizon_hours: float
    level_m: float
    stage_m: float  # metres above danger level; flooding starts above 0
    confidence_pct: float
    flooded_area_km2: float
    max_depth_m: float
    population: int
    hospitals: int
    schools: int
    shelters: int
    bridges: int
    exposed_assets: list[ExposedAsset] = []


class RiverFloodForecast(BaseModel):
    river_id: str
    danger_level_m: float
    horizons: list[FloodHorizon]


class DepthBand(BaseModel):
    min_m: float
    color: str


class FloodForecast(BaseModel):
    model: str
    model_label: str
    generated_at: str
    horizons_hours: list[float]
    # XYZ tile URL template per horizon ({z}/{x}/{y}); None when nothing floods.
    horizon_tiles: list[str | None]
    depth_bands: list[DepthBand]
    rivers: list[RiverFloodForecast]
    unmodelled_rivers: list[str]


class Alert(BaseModel):
    id: str
    target_id: str
    target_type: str
    risk: RiskLevel
    message: str
    created_at: str
    acknowledged: bool = False
