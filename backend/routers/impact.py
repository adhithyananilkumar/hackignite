import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from models import ImpactSummary
from services.impact_engine import compute_impact
from services.simulator import simulator

router = APIRouter(prefix="/impact", tags=["impact"])

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "impact_layer.geojson"
with open(DATA_PATH, encoding="utf-8") as f:
    _GEOJSON = json.load(f)


@router.get("/geojson")
def get_impact_geojson():
    return _GEOJSON


@router.get("/{basin_id}", response_model=ImpactSummary)
def get_impact(basin_id: str):
    reading = simulator.get_river(basin_id)
    if reading is None:
        raise HTTPException(status_code=404, detail="Unknown basin")
    return compute_impact(basin_id, reading.risk)
