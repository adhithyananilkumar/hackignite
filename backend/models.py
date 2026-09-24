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


class DamReading(BaseModel):
    dam_id: str
    storage_pct: float
    inflow_m3s: float
    outflow_m3s: float
    rule_level_status: str
    risk: RiskLevel
    updated_at: str


class ForecastPoint(BaseModel):
    horizon_hours: float
    level_m: float
    confidence_pct: float


class RiverForecast(BaseModel):
    river_id: str
    points: list[ForecastPoint]
    danger_crossing_hours: float | None = None


class ImpactSummary(BaseModel):
    basin_id: str
    population: int
    hospitals: int
    schools: int
    shelters: int
    bridges: int


class Alert(BaseModel):
    id: str
    target_id: str
    target_type: str
    risk: RiskLevel
    message: str
    created_at: str
    acknowledged: bool = False
