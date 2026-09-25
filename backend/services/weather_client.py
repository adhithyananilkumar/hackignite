"""Thin client for Open-Meteo's free, key-free forecast API — the one genuinely
live input in the system; everything else is the scenario simulator."""

import time
from datetime import datetime, timedelta, timezone

import httpx

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"

_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL_S = 300
IST = timezone(timedelta(hours=5, minutes=30))


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


# IMD 24-hour rainfall categories (mm), used to label point forecasts.
IMD_RAIN_CATEGORIES = (
    (204.5, "extremely heavy"),
    (115.6, "very heavy"),
    (64.5, "heavy"),
    (15.6, "moderate"),
    (2.5, "light"),
    (0.0, "none or very light"),
)


def imd_category(mm_24h: float) -> str:
    return next(label for threshold, label in IMD_RAIN_CATEGORIES if mm_24h >= threshold)


async def get_point_rain_outlook(lat: float, lon: float) -> dict:
    """Rain totals and chance of rain for the next 24h and 72h at one point."""
    cache_key = f"outlook:{lat:.2f},{lon:.2f}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL_S:
        return cached[1]

    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": "precipitation,precipitation_probability",
        "forecast_days": 3,
        "timezone": "Asia/Kolkata",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(OPEN_METEO_URL, params=params)
            resp.raise_for_status()
            hourly = resp.json().get("hourly", {})
    except (httpx.HTTPError, ValueError):
        return {"available": False}

    # Hourly series start at local midnight; drop the hours already past.
    now = datetime.now(IST).strftime("%Y-%m-%dT%H:00")
    times = hourly.get("time", [])
    start = next((i for i, t in enumerate(times) if t >= now), 0)
    rain = [v or 0.0 for v in hourly.get("precipitation", [])[start:]]
    prob = [v or 0 for v in hourly.get("precipitation_probability", [])[start:]]
    next_24 = round(sum(rain[:24]), 1)
    result = {
        "available": True,
        "source": "Open-Meteo forecast",
        "next_24h_mm": next_24,
        "next_72h_mm": round(sum(rain[:72]), 1),
        "chance_of_rain_24h_pct": max(prob[:24], default=0),
        "peak_hourly_mm": round(max(rain[:24], default=0.0), 1),
        "imd_category_24h": imd_category(next_24),
    }
    _cache[cache_key] = (time.time(), result)
    return result
