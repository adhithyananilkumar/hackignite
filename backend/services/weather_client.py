"""Thin client for Open-Meteo's free, key-free forecast API — the one genuinely
live input in the system; everything else is the scenario simulator."""

import time

import httpx

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL_S = 300


async def get_rainfall_forecast(lat: float, lon: float) -> dict:
    cache_key = f"{lat:.3f},{lon:.3f}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL_S:
        return cached[1]

    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation",
        "forecast_days": 2,
        "timezone": "Asia/Kolkata",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, ValueError):
        return {"source": "unavailable", "hourly_precipitation_mm": []}

    hourly = data.get("hourly", {})
    result = {
        "source": "open-meteo",
        "hourly_precipitation_mm": hourly.get("precipitation", [])[:24],
        "times": hourly.get("time", [])[:24],
    }
    _cache[cache_key] = (time.time(), result)
    return result
