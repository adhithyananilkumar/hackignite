"""Scenario simulation provider.

Scenarios are data (data/scenarios/*.json), not code: each lists per-river
hydrographs (peak relative to that gauge's danger level, onset, time of peak,
recession rate) and per-dam storage/inflow curves. A `"*"` entry applies to
every river in the gauge registry, so new rivers are simulated without edits.

Scenario time is compressed: `duration_s` of wall-clock covers
`represents_hours` of river time. Forecasts read the same hydrograph ahead of
"now", so the timeline shows rise, peak and recession rather than a straight
line.
"""

import json
import random
import time

from models import DamReading, RiverReading
from services.risk_engine import compute_dam_risk, compute_river_risk
from services.sources.base import DATA_DIR, Gauge, StateProvider, load_dam_defaults, load_dam_ids, now_iso

SCENARIO_DIR = DATA_DIR / "scenarios"
DEFAULT_SCENARIO = "monsoon_surge"
SPEEDS = (0.5, 1.0, 2.0, 4.0)
_READING_NOISE_M = 0.03


def load_scenarios() -> dict[str, dict]:
    scenarios = {}
    for path in sorted(SCENARIO_DIR.glob("*.json")):
        scenario = json.loads(path.read_text(encoding="utf-8"))
        scenarios[scenario["id"]] = scenario
    return scenarios


def _smoothstep(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


class SimulationProvider(StateProvider):
    id = "simulation"
    label = "Simulation"
    kind = "simulation"
    description = "Scenario engine replaying scripted hydrographs; clearly labelled simulated data."

    def __init__(self, gauges: dict[str, Gauge]):
        self.gauges = gauges
        self.dam_ids = load_dam_ids()
        self.dam_defaults = load_dam_defaults()
        self.scenarios = load_scenarios()
        self.scenario_id = DEFAULT_SCENARIO if DEFAULT_SCENARIO in self.scenarios else next(iter(self.scenarios))
        self.playing = True
        self.speed = 1.0
        self._elapsed_s = 0.0
        self._last_tick = time.monotonic()
        self._rivers: dict[str, RiverReading] = {}
        self._dams: dict[str, DamReading] = {}
        self._compute()

    # ---- controls ----

    @property
    def scenario(self) -> dict:
        return self.scenarios[self.scenario_id]

    @property
    def progress(self) -> float:
        return min(1.0, self._elapsed_s / self.scenario["duration_s"])

    def control(self, *, scenario_id: str | None = None, action: str | None = None, speed: float | None = None) -> None:
        if scenario_id is not None:
            if scenario_id not in self.scenarios:
                raise ValueError(f"Unknown scenario '{scenario_id}'")
            self.scenario_id = scenario_id
            self._elapsed_s = 0.0
            self.playing = True
        if action == "play":
            if self.progress >= 1.0:
                self._elapsed_s = 0.0
            self.playing = True
        elif action == "pause":
            self.playing = False
        elif action == "restart":
            self._elapsed_s = 0.0
            self.playing = True
        elif action is not None:
            raise ValueError(f"Unknown action '{action}'")
        if speed is not None:
            if speed not in SPEEDS:
                raise ValueError(f"Speed must be one of {SPEEDS}")
            self.speed = speed
        self._last_tick = time.monotonic()
        self._compute()

    async def activate(self) -> None:
        self._last_tick = time.monotonic()

    async def tick(self) -> None:
        now = time.monotonic()
        if self.playing:
            self._elapsed_s = min(self.scenario["duration_s"], self._elapsed_s + (now - self._last_tick) * self.speed)
            if self.progress >= 1.0:
                self.playing = False
        self._last_tick = now
        self._compute()

    # ---- hydrographs ----

    def _river_profile(self, river_id: str) -> dict | None:
        rivers = self.scenario.get("rivers", {})
        return rivers.get(river_id) or rivers.get("*")

    def _level_at(self, gauge: Gauge, u: float) -> float:
        """Gauge level at scenario fraction `u` (may exceed 1 for forecasts)."""
        profile = self._river_profile(gauge.river_id)
        if profile is None:
            return gauge.normal_m
        peak = gauge.danger_m + profile["peak_above_danger_m"]
        onset, peak_at = profile["onset"], profile["peak_at"]
        if u <= onset:
            return gauge.normal_m
        if u <= peak_at:
            return gauge.normal_m + (peak - gauge.normal_m) * _smoothstep((u - onset) / (peak_at - onset))
        hours_after_peak = (u - peak_at) * self.scenario["represents_hours"]
        return max(gauge.normal_m, peak - profile["recession_m_per_hr"] * hours_after_peak)

    def _u_after(self, hours: float) -> float:
        return self.progress + hours / self.scenario["represents_hours"]

    def level_forecast(self, river_id: str, hours_ahead: float) -> float | None:
        gauge = self.gauges.get(river_id)
        return None if gauge is None else round(self._level_at(gauge, self._u_after(hours_ahead)), 2)

    def _dam_at(self, dam_id: str, u: float) -> tuple[float, float, float]:
        """(storage %, inflow m³/s, outflow m³/s) at scenario fraction `u`.
        Inflow peaks with the rivers and recedes afterwards, like a hydrograph."""
        cfg = self.scenario.get("dams", {}).get(dam_id)
        if cfg is None:
            d = self.dam_defaults
            return d["storage_pct"], d["inflow_m3s"], d["outflow_m3s"]
        fill = _smoothstep(min(u, 1.0) / 0.9)
        storage = cfg["storage_start_pct"] + (cfg["storage_peak_pct"] - cfg["storage_start_pct"]) * fill
        pulse = _smoothstep(u / 0.75) if u <= 0.75 else max(0.0, 1 - (u - 0.75) * 1.6)
        inflow = cfg["inflow_base"] + (cfg["inflow_peak"] - cfg["inflow_base"]) * pulse
        outflow = cfg["outflow_base"] + (cfg["inflow_peak"] - cfg["inflow_base"]) * fill * 0.55
        return storage, inflow, outflow

    def has_dam_profile(self, dam_id: str) -> bool:
        return dam_id in self.scenario.get("dams", {})

    def dam_inflow_forecast(self, dam_id: str, hours_ahead: float) -> float | None:
        if not self.has_dam_profile(dam_id):
            return None
        return self._dam_at(dam_id, self._u_after(hours_ahead))[1]

    def sea_level_offset_m(self, hours_ahead: float = 0.0) -> float:
        """Scripted storm surge / monsoon set-up added to the live tide in simulation."""
        surge = self.scenario.get("coast", {}).get("surge_m", 0.0)
        return surge * _smoothstep(self._u_after(hours_ahead) / 0.8)

    def _compute(self) -> None:
        u = self.progress
        step_h = 0.5
        for rid, gauge in self.gauges.items():
            active = self._river_profile(rid) is not None
            level = self._level_at(gauge, u) + (random.uniform(-_READING_NOISE_M, _READING_NOISE_M) if active else 0.0)
            rise = (self._level_at(gauge, self._u_after(step_h)) - self._level_at(gauge, self._u_after(-step_h))) / (2 * step_h)
            self._rivers[rid] = RiverReading(
                river_id=rid,
                level_m=round(level, 2),
                danger_level_m=gauge.danger_m,
                warning_level_m=gauge.warning_m,
                rise_rate_m_per_hr=round(rise, 3),
                risk=compute_river_risk(level, gauge.danger_m, gauge.warning_m, rise),
                updated_at=now_iso(),
                source="simulation",
            )

        for dam_id in self.dam_ids:
            storage, inflow, outflow = self._dam_at(dam_id, u)
            if dam_id in self.scenario.get("dams", {}):
                inflow += random.uniform(-15, 15)
            risk = compute_dam_risk(storage, inflow, outflow)
            self._dams[dam_id] = DamReading(
                dam_id=dam_id,
                storage_pct=round(min(99.0, storage), 1),
                inflow_m3s=round(inflow, 1),
                outflow_m3s=round(outflow, 1),
                rule_level_status="APPROACHING" if risk.value in ("HIGH", "CRITICAL") else "NORMAL",
                risk=risk,
                updated_at=now_iso(),
                source="simulation" if self.has_dam_profile(dam_id) else "static",
            )

    # ---- reads ----

    def rivers(self) -> dict[str, RiverReading]:
        return self._rivers

    def dams(self) -> dict[str, DamReading]:
        return self._dams

    def status(self) -> dict:
        s = self.scenario
        return {
            "scenario_id": self.scenario_id,
            "scenarios": [
                {"id": sc["id"], "name": sc["name"], "description": sc["description"]} for sc in self.scenarios.values()
            ],
            "playing": self.playing,
            "speed": self.speed,
            "speeds": list(SPEEDS),
            "progress": round(self.progress, 3),
            "scenario_hours": round(self.progress * s["represents_hours"], 1),
            "represents_hours": s["represents_hours"],
        }

    def health(self) -> list[dict]:
        active = sum(1 for rid in self.gauges if self._river_profile(rid) is not None)
        return [{
            "name": f"Scenario: {self.scenario['name']}",
            "status": "SIMULATED",
            "detail": f"{active} rivers scripted · T+{self.status()['scenario_hours']}h of {self.scenario['represents_hours']}h",
            "as_of": now_iso(),
        }]
