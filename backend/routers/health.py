import os
from datetime import UTC, datetime

from fastapi import APIRouter

from services.simulator import FEATURED_DAM_CONFIG, FEATURED_RIVER_CONFIG

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def data_health():
    now = datetime.now(UTC).isoformat()
    sources = [
        {"name": "Scenario simulator (featured basins)", "status": "SIMULATED", "detail": f"{len(FEATURED_RIVER_CONFIG)} rivers, {len(FEATURED_DAM_CONFIG)} dam", "as_of": now},
        {"name": "Static baseline (remaining rivers/dams)", "status": "STATIC", "detail": "Not live — placeholder values", "as_of": now},
        {"name": "Open-Meteo rainfall forecast", "status": "LIVE" if True else "UNAVAILABLE", "detail": "Real forecast API, no key required", "as_of": now},
        {"name": "AI assistant (Claude)", "status": "LIVE" if os.environ.get("ANTHROPIC_API_KEY") else "OFFLINE", "detail": "Set ANTHROPIC_API_KEY to enable", "as_of": now},
    ]
    return {"sources": sources}
