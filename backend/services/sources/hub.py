"""The data hub: the one place the rest of the backend reads river/dam state
from. It holds the registered providers, switches between them at runtime, and
broadcasts snapshots to WebSocket subscribers."""

import asyncio

from models import DamReading, ForecastPoint, RiverReading
from services.sources.base import StateProvider, load_gauges
from services.sources.live import LiveProvider
from services.sources.simulation import SimulationProvider

TICK_SECONDS = 4.0
CROSSING_SEARCH_HOURS = 72
CROSSING_STEP_HOURS = 0.25


class DataHub:
    def __init__(self, providers: list[StateProvider], default: str):
        self.providers = {p.id: p for p in providers}
        self._active = self.providers[default]
        self._subscribers: list[asyncio.Queue] = []

    # ---- mode ----

    @property
    def mode(self) -> str:
        return self._active.id

    @property
    def active(self) -> StateProvider:
        return self._active

    def provider(self, provider_id: str) -> StateProvider:
        return self.providers[provider_id]

    async def set_mode(self, provider_id: str) -> None:
        if provider_id not in self.providers:
            raise ValueError(f"Unknown data source '{provider_id}'")
        self._active = self.providers[provider_id]
        await self._active.activate()
        await self._active.tick()
        await self.broadcast()

    def describe(self) -> dict:
        return {
            "mode": self.mode,
            "modes": [{"id": p.id, "label": p.label, "kind": p.kind, "description": p.description} for p in self.providers.values()],
            "status": {p.id: p.status() for p in self.providers.values()},
        }

    # ---- reads (active provider) ----

    def list_rivers(self) -> list[RiverReading]:
        return list(self._active.rivers().values())

    def get_river(self, river_id: str) -> RiverReading | None:
        return self._active.rivers().get(river_id)

    def list_dams(self) -> list[DamReading]:
        return list(self._active.dams().values())

    def get_dam(self, dam_id: str) -> DamReading | None:
        return self._active.dams().get(dam_id)

    def level_forecast(self, reading: RiverReading, horizons_hr: tuple[float, ...]) -> list[ForecastPoint]:
        """Provider forecast where it has one, else linear extrapolation of the
        current rise rate."""
        points = []
        for h in horizons_hr:
            level = self._active.level_forecast(reading.river_id, h) if h > 0 else reading.level_m
            if level is None:
                level = reading.level_m + reading.rise_rate_m_per_hr * h
            points.append(ForecastPoint(
                horizon_hours=h,
                level_m=round(level, 2),
                confidence_pct=round(self._active.forecast_confidence(h), 1),
            ))
        return points

    def danger_crossing_hours(self, reading: RiverReading) -> float | None:
        if reading.level_m >= reading.danger_level_m:
            return None
        steps = int(CROSSING_SEARCH_HOURS / CROSSING_STEP_HOURS)
        hours = tuple(i * CROSSING_STEP_HOURS for i in range(1, steps + 1))
        for point in self.level_forecast(reading, hours):
            if point.level_m >= reading.danger_level_m:
                return point.horizon_hours
        return None

    def snapshot(self) -> dict:
        return {
            "mode": self.mode,
            "rivers": {r.river_id: r.model_dump(mode="json") for r in self.list_rivers()},
            "dams": {d.dam_id: d.model_dump(mode="json") for d in self.list_dams()},
            "source_status": self._active.status(),
        }

    def health(self) -> list[dict]:
        return self._active.health()

    # ---- streaming ----

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=4)
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    async def broadcast(self) -> None:
        snap = self.snapshot()
        for queue in list(self._subscribers):
            if not queue.full():
                queue.put_nowait(snap)

    async def run(self) -> None:
        await self._active.activate()
        while True:
            await self._active.tick()
            await self.broadcast()
            await asyncio.sleep(TICK_SECONDS)


_gauges = load_gauges()
hub = DataHub([LiveProvider(_gauges), SimulationProvider(_gauges)], default="simulation")
