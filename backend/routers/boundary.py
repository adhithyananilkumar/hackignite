import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/boundary", tags=["boundary"])

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "kerala_boundary.geojson"
with open(DATA_PATH, encoding="utf-8") as f:
    _GEOJSON = json.load(f)


@router.get("/geojson")
def get_boundary_geojson():
    return _GEOJSON
