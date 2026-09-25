"""Contract every river/reservoir state provider implements, plus the shared
gauge and dam registries.

A provider owns the current readings and (optionally) its own level forecast.
Everything downstream — risk, alerts, flood extents, impact, AI — reads through
the hub, so live feeds, scenario simulation, or a future CWC/KSEB/MOSDAC
integration are interchangeable.
"""

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from models import DamReading, RiverReading

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"


@dataclass(frozen=True)
class Gauge:
    river_id: str
    name: str
    lon: float
    lat: float
    normal_m: float
    warning_m: float
    danger_m: float


def load_gauges() -> dict[str, Gauge]:
    raw = json.loads((DATA_DIR / "gauges.json").read_text(encoding="utf-8"))["gauges"]
    return {
        rid: Gauge(rid, g["name"], g["coordinates"][0], g["coordinates"][1], g["normal_m"], g["warning_m"], g["danger_m"])
        for rid, g in raw.items()
    }


def load_dam_ids() -> list[str]:
    features = json.loads((DATA_DIR / "kerala_dams.geojson").read_text(encoding="utf-8"))["features"]
    return [f["properties"]["id"] for f in features]


def load_dam_defaults() -> dict:
    return json.loads((DATA_DIR / "gauges.json").read_text(encoding="utf-8"))["dam_defaults"]


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


class StateProvider(ABC):
    id: str
    label: str
    kind: str  # "live" | "simulation"
    description: str

    async def activate(self) -> None:
        """Called when the hub switches to this provider."""

    @abstractmethod
    async def tick(self) -> None:
        """Advance/refresh state; called on every hub tick while active."""

    @abstractmethod
    def rivers(self) -> dict[str, RiverReading]: ...

    @abstractmethod
    def dams(self) -> dict[str, DamReading]: ...

    def level_forecast(self, river_id: str, hours_ahead: float) -> float | None:
        """Forecast gauge level `hours_ahead` from now, or None to let the hub
        extrapolate from the current rise rate."""
        return None

    def dam_inflow_forecast(self, dam_id: str, hours_ahead: float) -> float | None:
        """Provider's own inflow forecast for a dam, or None to fall back to GloFAS."""
        return None

    def sea_level_offset_m(self, hours_ahead: float = 0.0) -> float:
        """Added to observed sea level (non-zero only for scripted surge scenarios)."""
        return 0.0

    def forecast_confidence(self, hours_ahead: float) -> float:
        return max(35.0, 92.0 - hours_ahead * 5.5)

    @abstractmethod
    def status(self) -> dict:
        """Provider-specific state for the UI switcher."""

    @abstractmethod
    def health(self) -> list[dict]:
        """Data-health entries: {name, status, detail, as_of}."""
