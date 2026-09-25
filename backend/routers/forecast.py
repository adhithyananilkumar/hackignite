from fastapi import APIRouter, HTTPException

from models import RiverForecast
from services.sources.hub import hub

router = APIRouter(prefix="/forecast", tags=["forecast"])

RIVER_FORECAST_HORIZONS_HR = (1.0, 3.0, 6.0, 12.0)


@router.get("/rivers/{river_id}", response_model=RiverForecast)
def get_river_forecast(river_id: str):
    reading = hub.get_river(river_id)
    if reading is None:
        raise HTTPException(status_code=404, detail="Unknown river")
    return RiverForecast(
        river_id=river_id,
        points=hub.level_forecast(reading, RIVER_FORECAST_HORIZONS_HR),
        danger_crossing_hours=hub.danger_crossing_hours(reading),
    )
