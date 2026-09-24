from fastapi import APIRouter

from services.weather_client import get_rainfall_forecast

router = APIRouter(prefix="/weather", tags=["weather"])

# Representative points for the featured basins (Aluva/Periyar, Chengannur/Pamba, Shoranur/Bharathapuzha).
_BASIN_COORDS = {
    "periyar": (10.1097, 76.3517),
    "pamba": (9.3167, 76.6167),
    "bharathapuzha": (10.7667, 76.2667),
}


@router.get("/{basin_id}")
async def get_basin_weather(basin_id: str):
    lat, lon = _BASIN_COORDS.get(basin_id, (10.1097, 76.3517))
    return await get_rainfall_forecast(lat, lon)
