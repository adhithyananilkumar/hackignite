"""Place search and reverse geocoding, restricted to Kerala. OpenStreetMap
Nominatim (key-free; its usage policy asks for a User-Agent, caching and at most
one request per second, which a single dashboard stays well within)."""

import asyncio
import time

import httpx

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
HEADERS = {"User-Agent": "VARUNA-Kerala-flood-dashboard/1.0 (hackathon demo)"}
# left, top, right, bottom
KERALA_VIEWBOX = "74.8,12.85,77.45,8.15"
_CACHE_TTL_S = 24 * 3600
_MIN_INTERVAL_S = 1.0

_cache: dict[str, tuple[float, object]] = {}
_lock = asyncio.Lock()
_last_call = 0.0


async def _get(path: str, params: dict):
    global _last_call
    key = f"{path}?{sorted(params.items())}"
    cached = _cache.get(key)
    if cached and time.time() - cached[0] < _CACHE_TTL_S:
        return cached[1]
    async with _lock:
        wait = _MIN_INTERVAL_S - (time.monotonic() - _last_call)
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            async with httpx.AsyncClient(timeout=8.0, headers=HEADERS) as client:
                resp = await client.get(f"{NOMINATIM_URL}/{path}", params={**params, "format": "jsonv2"})
                resp.raise_for_status()
                data = resp.json()
        finally:
            _last_call = time.monotonic()
    _cache[key] = (time.time(), data)
    return data


def _short_name(item: dict) -> str:
    return item.get("name") or item.get("display_name", "").split(",")[0]


async def search_places(query: str, limit: int = 5) -> list[dict]:
    try:
        items = await _get("search", {
            "q": query, "limit": limit, "countrycodes": "in", "viewbox": KERALA_VIEWBOX, "bounded": 1, "addressdetails": 0,
        })
    except (httpx.HTTPError, ValueError):
        return []
    return [
        {
            "name": _short_name(item),
            "detail": ", ".join(item.get("display_name", "").split(", ")[1:4]),
            "lat": float(item["lat"]),
            "lon": float(item["lon"]),
            "kind": item.get("addresstype") or item.get("type", "place"),
        }
        for item in items
    ]


async def reverse_geocode(lat: float, lon: float) -> dict | None:
    try:
        item = await _get("reverse", {"lat": round(lat, 5), "lon": round(lon, 5), "zoom": 14})
    except (httpx.HTTPError, ValueError):
        return None
    if not item or "error" in item:
        return None
    parts = item.get("display_name", "").split(", ")
    return {"name": _short_name(item), "detail": ", ".join(parts[1:4])}
