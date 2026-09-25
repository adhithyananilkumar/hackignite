"""Landslide (urulpottal) early warning for Western Ghats hotspots.

Two signals, combined like a two-stage warning system:
1. Rainfall trigger (live): antecedent 24 h / 72 h rain and next-24 h forecast
   from Open-Meteo, plus deep soil moisture, against indicative thresholds.
2. Ground response (sensor node): geophone micro-seismic event rate, tiltmeter
   rate and pore-water pressure. No public feed exists yet, so nodes are
   SIMULATED from the rainfall and soil state and labelled as such; a real node
   (MQTT / HTTP) replaces `_simulated_node` without changing the alert logic.

In the simulation data source, a scenario's `landslide.rain_72h_mm` adds
scripted rain on top of the live values.
"""

import asyncio
import json
import math
import random
import time
from datetime import UTC, datetime, timedelta

import httpx

from services.glofas import get_json
from services.sources.base import DATA_DIR
from services.sources.hub import hub
from services.sources.simulation import SimulationProvider, _smoothstep

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
TTL_S = 900
LEVELS = ["GREEN", "YELLOW", "ORANGE", "RED"]
MESSAGES = {
    "GREEN": "No landslide trigger.",
    "YELLOW": "Rain approaching trigger levels — watch slopes and drainage.",
    "ORANGE": "Trigger rainfall reached — alert; prepare to move people from vulnerable slopes.",
    "RED": "Trigger rainfall with ground movement detected — evacuation of vulnerable slopes should be ordered by the district authority.",
}
VIBRATION_ANOMALY_PER_H = 25
TILT_ANOMALY_DEG_PER_DAY = 0.15


def _config() -> dict:
    return json.loads((DATA_DIR / "landslide_hotspots.json").read_text(encoding="utf-8"))


def _rain_level(value: float, t: dict) -> int:
    return 3 if value >= t["warning"] else 2 if value >= t["alert"] else 1 if value >= t["watch"] else 0


def _simulated_node(hotspot_id: str, stress: float, saturation: float) -> dict:
    """Ground response rising steeply once rain stress passes ~1 (trigger level)."""
    rng = random.Random(f"{hotspot_id}-{int(time.time() // 60)}")
    s = min(max(0.0, stress), 1.6)  # response saturates; keeps readings physically plausible
    vibration = 2 + 55 * s**3 + rng.uniform(-1.5, 1.5)
    tilt = 0.01 + 0.35 * s**3 + rng.uniform(-0.005, 0.005)
    pore = 5 + 45 * min(1.0, s) * (0.5 + saturation)
    return {
        "status": "SIMULATED",
        "vibration_events_per_h": max(0, round(vibration)),
        "tilt_deg_per_day": round(max(0.0, tilt), 3),
        "pore_pressure_kpa": round(pore, 1),
        "anomaly": vibration >= VIBRATION_ANOMALY_PER_H or tilt >= TILT_ANOMALY_DEG_PER_DAY,
    }


class LandslideService:
    def __init__(self) -> None:
        self._cache: tuple[float, list[dict]] | None = None
        self._lock = asyncio.Lock()

    async def _weather(self, hotspots: list[dict]) -> list[dict]:
        if self._cache and time.time() - self._cache[0] < TTL_S:
            return self._cache[1]
        async with self._lock:
            if self._cache and time.time() - self._cache[0] < TTL_S:
                return self._cache[1]
            async with httpx.AsyncClient(timeout=30.0) as client:
                docs = await get_json(client, WEATHER_URL, {
                    "latitude": ",".join(str(h["coordinates"][1]) for h in hotspots),
                    "longitude": ",".join(str(h["coordinates"][0]) for h in hotspots),
                    "hourly": "precipitation,soil_moisture_27_to_81cm",
                    "past_days": 3, "forecast_days": 2, "timezone": "UTC",
                })
            docs = docs if isinstance(docs, list) else [docs]
            self._cache = (time.time(), docs)
            return docs

    def _scripted_rain(self) -> tuple[float, float, float]:
        """(extra 72 h, extra 24 h, extra next-24 h) rain from the active scenario."""
        provider = hub.active
        if not isinstance(provider, SimulationProvider):
            return 0.0, 0.0, 0.0
        total = provider.scenario.get("landslide", {}).get("rain_72h_mm", 0.0)
        ramp = _smoothstep(provider.progress / 0.8)
        return total * ramp, total * 0.55 * ramp, total * 0.35 * (1 - provider.progress)

    async def snapshot(self) -> dict:
        cfg = _config()
        hotspots, t = cfg["hotspots"], cfg["thresholds"]
        docs = await self._weather(hotspots)
        extra72, extra24, extra_next = self._scripted_rain()
        now = datetime.now(UTC)

        sites = []
        for h, doc in zip(hotspots, docs):
            hourly = doc["hourly"]
            times = [datetime.fromisoformat(x).replace(tzinfo=UTC) for x in hourly["time"]]
            rain = [p or 0.0 for p in hourly["precipitation"]]
            soil = [s for s, ts in zip(hourly["soil_moisture_27_to_81cm"], times) if s is not None and ts <= now]

            def total(start: datetime, end: datetime) -> float:
                return sum(r for r, ts in zip(rain, times) if start <= ts < end)

            r24 = total(now - timedelta(hours=24), now) + extra24
            r72 = total(now - timedelta(hours=72), now) + extra72
            next24 = total(now, now + timedelta(hours=24)) + extra_next
            saturation = soil[-1] if soil else 0.3

            rain_lvl = max(_rain_level(r24, t["rain_24h_mm"]), _rain_level(r72, t["rain_72h_mm"]))
            outlook_lvl = max(_rain_level(r24 + next24, t["rain_24h_mm"]), _rain_level(r72 + next24, t["rain_72h_mm"]))
            if saturation >= t["soil_saturation"]["alert"] and rain_lvl >= 1:
                rain_lvl = min(3, rain_lvl + 1)
            stress = max(r24 / t["rain_24h_mm"]["alert"], r72 / t["rain_72h_mm"]["alert"]) * (0.7 + saturation)
            node = _simulated_node(h["id"], stress, saturation)

            level = min(rain_lvl, 2)
            if node["anomaly"]:
                level = 3 if rain_lvl >= 2 else max(level, 2)
            elif rain_lvl == 3:
                level = 2
            name = LEVELS[level]
            sites.append({
                **h,
                "level": name,
                "message": MESSAGES[name],
                "outlook_level": LEVELS[max(level, min(outlook_lvl, 2))],
                "rain_24h_mm": round(r24, 1),
                "rain_72h_mm": round(r72, 1),
                "rain_next_24h_mm": round(next24, 1),
                "soil_moisture": round(saturation, 3),
                "node": node,
            })

        sites.sort(key=lambda s: -LEVELS.index(s["level"]))
        return {
            "generated_at": now.isoformat(),
            "rain_source": "Open-Meteo (ECMWF/GFS) hourly rain + soil moisture" + (" + scenario rain" if extra72 else ""),
            "sensor_source": "Simulated geophone / tiltmeter / piezometer nodes (no public telemetry)",
            "thresholds": t,
            "sites": sites,
        }


landslide = LandslideService()
