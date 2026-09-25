"""Copernicus GloFAS river-discharge client (via Open-Meteo's Flood API).

Shared by the live provider (gauge calibration), river/dam flow outlooks and the
reservoir advisory. GloFAS is a ~0.05° grid: a point can land on a tributary
cell, so locations are snapped to the neighbouring cell carrying the most water.
"""

import asyncio
import json
import time
from datetime import date, timedelta
from pathlib import Path

import httpx
import numpy as np

GLOFAS_URL = "https://flood-api.open-meteo.com/v1/flood"
SOURCE_LABEL = "Copernicus GloFAS (ensemble), via Open-Meteo"
CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"
CELL_CACHE = CACHE_DIR / "glofas_cells.json"
CALIBRATION_CACHE = CACHE_DIR / "glofas_calibration.json"
SNAP_OFFSETS_DEG = (-0.05, 0.0, 0.05)
SNAP_WINDOW_DAYS = 120
FORECAST_TTL_S = 1800
MAX_ATTEMPTS = 4
ENSEMBLE_FIELDS = ("river_discharge", "river_discharge_median", "river_discharge_min", "river_discharge_max",
                   "river_discharge_p25", "river_discharge_p75")


async def get_json(client: httpx.AsyncClient, url: str, params: dict):
    """GET with backoff on 429/5xx, honouring Retry-After."""
    for attempt in range(MAX_ATTEMPTS):
        resp = await client.get(url, params=params)
        if resp.status_code != 429 and resp.status_code < 500:
            resp.raise_for_status()
            return resp.json()
        if attempt == MAX_ATTEMPTS - 1:
            resp.raise_for_status()
        retry_after = resp.headers.get("Retry-After", "")
        await asyncio.sleep(float(retry_after) if retry_after.isdigit() else 2.0 * 2**attempt)


def load_calibrations() -> dict[str, dict]:
    """Gauge rating calibrations written by the live provider (q2, q5, exponent, cell)."""
    if not CALIBRATION_CACHE.exists():
        return {}
    return json.loads(CALIBRATION_CACHE.read_text(encoding="utf-8"))


def discharge_for_level(calibration: dict, danger_m: float, level_m: float) -> float:
    """Inverse of the live provider's rating curve level = danger · (Q/Q5)^b."""
    return calibration["q5"] * (max(level_m, 0.0) / danger_m) ** (1 / calibration["exponent"])


class GlofasClient:
    def __init__(self) -> None:
        self._cells: dict[str, list[float]] = (
            json.loads(CELL_CACHE.read_text(encoding="utf-8")) if CELL_CACHE.exists() else {}
        )
        self._forecasts: dict[str, tuple[float, dict]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock(self, key: str) -> asyncio.Lock:
        return self._locks.setdefault(key, asyncio.Lock())

    async def snap(self, client: httpx.AsyncClient, key: str, lon: float, lat: float) -> tuple[float, float]:
        """Cell (lon, lat) with the highest recent median flow around a point; cached per key."""
        if key in self._cells:
            return tuple(self._cells[key])
        end = date.today() - timedelta(days=1)
        start = end - timedelta(days=SNAP_WINDOW_DAYS)
        candidates = [(lat + dy, lon + dx) for dy in SNAP_OFFSETS_DEG for dx in SNAP_OFFSETS_DEG]
        cells = await get_json(client, GLOFAS_URL, {
            "latitude": ",".join(f"{a:.4f}" for a, _ in candidates),
            "longitude": ",".join(f"{b:.4f}" for _, b in candidates),
            "daily": "river_discharge", "start_date": start.isoformat(), "end_date": end.isoformat(),
        })
        cells = cells if isinstance(cells, list) else [cells]

        def median_flow(cell: dict) -> float:
            values = [q for q in cell["daily"]["river_discharge"] if q is not None]
            return float(np.median(values)) if values else -1.0

        best = max(cells, key=median_flow)
        self._cells[key] = [best["longitude"], best["latitude"]]
        CACHE_DIR.mkdir(exist_ok=True)
        CELL_CACHE.write_text(json.dumps(self._cells, indent=1), encoding="utf-8")
        return tuple(self._cells[key])

    async def outlook(self, key: str, lon: float, lat: float, cell: tuple[float, float] | None = None, days: int = 7) -> dict:
        """Daily ensemble discharge outlook (median, interquartile, min–max) for the next `days`."""
        cached = self._forecasts.get(key)
        if cached and time.time() - cached[0] < FORECAST_TTL_S:
            return cached[1]
        async with self._lock(key):
            cached = self._forecasts.get(key)
            if cached and time.time() - cached[0] < FORECAST_TTL_S:
                return cached[1]
            async with httpx.AsyncClient(timeout=60.0) as client:
                c_lon, c_lat = cell or await self.snap(client, key, lon, lat)
                daily = (await get_json(client, GLOFAS_URL, {
                    "latitude": c_lat, "longitude": c_lon, "daily": ",".join(ENSEMBLE_FIELDS),
                    "past_days": 2, "forecast_days": days,
                }))["daily"]
            result = {
                "source": SOURCE_LABEL,
                "cell": [c_lon, c_lat],
                "unit": "m³/s",
                "days": [
                    {
                        "date": t,
                        "forecast": daily["river_discharge"][i],
                        "median": daily["river_discharge_median"][i],
                        "p25": daily["river_discharge_p25"][i],
                        "p75": daily["river_discharge_p75"][i],
                        "min": daily["river_discharge_min"][i],
                        "max": daily["river_discharge_max"][i],
                    }
                    for i, t in enumerate(daily["time"])
                ],
            }
            self._forecasts[key] = (time.time(), result)
            return result


glofas = GlofasClient()
