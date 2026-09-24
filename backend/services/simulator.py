"""Scenario simulator: the one 'live' state machine driving the demo.

Only the featured basins (Periyar/Idukki, Pamba, Bharathapuzha) escalate over
time (NORMAL -> WATCH -> ADVISORY -> HIGH -> CRITICAL); every other river/dam on
the map holds a plausible static baseline. This is simulated data and is labelled
as such via /health — it stands in for real AWS/CWC/KSEB telemetry.
"""

import asyncio
import json
import math
import random
import time
from datetime import UTC, datetime
from pathlib import Path

from models import DamReading, RiverReading
from services.risk_engine import compute_dam_risk, compute_river_risk

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DEMO_DURATION_S = 180.0
TICK_SECONDS = 4.0

FEATURED_RIVER_CONFIG = {
    "periyar": {"baseline": 2.8, "warning": 4.2, "danger": 5.0, "rise_span": 2.9, "max_rise_rate": 0.32},
    "pamba": {"baseline": 2.4, "warning": 4.0, "danger": 4.8, "rise_span": 2.6, "max_rise_rate": 0.28},
    "bharathapuzha": {"baseline": 2.0, "warning": 3.5, "danger": 4.2, "rise_span": 2.3, "max_rise_rate": 0.24},
}

FEATURED_DAM_CONFIG = {
    "idukki": {"baseline_storage": 55.0, "storage_span": 42.0, "base_inflow": 380.0, "inflow_span": 1400.0, "base_outflow": 360.0},
}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _load_geojson(name: str) -> list[dict]:
    with open(DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)["features"]


class Simulator:
    def __init__(self) -> None:
        self.started_at = time.time()
        self._rivers: dict[str, RiverReading] = {}
        self._dams: dict[str, DamReading] = {}
        self._subscribers: list[asyncio.Queue] = []
        self._init_baselines()

    def _init_baselines(self) -> None:
        for feature in _load_geojson("kerala_rivers.geojson"):
            props = feature["properties"]
            river_id = props["id"]
            cfg = FEATURED_RIVER_CONFIG.get(river_id, {"baseline": 1.2, "warning": 3.0, "danger": 3.8, "rise_span": 0.0})
            self._rivers[river_id] = RiverReading(
                river_id=river_id,
                level_m=cfg["baseline"],
                danger_level_m=cfg["danger"],
                warning_level_m=cfg["warning"],
                rise_rate_m_per_hr=0.0,
                risk=compute_river_risk(cfg["baseline"], cfg["danger"], cfg["warning"], 0.0),
                updated_at=_now_iso(),
            )

        for feature in _load_geojson("kerala_dams.geojson"):
            props = feature["properties"]
            dam_id = props["id"]
            cfg = FEATURED_DAM_CONFIG.get(dam_id, {"baseline_storage": 48.0, "storage_span": 0.0, "base_inflow": 120.0, "inflow_span": 0.0, "base_outflow": 118.0})
            self._dams[dam_id] = DamReading(
                dam_id=dam_id,
                storage_pct=cfg["baseline_storage"],
                inflow_m3s=cfg["base_inflow"],
                outflow_m3s=cfg["base_outflow"],
                rule_level_status="NORMAL",
                risk=compute_dam_risk(cfg["baseline_storage"], cfg["base_inflow"], cfg["base_outflow"]),
                updated_at=_now_iso(),
            )

    def _progress(self) -> float:
        elapsed = time.time() - self.started_at
        return min(1.0, elapsed / DEMO_DURATION_S)

    def _tick_rivers(self, progress: float) -> None:
        for river_id, cfg in FEATURED_RIVER_CONFIG.items():
            noise = random.uniform(-0.03, 0.05)
            new_level = round(cfg["baseline"] + cfg["rise_span"] * progress + noise, 2)
            # Displayed rise rate is a physically-plausible m/hr figure driven by demo
            # progress, not derived from wall-clock ticks (the demo compresses a
            # multi-hour escalation into a few minutes for the sake of showmanship).
            rise_rate = round(max(0.01, cfg["max_rise_rate"] * progress), 3)
            self._rivers[river_id] = RiverReading(
                river_id=river_id,
                level_m=new_level,
                danger_level_m=cfg["danger"],
                warning_level_m=cfg["warning"],
                rise_rate_m_per_hr=rise_rate,
                risk=compute_river_risk(new_level, cfg["danger"], cfg["warning"], rise_rate),
                updated_at=_now_iso(),
            )

    def _tick_dams(self, progress: float) -> None:
        for dam_id, cfg in FEATURED_DAM_CONFIG.items():
            storage = round(min(99.0, cfg["baseline_storage"] + cfg["storage_span"] * progress), 1)
            inflow = round(cfg["base_inflow"] + cfg["inflow_span"] * progress + random.uniform(-20, 20), 1)
            outflow = round(cfg["base_outflow"] + cfg["inflow_span"] * progress * 0.55, 1)
            risk = compute_dam_risk(storage, inflow, outflow)
            status = "APPROACHING" if risk.value in ("HIGH", "CRITICAL") else "NORMAL"
            self._dams[dam_id] = DamReading(
                dam_id=dam_id,
                storage_pct=storage,
                inflow_m3s=inflow,
                outflow_m3s=outflow,
                rule_level_status=status,
                risk=risk,
                updated_at=_now_iso(),
            )

    def snapshot(self) -> dict:
        return {
            "rivers": {k: v.model_dump(mode="json") for k, v in self._rivers.items()},
            "dams": {k: v.model_dump(mode="json") for k, v in self._dams.items()},
            "progress": round(self._progress(), 3),
        }

    def get_river(self, river_id: str) -> RiverReading | None:
        return self._rivers.get(river_id)

    def get_dam(self, dam_id: str) -> DamReading | None:
        return self._dams.get(dam_id)

    def list_rivers(self) -> list[RiverReading]:
        return list(self._rivers.values())

    def list_dams(self) -> list[DamReading]:
        return list(self._dams.values())

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    async def _broadcast(self) -> None:
        snap = self.snapshot()
        for queue in list(self._subscribers):
            if queue.full():
                continue
            queue.put_nowait(snap)

    async def run(self) -> None:
        while True:
            progress = self._progress()
            self._tick_rivers(progress)
            self._tick_dams(progress)
            await self._broadcast()
            await asyncio.sleep(TICK_SECONDS)


simulator = Simulator()
