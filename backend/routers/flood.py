import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response

from models import FloodForecast
from services.flood_forecast import build_flood_forecast, decode_stages
from services.flood_model import flood_model

router = APIRouter(prefix="/flood", tags=["flood"])

# Extent URLs embed the model version and a quantised stage, so their content
# never changes and browsers/CDNs can keep them forever.
_IMMUTABLE = {"Cache-Control": "public, max-age=31536000, immutable"}


def _check_version(version: str, river_id: str) -> None:
    if version != flood_model.version or not flood_model.has_river(river_id):
        raise HTTPException(status_code=404, detail="Unknown model version or river")


@router.get("/forecast", response_model=FloodForecast)
def get_flood_forecast(river_id: list[str] | None = Query(default=None)):
    return build_flood_forecast(set(river_id) if river_id else None)


@router.get("/{version}/tiles/{z}/{x}/{y}.png")
def get_extent_tile(version: str, z: int, x: int, y: int, s: str = ""):
    """Depth-coloured XYZ tile compositing the rivers/stages listed in `s`
    (`river.stage_dm,...`, as produced by /flood/forecast)."""
    if version != flood_model.version:
        raise HTTPException(status_code=404, detail="Unknown model version")
    try:
        stages = decode_stages(s)
    except ValueError:
        raise HTTPException(status_code=400, detail="Malformed stage list") from None
    if any(not flood_model.has_river(rid) for rid, _ in stages):
        raise HTTPException(status_code=404, detail="Unknown river")
    return Response(content=flood_model.tile_png(stages, z, x, y), media_type="image/png", headers=_IMMUTABLE)


@router.get("/{version}/{river_id}/{stage_dm}.geojson")
def get_extent_geojson(version: str, river_id: str, stage_dm: int):
    """Depth-banded extent polygons (nested: each band includes deeper ones), for GIS export."""
    _check_version(version, river_id)
    features = [
        {
            "type": "Feature",
            "properties": {"river_id": river_id, "stage_m": stage_dm / 10, "depth_min_m": band_m, "model": flood_model.version},
            "geometry": geometry,
        }
        for band_m, geometry in flood_model.polygons(river_id, stage_dm)
    ]
    return Response(
        content=json.dumps({"type": "FeatureCollection", "features": features}),
        media_type="application/geo+json",
        headers=_IMMUTABLE,
    )
