import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from services.sources.hub import hub

router = APIRouter(prefix="/dams", tags=["dams"])

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "kerala_dams.geojson"
with open(DATA_PATH, encoding="utf-8") as f:
    _GEOJSON = json.load(f)


@router.get("/geojson")
def get_dams_geojson():
    return _GEOJSON


@router.get("")
def list_dams():
    return hub.list_dams()


@router.get("/{dam_id}")
def get_dam(dam_id: str):
    reading = hub.get_dam(dam_id)
    if reading is None:
        raise HTTPException(status_code=404, detail="Unknown dam")
    return reading
