import asyncio

from fastapi import APIRouter, HTTPException, Query

from services.geocode import reverse_geocode, search_places
from services.point_risk import assess_point, in_kerala

router = APIRouter(prefix="/locate", tags=["locate"])

_REVERSE_TIMEOUT_S = 4.0


@router.get("/search")
async def search(q: str = Query(min_length=2, max_length=120)):
    return await search_places(q)


@router.get("/assess")
async def assess(lat: float, lon: float):
    """Flood likelihood, rain outlook and nearest refuges for one point."""
    if not in_kerala(lat, lon):
        raise HTTPException(status_code=400, detail="Point is outside Kerala")
    place_task = asyncio.create_task(reverse_geocode(lat, lon))
    result = await assess_point(lat, lon)
    try:
        result["place"] = await asyncio.wait_for(place_task, _REVERSE_TIMEOUT_S)
    except TimeoutError:
        result["place"] = None
    return result
