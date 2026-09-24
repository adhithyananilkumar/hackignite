from fastapi import APIRouter, HTTPException

from models import RiverForecast
from services.risk_engine import danger_crossing_hours, forecast_river_level
from services.simulator import simulator

router = APIRouter(prefix="/forecast", tags=["forecast"])


@router.get("/rivers/{river_id}", response_model=RiverForecast)
def get_river_forecast(river_id: str):
    reading = simulator.get_river(river_id)
    if reading is None:
        raise HTTPException(status_code=404, detail="Unknown river")
    points = forecast_river_level(reading.level_m, reading.rise_rate_m_per_hr)
    crossing = danger_crossing_hours(reading.level_m, reading.danger_level_m, reading.rise_rate_m_per_hr)
    return RiverForecast(river_id=river_id, points=points, danger_crossing_hours=crossing)
