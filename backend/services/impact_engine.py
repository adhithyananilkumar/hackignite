"""Exposure inside the forecast flood extent: people and critical assets that fall
on flooded cells. Modelled potential exposure, not confirmed damage."""

from models import ImpactSummary
from services.flood_forecast import FLOOD_HORIZONS_HR, impact_at

DEFAULT_HORIZON_HR = FLOOD_HORIZONS_HR[-1]


def compute_impact(basin_id: str, horizon_hours: float = DEFAULT_HORIZON_HR) -> ImpactSummary | None:
    return impact_at(basin_id, horizon_hours)
