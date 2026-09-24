import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.simulator import simulator

router = APIRouter(prefix="/rivers", tags=["rivers"])

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "kerala_rivers.geojson"
with open(DATA_PATH, encoding="utf-8") as f:
    _GEOJSON = json.load(f)


@router.get("/geojson")
def get_rivers_geojson():
    return _GEOJSON


@router.get("")
def list_rivers():
    return simulator.list_rivers()


@router.get("/{river_id}")
def get_river(river_id: str):
    reading = simulator.get_river(river_id)
    if reading is None:
        raise HTTPException(status_code=404, detail="Unknown river")
    return reading
