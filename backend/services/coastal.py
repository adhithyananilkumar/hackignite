"""Arabian Sea water level at Kerala's river mouths, and how it constrains drainage.

Sea level comes from the Copernicus Marine Service global ocean model (via
Open-Meteo's Marine API): hourly sea surface height relative to mean sea level,
tides and wind/pressure surge included, with satellite altimetry assimilated.

When high water at a river mouth coincides with high river flow, the river
backs up into its lower reaches and backwaters (Vembanad, Kuttanad) instead of
emptying into the sea — the backwater effect reported during August 2018. Each
outlet is scored for that, and its low-tide windows are exposed so reservoir
releases can be timed to drain.

Thresholds are local: percentiles of one year of the same model at each outlet.
"""

import asyncio
import json
import time
from datetime import UTC, date, datetime, timedelta

import httpx
import numpy as np

from models import RiskLevel
from services.glofas import CACHE_DIR, get_json
from services.sources.base import DATA_DIR
from services.sources.hub import hub

MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"
SOURCE_LABEL = "Copernicus Marine global ocean model (tide + surge, altimetry-assimilating), via Open-Meteo"
CLIMATOLOGY_CACHE = CACHE_DIR / "sea_level_climatology.json"
CLIMATOLOGY_DAYS = 365
TTL_S = 1800
PAST_HOURS = 24
AHEAD_HOURS = 72
TIDE_AVERAGE_HOURS = 25  # averages out the semi-diurnal tide, leaving set-up/surge
RISK_ORDER = [RiskLevel.NORMAL, RiskLevel.WATCH, RiskLevel.ADVISORY, RiskLevel.HIGH, RiskLevel.CRITICAL]


def _load_outlets() -> list[dict]:
    return json.loads((DATA_DIR / "coastal_outlets.json").read_text(encoding="utf-8"))["outlets"]


def _rivers_by_outlet() -> dict[str, list[dict]]:
    catalog = json.loads((DATA_DIR / "river_catalog.json").read_text(encoding="utf-8"))["rivers"]
    out: dict[str, list[dict]] = {}
    for r in catalog:
        if r.get("outlet"):
            out.setdefault(r["outlet"], []).append({"id": r["id"], "name": r["name"]})
    return out


def _windows(times: list[datetime], values: np.ndarray, mask: np.ndarray, extreme: str = "max") -> list[dict]:
    """Contiguous runs of `mask`, as {start, end, extreme_m} (highest or lowest level in the run)."""
    runs, start = [], None
    for i, flag in enumerate(mask):
        if flag and start is None:
            start = i
        if start is not None and (not flag or i == len(mask) - 1):
            end = i if flag else i - 1
            seg = values[start:end + 1]
            runs.append({
                "start": times[start].isoformat(),
                "end": (times[end] + timedelta(hours=1)).isoformat(),
                "extreme_m": round(float(seg.max() if extreme == "max" else seg.min()), 2),
            })
            start = None
    return runs


def _turning_points(times: list[datetime], values: np.ndarray, kind: str, limit: int = 3) -> list[dict]:
    points = []
    for i in range(1, len(values) - 1):
        is_turn = values[i] >= values[i - 1] and values[i] > values[i + 1] if kind == "high" else \
            values[i] <= values[i - 1] and values[i] < values[i + 1]
        if is_turn:
            points.append({"time": times[i].isoformat(), "level_m": round(float(values[i]), 2)})
        if len(points) == limit:
            break
    return points


class CoastalService:
    def __init__(self) -> None:
        self.outlets = _load_outlets()
        self._climatology: dict[str, dict] = (
            json.loads(CLIMATOLOGY_CACHE.read_text(encoding="utf-8")) if CLIMATOLOGY_CACHE.exists() else {}
        )
        self._series: tuple[float, list[datetime], dict[str, np.ndarray]] | None = None
        self._lock = asyncio.Lock()

    def _params(self) -> dict:
        return {
            "latitude": ",".join(str(o["coordinates"][1]) for o in self.outlets),
            "longitude": ",".join(str(o["coordinates"][0]) for o in self.outlets),
            "hourly": "sea_level_height_msl",
            "timezone": "UTC",
        }

    async def _ensure_data(self) -> None:
        if self._series and time.time() - self._series[0] < TTL_S and len(self._climatology) == len(self.outlets):
            return
        async with self._lock:
            if self._series and time.time() - self._series[0] < TTL_S and len(self._climatology) == len(self.outlets):
                return
            async with httpx.AsyncClient(timeout=60.0) as client:
                if len(self._climatology) != len(self.outlets):
                    end = date.today() - timedelta(days=7)
                    start = end - timedelta(days=CLIMATOLOGY_DAYS)
                    hist = await get_json(client, MARINE_URL, {
                        **self._params(), "start_date": start.isoformat(), "end_date": end.isoformat(),
                    })
                    hist = hist if isinstance(hist, list) else [hist]
                    for outlet, doc in zip(self.outlets, hist):
                        v = np.array([x for x in doc["hourly"]["sea_level_height_msl"] if x is not None])
                        self._climatology[outlet["id"]] = {
                            "mean": round(float(v.mean()), 3),
                            "p50": round(float(np.percentile(v, 50)), 3),
                            "p90": round(float(np.percentile(v, 90)), 3),
                            "p98": round(float(np.percentile(v, 98)), 3),
                            "max": round(float(v.max()), 3),
                            "period": f"{start.isoformat()}..{end.isoformat()}",
                        }
                    CACHE_DIR.mkdir(exist_ok=True)
                    CLIMATOLOGY_CACHE.write_text(json.dumps(self._climatology, indent=1), encoding="utf-8")

                docs = await get_json(client, MARINE_URL, {**self._params(), "past_days": 2, "forecast_days": 4})
            docs = docs if isinstance(docs, list) else [docs]
            times = [datetime.fromisoformat(t).replace(tzinfo=UTC) for t in docs[0]["hourly"]["time"]]
            series = {
                o["id"]: np.array([np.nan if x is None else x for x in d["hourly"]["sea_level_height_msl"]], dtype=float)
                for o, d in zip(self.outlets, docs)
            }
            self._series = (time.time(), times, series)

    async def snapshot(self) -> dict:
        await self._ensure_data()
        _, all_times, all_series = self._series
        now = datetime.now(UTC).replace(minute=0, second=0, microsecond=0)
        i_now = min(range(len(all_times)), key=lambda i: abs((all_times[i] - now).total_seconds()))
        lo, hi = max(0, i_now - PAST_HOURS), min(len(all_times), i_now + AHEAD_HOURS + 1)
        times = all_times[lo:hi]
        offsets = np.array([hub.active.sea_level_offset_m((t - now).total_seconds() / 3600) for t in times])
        rivers_by_outlet = _rivers_by_outlet()
        river_readings = {r.river_id: r for r in hub.list_rivers()}

        outlets = []
        for outlet in self.outlets:
            clim = self._climatology[outlet["id"]]
            raw = all_series[outlet["id"]]
            level = raw[lo:hi] + offsets
            k = i_now - lo
            ahead_t, ahead_v = times[k:], level[k:]
            tide_avg = np.nanmean(raw[max(0, i_now - TIDE_AVERAGE_HOURS + 1):i_now + 1]) + offsets[k]
            anomaly = float(tide_avg - clim["mean"])
            high_windows = _windows(ahead_t, ahead_v, ahead_v >= clim["p90"])
            next24_high = any(
                datetime.fromisoformat(w["start"]) < now + timedelta(hours=24) for w in high_windows
            )

            served = rivers_by_outlet.get(outlet["id"], [])
            worst = max(
                (river_readings[r["id"]].risk for r in served if r["id"] in river_readings),
                key=RISK_ORDER.index,
                default=RiskLevel.NORMAL,
            )
            if next24_high and RISK_ORDER.index(worst) >= RISK_ORDER.index(RiskLevel.ADVISORY):
                drainage = "BACKWATER_RISK"
            elif next24_high or anomaly > 0.15:
                drainage = "TIDAL_CONSTRAINT"
            else:
                drainage = "FREE_DRAINING"

            now_level = float(level[k])
            outlets.append({
                "id": outlet["id"],
                "name": outlet["name"],
                "coordinates": outlet["coordinates"],
                "level_m": round(now_level, 2),
                "trend": "rising" if level[min(k + 1, len(level) - 1)] > now_level else "falling",
                "tide_filtered_anomaly_m": round(anomaly, 2),
                "status": "HIGH" if now_level >= clim["p98"] or anomaly > 0.25 else
                          "ELEVATED" if now_level >= clim["p90"] or anomaly > 0.1 else "NORMAL",
                "drainage": drainage,
                "rivers": [{**r, "risk": river_readings[r["id"]].risk.value if r["id"] in river_readings else None} for r in served],
                "thresholds": {k2: clim[k2] for k2 in ("p50", "p90", "p98", "max")},
                "next_highs": _turning_points(ahead_t, ahead_v, "high"),
                "next_lows": _turning_points(ahead_t, ahead_v, "low"),
                "high_water_windows": high_windows[:4],
                "low_tide_windows": _windows(ahead_t, ahead_v, ahead_v <= clim["p50"], extreme="min")[:6],
                "series": [
                    {"time": t.isoformat(), "level_m": None if np.isnan(v) else round(float(v), 3)}
                    for t, v in zip(times, level)
                ],
            })

        simulated = bool(offsets.any())
        return {
            "source": SOURCE_LABEL,
            "generated_at": datetime.now(UTC).isoformat(),
            "now": now.isoformat(),
            "simulated_surge_m": round(float(offsets[PAST_HOURS if len(offsets) > PAST_HOURS else 0]), 2) if simulated else 0.0,
            "outlets": outlets,
        }

    async def outlet(self, outlet_id: str) -> dict | None:
        snap = await self.snapshot()
        return next((o for o in snap["outlets"] if o["id"] == outlet_id), None)


coastal = CoastalService()
