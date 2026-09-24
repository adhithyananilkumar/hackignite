"""Rule-based risk and forecast logic. No ML — plain thresholds and linear extrapolation,
deliberately, so every number on screen is traceable to an input."""

from models import ForecastPoint, RiskLevel

RIVER_RISK_LADDER = [
    (RiskLevel.CRITICAL, 1.00),
    (RiskLevel.HIGH, 0.90),
    (RiskLevel.ADVISORY, 0.75),
    (RiskLevel.WATCH, 0.55),
]


def compute_river_risk(level_m: float, danger_level_m: float, warning_level_m: float, rise_rate_m_per_hr: float) -> RiskLevel:
    ratio = level_m / danger_level_m if danger_level_m else 0
    rise_bonus = 0.06 if rise_rate_m_per_hr > 0.15 else 0.0
    score = ratio + rise_bonus
    for level, threshold in RIVER_RISK_LADDER:
        if score >= threshold:
            return level
    return RiskLevel.NORMAL


def compute_dam_risk(storage_pct: float, inflow_m3s: float, outflow_m3s: float) -> RiskLevel:
    imbalance = (inflow_m3s - outflow_m3s) / outflow_m3s if outflow_m3s else 0
    if storage_pct >= 95 or (storage_pct >= 85 and imbalance > 0.4):
        return RiskLevel.CRITICAL
    if storage_pct >= 85 or (storage_pct >= 75 and imbalance > 0.3):
        return RiskLevel.HIGH
    if storage_pct >= 75:
        return RiskLevel.ADVISORY
    if storage_pct >= 60 and imbalance > 0.2:
        return RiskLevel.WATCH
    return RiskLevel.NORMAL


def forecast_river_level(
    current_level_m: float,
    rise_rate_m_per_hr: float,
    horizons_hr: tuple[float, ...] = (1, 3, 6, 12),
) -> list[ForecastPoint]:
    points = []
    for h in horizons_hr:
        projected = current_level_m + rise_rate_m_per_hr * h
        confidence = max(35.0, 92.0 - h * 5.5)
        points.append(ForecastPoint(horizon_hours=h, level_m=round(projected, 2), confidence_pct=round(confidence, 1)))
    return points


def danger_crossing_hours(current_level_m: float, danger_level_m: float, rise_rate_m_per_hr: float) -> float | None:
    if rise_rate_m_per_hr <= 0.01 or current_level_m >= danger_level_m:
        return None
    return round((danger_level_m - current_level_m) / rise_rate_m_per_hr, 2)
