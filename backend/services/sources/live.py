"""Live provider: real, key-free feeds.

- River discharge: Copernicus GloFAS (via Open-Meteo Flood API), daily, with a
  ~7-day forecast, sampled at each gauge in data/gauges.json.
- Rainfall: Open-Meteo forecast API (ECMWF/GFS blend), hourly, at each gauge.

GloFAS gives discharge, not stage. Each gauge is calibrated from 1984–2023 GloFAS
history: the 2-year and 5-year return-period flows (median and 80th percentile
of annual maxima — the thresholds GloFAS itself alerts on) are anchored to the
gauge's warning and danger levels through a power-law rating curve
level = danger · (Q / Q5)^b. The result is an indicative stage, labelled as such.

Institutional feeds (ISRO MOSDAC satellite rainfall, CWC gauges, KSEB reservoir
telemetry) need accounts/agreements; they appear as NOT CONNECTED slots in data
health until a connector is added alongside these.
"""

import asyncio
import json
import math
import os
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import numpy as np

from models import DamReading, RiskLevel, RiverReading
from services.glofas import CALIBRATION_CACHE as CACHE_PATH
from services.glofas import GLOFAS_URL
from services.glofas import get_json as _get_json
from services.risk_engine import compute_dam_risk, compute_river_risk
from services.sources.base import Gauge, StateProvider, load_dam_defaults, load_dam_ids, now_iso

WEATHER_URL = "https://api.open-meteo.com/v1/forecast"
HISTORY_RANGE = ("1984-01-01", "2023-12-31")
REFRESH_S = 900  # GloFAS is daily and Open-Meteo hourly; 15 min is plenty
RETRY_AFTER_ERROR_S = 60
SNAP_YEAR = ("2023-01-01", "2023-12-31")
EXPONENT_RANGE = (0.2, 1.0)
MAX_CONCURRENT_GAUGES = 2  # stay well inside Open-Meteo's fair-use limits


@dataclass
class Calibration:
    lat: float  # GloFAS cell actually sampled (snapped to the main channel)
    lon: float
    q2: float
    q5: float
    exponent: float


# GloFAS is a ~0.05° grid; a gauge coordinate can land on a tributary cell. Search
# the surrounding cells and keep the one carrying the most water.
SNAP_OFFSETS_DEG = (-0.05, 0.0, 0.05)


def _calibrate(lat: float, lon: float, times: list[str], discharge: list[float | None], gauge: Gauge) -> Calibration:
    by_year: dict[str, list[float]] = {}
    for day, q in zip(times, discharge):
        if q is not None:
            by_year.setdefault(day[:4], []).append(q)
    annual_max = np.array([max(v) for v in by_year.values() if v])
    q2, q5 = float(np.median(annual_max)), float(np.percentile(annual_max, 80))
    if q5 <= q2 or q2 <= 0:
        exponent = 0.5
    else:
        exponent = math.log(gauge.warning_m / gauge.danger_m) / math.log(q2 / q5)
    return Calibration(lat=lat, lon=lon, q2=q2, q5=q5, exponent=min(max(exponent, EXPONENT_RANGE[0]), EXPONENT_RANGE[1]))


class LiveProvider(StateProvider):
    id = "live"
    label = "Live"
    kind = "live"
    description = "Copernicus GloFAS river discharge + Open-Meteo rainfall, fetched live."

    def __init__(self, gauges: dict[str, Gauge]):
        self.gauges = gauges
        self.dam_ids = load_dam_ids()
        self.dam_defaults = load_dam_defaults()
        self._calibration: dict[str, Calibration] = self._load_calibration()
        self._discharge: dict[str, tuple[np.ndarray, np.ndarray]] = {}  # epoch seconds, m³/s
        self._rain: dict[str, tuple[float, float]] = {}  # past 24 h, next 24 h (mm)
        self._errors: dict[str, str] = {}
        self._last_refresh: float = 0.0
        self._last_success: str | None = None
        self._task: asyncio.Task | None = None
        self._rivers: dict[str, RiverReading] = {}

    # ---- calibration cache ----

    def _load_calibration(self) -> dict[str, Calibration]:
        if not CACHE_PATH.exists():
            return {}
        raw = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        fields = set(Calibration.__dataclass_fields__)
        return {rid: Calibration(**c) for rid, c in raw.items() if rid in self.gauges and set(c) == fields}

    def _save_calibration(self) -> None:
        CACHE_PATH.parent.mkdir(exist_ok=True)
        CACHE_PATH.write_text(json.dumps({rid: asdict(c) for rid, c in self._calibration.items()}, indent=2))

    # ---- fetching ----

    async def activate(self) -> None:
        self._schedule_refresh(force=not self._discharge)

    async def tick(self) -> None:
        self._schedule_refresh()
        self._compute()

    def _schedule_refresh(self, force: bool = False) -> None:
        stale = time.time() - self._last_refresh > REFRESH_S
        if (force or stale) and (self._task is None or self._task.done()):
            self._last_refresh = time.time()
            self._task = asyncio.create_task(self._refresh())

    async def _refresh(self) -> None:
        limit = asyncio.Semaphore(MAX_CONCURRENT_GAUGES)

        async def bounded(client: httpx.AsyncClient, gauge: Gauge) -> None:
            async with limit:
                await self._refresh_gauge(client, gauge)

        async with httpx.AsyncClient(timeout=60.0) as client:
            await asyncio.gather(*(bounded(client, g) for g in self.gauges.values()))
        if any(rid in self._discharge for rid in self.gauges):
            self._last_success = now_iso()
        if self._errors:
            # Partial failure (rate limit, network): try again soon rather than in 15 min.
            self._last_refresh = time.time() - REFRESH_S + RETRY_AFTER_ERROR_S
        self._compute()

    async def _refresh_gauge(self, client: httpx.AsyncClient, gauge: Gauge) -> None:
        try:
            if gauge.river_id not in self._calibration:
                # Snap with one recent year (cheap), then pull full history for that cell only.
                candidates = [(gauge.lat + dy, gauge.lon + dx) for dy in SNAP_OFFSETS_DEG for dx in SNAP_OFFSETS_DEG]
                cells = await _get_json(client, GLOFAS_URL, {
                    "latitude": ",".join(f"{lat:.4f}" for lat, _ in candidates),
                    "longitude": ",".join(f"{lon:.4f}" for _, lon in candidates),
                    "daily": "river_discharge", "start_date": SNAP_YEAR[0], "end_date": SNAP_YEAR[1],
                })
                cells = cells if isinstance(cells, list) else [cells]

                def median_flow(cell: dict) -> float:
                    values = [q for q in cell["daily"]["river_discharge"] if q is not None]
                    return float(np.median(values)) if values else -1.0

                best = max(cells, key=median_flow)
                history = (await _get_json(client, GLOFAS_URL, {
                    "latitude": best["latitude"], "longitude": best["longitude"],
                    "daily": "river_discharge", "start_date": HISTORY_RANGE[0], "end_date": HISTORY_RANGE[1],
                }))["daily"]
                self._calibration[gauge.river_id] = _calibrate(
                    best["latitude"], best["longitude"], history["time"], history["river_discharge"], gauge
                )
                self._save_calibration()

            cal = self._calibration[gauge.river_id]
            daily = (await _get_json(client, GLOFAS_URL, {
                "latitude": cal.lat, "longitude": cal.lon, "daily": "river_discharge", "past_days": 3, "forecast_days": 7,
            }))["daily"]
            pairs = [(t, q) for t, q in zip(daily["time"], daily["river_discharge"]) if q is not None]
            # Daily means are placed at midday UTC for interpolation.
            epochs = np.array([datetime.fromisoformat(t).replace(tzinfo=UTC, hour=12).timestamp() for t, _ in pairs])
            self._discharge[gauge.river_id] = (epochs, np.array([q for _, q in pairs], dtype=float))
            self._errors.pop(f"glofas:{gauge.river_id}", None)
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            self._errors[f"glofas:{gauge.river_id}"] = str(exc) or type(exc).__name__

        try:
            hourly = (await _get_json(client, WEATHER_URL, {
                "latitude": gauge.lat, "longitude": gauge.lon, "hourly": "precipitation", "past_days": 1, "forecast_days": 2, "timezone": "UTC",
            }))["hourly"]
            now = datetime.now(UTC)
            past = nxt = 0.0
            for t, p in zip(hourly["time"], hourly["precipitation"]):
                if p is None:
                    continue
                ts = datetime.fromisoformat(t).replace(tzinfo=UTC)
                if now - timedelta(hours=24) <= ts < now:
                    past += p
                elif now <= ts < now + timedelta(hours=24):
                    nxt += p
            self._rain[gauge.river_id] = (round(past, 1), round(nxt, 1))
            self._errors.pop(f"rain:{gauge.river_id}", None)
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            self._errors[f"rain:{gauge.river_id}"] = str(exc) or type(exc).__name__

    # ---- discharge → stage ----

    def _discharge_at(self, river_id: str, epoch: float) -> float | None:
        series = self._discharge.get(river_id)
        if series is None or len(series[0]) == 0:
            return None
        return float(np.interp(epoch, series[0], series[1]))

    def _stage(self, river_id: str, discharge: float) -> float:
        gauge, cal = self.gauges[river_id], self._calibration[river_id]
        return gauge.danger_m * (max(discharge, 0.0) / cal.q5) ** cal.exponent

    def level_forecast(self, river_id: str, hours_ahead: float) -> float | None:
        if river_id not in self._calibration:
            return None
        q = self._discharge_at(river_id, time.time() + hours_ahead * 3600)
        return None if q is None else round(self._stage(river_id, q), 2)

    def forecast_confidence(self, hours_ahead: float) -> float:
        # GloFAS is an ensemble-driven daily product: skill decays over days, not hours.
        return max(40.0, 85.0 - hours_ahead * 1.2)

    def _compute(self) -> None:
        now = time.time()
        for rid, gauge in self.gauges.items():
            q = self._discharge_at(rid, now)
            rain = self._rain.get(rid, (None, None))
            if q is None or rid not in self._calibration:
                self._rivers[rid] = RiverReading(
                    river_id=rid, level_m=gauge.normal_m, danger_level_m=gauge.danger_m, warning_level_m=gauge.warning_m,
                    rise_rate_m_per_hr=0.0, risk=RiskLevel.NORMAL,
                    updated_at=now_iso(), source="live:pending",
                    rain_past_24h_mm=rain[0], rain_next_24h_mm=rain[1],
                )
                continue
            level = self._stage(rid, q)
            ahead = self._discharge_at(rid, now + 3 * 3600) or q
            behind = self._discharge_at(rid, now - 3 * 3600) or q
            rise = (self._stage(rid, ahead) - self._stage(rid, behind)) / 6
            self._rivers[rid] = RiverReading(
                river_id=rid,
                level_m=round(level, 2),
                danger_level_m=gauge.danger_m,
                warning_level_m=gauge.warning_m,
                rise_rate_m_per_hr=round(rise, 3),
                risk=compute_river_risk(level, gauge.danger_m, gauge.warning_m, rise),
                updated_at=self._last_success or now_iso(),
                source="live:glofas",
                discharge_m3s=round(q, 1),
                rain_past_24h_mm=rain[0],
                rain_next_24h_mm=rain[1],
            )

    # ---- reads ----

    def rivers(self) -> dict[str, RiverReading]:
        if not self._rivers:
            self._compute()
        return self._rivers

    def dams(self) -> dict[str, DamReading]:
        # No public reservoir telemetry: hold a static baseline, explicitly flagged.
        d = self.dam_defaults
        return {
            dam_id: DamReading(
                dam_id=dam_id, storage_pct=d["storage_pct"], inflow_m3s=d["inflow_m3s"], outflow_m3s=d["outflow_m3s"],
                rule_level_status="NO LIVE FEED",
                risk=compute_dam_risk(d["storage_pct"], d["inflow_m3s"], d["outflow_m3s"]),
                updated_at=now_iso(), source="static",
            )
            for dam_id in self.dam_ids
        }

    def _state(self) -> str:
        loaded = sum(1 for rid in self.gauges if rid in self._discharge)
        if loaded == 0:
            return "loading" if self._task is not None and not self._task.done() else "unavailable"
        return "ok" if loaded == len(self.gauges) and not self._errors else "degraded"

    def status(self) -> dict:
        return {
            "state": self._state(),
            "last_updated": self._last_success,
            "gauges_live": sum(1 for rid in self.gauges if rid in self._discharge),
            "gauges_total": len(self.gauges),
            "errors": len(self._errors),
        }

    def health(self) -> list[dict]:
        now = now_iso()
        glofas_ok = sum(1 for rid in self.gauges if rid in self._discharge)
        rain_ok = sum(1 for rid in self.gauges if rid in self._rain)
        n = len(self.gauges)
        mosdac = bool(os.environ.get("MOSDAC_USERNAME"))
        return [
            {"name": "Copernicus GloFAS discharge", "status": "LIVE" if glofas_ok == n else ("DEGRADED" if glofas_ok else "UNAVAILABLE"),
             "detail": f"{glofas_ok}/{n} gauges · daily, 7-day forecast", "as_of": self._last_success or now},
            {"name": "Open-Meteo rainfall (ECMWF/GFS)", "status": "LIVE" if rain_ok == n else ("DEGRADED" if rain_ok else "UNAVAILABLE"),
             "detail": f"{rain_ok}/{n} gauges · hourly", "as_of": self._last_success or now},
            {"name": "ISRO MOSDAC satellite rainfall", "status": "NOT CONNECTED",
             "detail": "Credentials found; connector not yet implemented" if mosdac else "Needs MOSDAC account (MOSDAC_USERNAME/PASSWORD)", "as_of": now},
            {"name": "CWC river gauges", "status": "NOT CONNECTED", "detail": "Levels estimated from GloFAS discharge", "as_of": now},
            {"name": "KSEB reservoir telemetry", "status": "NOT CONNECTED", "detail": "Dams show a static baseline", "as_of": now},
        ]
