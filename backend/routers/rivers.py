import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.sources.hub import hub

router = APIRouter(prefix="/rivers", tags=["rivers"])

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "kerala_rivers.geojson"
with open(DATA_PATH, encoding="utf-8") as f:
    _GEOJSON = json.load(f)


@router.get("/geojson")
def get_rivers_geojson():
    return _GEOJSON


@router.get("")
def list_rivers():
    return hub.list_rivers()


@router.get("/{river_id}")
def get_river(river_id: str):
    reading = hub.get_river(river_id)
    if reading is None:
        raise HTTPException(status_code=404, detail="Unknown river")
    return reading
