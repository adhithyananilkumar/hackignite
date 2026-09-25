import json

import httpx
from fastapi import APIRouter, HTTPException

from services.coastal import coastal
from services.glofas import glofas, load_calibrations
from services.reservoirs import reservoirs
from services.sources.base import DATA_DIR

router = APIRouter(tags=["hydrology"])

_RIVERS = {
    f["properties"]["id"]: f["properties"]
    for f in json.loads((DATA_DIR / "kerala_rivers.geojson").read_text(encoding="utf-8"))["features"]
}


def _upstream_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(status_code=503, detail=f"Upstream data service unavailable: {type(exc).__name__}")


@router.get("/flow/rivers/{river_id}")
async def river_flow(river_id: str):
    """7-day GloFAS ensemble discharge outlook at the river's reference gauge."""
    river = _RIVERS.get(river_id)
    if river is None:
        raise HTTPException(status_code=404, detail="Unknown river")
    cal = load_calibrations().get(river_id)
    cell = (cal["lon"], cal["lat"]) if cal else None
    lon, lat = river["gauge_coordinates"]
    try:
        out = await glofas.outlook(f"river:{river_id}", lon, lat, cell=cell)
    except httpx.HTTPError as exc:
        raise _upstream_unavailable(exc) from None
    return {**out, "warning_flow_m3s": round(cal["q2"], 1) if cal else None, "danger_flow_m3s": round(cal["q5"], 1) if cal else None}


@router.get("/flow/dams/{dam_id}")
async def dam_flow(dam_id: str):
    dam = reservoirs.dams.get(dam_id)
    if dam is None:
        raise HTTPException(status_code=404, detail="Unknown dam")
    try:
        return await glofas.outlook(f"dam:{dam_id}", *dam["coordinates"])
    except httpx.HTTPError as exc:
        raise _upstream_unavailable(exc) from None


@router.get("/reservoirs/{dam_id}/outlook")
async def reservoir_outlook(dam_id: str):
    try:
        result = await reservoirs.outlook(dam_id)
    except httpx.HTTPError as exc:
        raise _upstream_unavailable(exc) from None
    if result is None:
        raise HTTPException(status_code=404, detail="Unknown dam")
    return result


@router.get("/coastal")
async def coastal_sea_level():
    try:
        return await coastal.snapshot()
    except httpx.HTTPError as exc:
        raise _upstream_unavailable(exc) from None
