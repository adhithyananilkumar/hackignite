import os
from datetime import UTC, datetime

from fastapi import APIRouter

from services.coastal import coastal
from services.flood_model import MODEL_LABEL, flood_model
from services.sources.hub import hub

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def data_health():
    now = datetime.now(UTC).isoformat()
    sources = [
        *hub.health(),
        {
            "name": "Copernicus Marine sea level",
            "status": "LIVE",
            "detail": f"{len(coastal.outlets)} river mouths · tide + surge, hourly",
            "as_of": now,
        },
        {
            "name": "Flood extent model",
            "status": "MODELLED" if flood_model.manifest.get("rivers") else "UNAVAILABLE",
            "detail": f"{len(flood_model.manifest.get('rivers', {}))} rivers · {MODEL_LABEL}",
            "as_of": flood_model.manifest.get("built_at", now),
        },
        {"name": "Ask VARUNA (Gemini)", "status": "LIVE" if os.environ.get("GEMINI_API_KEY") else "OFFLINE", "detail": "Set GEMINI_API_KEY to enable", "as_of": now},
    ]
    return {"mode": hub.mode, "sources": sources}
