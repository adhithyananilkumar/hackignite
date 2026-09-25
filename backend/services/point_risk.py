"""Flood likelihood at a single point: samples each river's relative-elevation
grid at the point to find the river stage that would put it under water, and
compares that with the active data source's level forecast and the local rain
outlook. The likelihood is a screening index derived from the model, not a
calibrated probability."""

import asyncio
import json
import math
from pathlib import Path

import numpy as np
import shapely

from services.flood_forecast import FLOOD_HORIZONS_HR
from services.flood_model import NODATA, TILE_PX, flood_model
from services.sources.hub import hub
from services.weather_client import get_point_rain_outlook

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# Kerala's bounding box, padded; points outside are rejected.
LAT_RANGE = (7.9, 13.2)
LON_RANGE = (74.6, 77.6)

# Projection to local km (good to ~2% across Kerala's latitude span).
_KM_PER_DEG_LAT = 110.57
_KM_PER_DEG_LON = 111.32 * math.cos(math.radians(10.5))

# Screening index: how quickly likelihood decays with the metres the river still
# has to rise before this point floods.
_MARGIN_DECAY_M = 1.5
_LEVELS = ((70, "Very high"), (45, "High"), (25, "Moderate"), (10, "Low"), (0, "Very low"))
_NEARBY_TYPES = ("shelter", "hospital")
_NEARBY_PER_TYPE = 2


def _to_km(lon, lat):
    return np.asarray(lon) * _KM_PER_DEG_LON, np.asarray(lat) * _KM_PER_DEG_LAT


def _load_rivers() -> tuple[list[dict], list]:
    fc = json.loads((DATA_DIR / "kerala_rivers.geojson").read_text(encoding="utf-8"))
    props, lines = [], []
    for f in fc["features"]:
        geom = shapely.geometry.shape(f["geometry"])
        lines.append(shapely.transform(geom, lambda c: np.column_stack(_to_km(c[:, 0], c[:, 1]))))
        props.append(f["properties"])
    return props, lines


def _load_assets() -> tuple[list[dict], np.ndarray, np.ndarray]:
    fc = json.loads((DATA_DIR / "impact_layer.geojson").read_text(encoding="utf-8"))
    kept = [f for f in fc["features"] if f["properties"]["type"] in _NEARBY_TYPES and not f["properties"]["name"].startswith("Unnamed")]
    lon = np.array([f["geometry"]["coordinates"][0] for f in kept])
    lat = np.array([f["geometry"]["coordinates"][1] for f in kept])
    return [f["properties"] | {"lon": float(x), "lat": float(y)} for f, x, y in zip(kept, lon, lat)], lon, lat


RIVER_PROPS, _RIVER_LINES = _load_rivers()
RIVER_NAMES = {p["id"]: p["name"] for p in RIVER_PROPS}
_ASSETS, _ASSET_LON, _ASSET_LAT = _load_assets()


def river_points(river_id: str, fractions: tuple[float, ...]) -> list[tuple[float, float]]:
    """(lat, lon) at fractions of a river's length, plus its gauge."""
    i = next((i for i, p in enumerate(RIVER_PROPS) if p["id"] == river_id), None)
    if i is None:
        return []
    points = []
    for frac in fractions:
        p = _RIVER_LINES[i].interpolate(frac, normalized=True)
        points.append((p.y / _KM_PER_DEG_LAT, p.x / _KM_PER_DEG_LON))
    if gauge := RIVER_PROPS[i].get("gauge_coordinates"):
        points.append((gauge[1], gauge[0]))
    return points


def in_kerala(lat: float, lon: float) -> bool:
    return LAT_RANGE[0] <= lat <= LAT_RANGE[1] and LON_RANGE[0] <= lon <= LON_RANGE[1]


def nearest_river(lat: float, lon: float) -> dict:
    point = shapely.Point(*_to_km(lon, lat))
    dists = [line.distance(point) for line in _RIVER_LINES]
    i = int(np.argmin(dists))
    return {"river_id": RIVER_PROPS[i]["id"], "name": RIVER_PROPS[i]["name"], "distance_km": round(float(dists[i]), 2)}


def _nearby_facilities(lat: float, lon: float) -> dict:
    x, y = _to_km(_ASSET_LON, _ASSET_LAT)
    px, py = _to_km(lon, lat)
    dist = np.hypot(x - px, y - py)
    out: dict[str, list] = {}
    for kind in _NEARBY_TYPES:
        idx = [i for i in np.argsort(dist) if _ASSETS[i]["type"] == kind][:_NEARBY_PER_TYPE]
        out[kind] = [
            {"name": _ASSETS[i]["name"], "distance_km": round(float(dist[i]), 2), "lon": _ASSETS[i]["lon"], "lat": _ASSETS[i]["lat"]}
            for i in idx
        ]
    return out


def _grid_cell(grid, lat: float, lon: float) -> tuple[int, int] | None:
    world = TILE_PX * 2**grid.zoom
    col = math.floor((lon + 180) / 360 * world - grid.px0)
    lat_r = math.radians(lat)
    row = math.floor((1 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2 * world - grid.py0)
    if 0 <= row < grid.h and 0 <= col < grid.w:
        return row, col
    return None


def _river_exposure(river_id: str, lat: float, lon: float) -> dict | None:
    """How this river's forecast reaches the point, or None if the point is
    outside the river's modelled floodplain."""
    grid = flood_model.grid(river_id)
    reading = hub.get_river(river_id)
    if grid is None or reading is None:
        return None
    cell = _grid_cell(grid, lat, lon)
    if cell is None:
        return None
    fill_dm = int(grid.fill_dm[cell])
    if fill_dm == NODATA:
        return None
    rem_dm = int(grid.rem_dm[cell])
    in_channel = bool(grid.water[cell])

    horizons = []
    for point in hub.level_forecast(reading, FLOOD_HORIZONS_HR):
        stage_dm = flood_model.quantise(point.level_m - reading.danger_level_m)
        flooded = not in_channel and stage_dm > 0 and fill_dm <= stage_dm
        horizons.append({
            "horizon_hours": point.horizon_hours,
            "river_level_m": round(point.level_m, 2),
            "confidence_pct": point.confidence_pct,
            "flooded": flooded,
            "depth_m": (stage_dm - rem_dm) / 10 if flooded else 0.0,
        })
    peak_stage_dm = max(flood_model.quantise(h["river_level_m"] - reading.danger_level_m) for h in horizons)
    return {
        "river_id": river_id,
        "name": RIVER_NAMES.get(river_id, river_id),
        "risk": reading.risk.value,
        "river_level_m": reading.level_m,
        "danger_level_m": reading.danger_level_m,
        "height_above_river_m": rem_dm / 10,
        # The model's grids top out at 15 m above danger level.
        "floods_when_above_danger_by_m": fill_dm / 10,
        "floods_at_river_level_m": round(reading.danger_level_m + fill_dm / 10, 2),
        "margin_m": round((fill_dm - peak_stage_dm) / 10, 1),
        "in_river_channel": in_channel,
        "horizons": horizons,
    }


def _likelihood(exposures: list[dict], rain: dict, river_distance_km: float) -> dict:
    rain_24 = rain.get("next_24h_mm", 0.0) if rain.get("available") else 0.0
    rain_boost = min(15.0, rain_24 / 8)
    driver = None
    if exposures:
        worst = min(exposures, key=lambda e: e["margin_m"])
        first_wet = next((h for h in worst["horizons"] if h["flooded"]), None)
        if first_wet:
            score = max(70.0, min(97.0, first_wet["confidence_pct"] + 5))
            driver = (
                f"{worst['name']} forecast puts this point under ~{first_wet['depth_m']:.1f} m of water "
                f"within {first_wet['horizon_hours']:g}h"
            )
        else:
            score = 55 * math.exp(-max(worst["margin_m"], 0) / _MARGIN_DECAY_M) + rain_boost
            driver = f"{worst['name']} would need to rise another {worst['margin_m']:.1f} m (beyond the 12h forecast peak) to reach this point"
    else:
        # Outside every modelled river floodplain: only local waterlogging or
        # flash flooding from very heavy rain is plausible.
        score = 4 + rain_boost + (5 if river_distance_km < 1 else 0)
        driver = "Outside the modelled river floodplains; risk comes mainly from heavy local rain"
    score = round(min(max(score, 1.0), 97.0))
    level = next(label for threshold, label in _LEVELS if score >= threshold)
    return {"score": score, "level": level, "driver": driver}


async def assess_point(lat: float, lon: float) -> dict:
    rain_task = asyncio.create_task(get_point_rain_outlook(lat, lon))
    exposures = [e for rid in flood_model.manifest.get("rivers", {}) if (e := _river_exposure(rid, lat, lon))]
    exposures.sort(key=lambda e: e["margin_m"])
    river = nearest_river(lat, lon)
    rain = await rain_task
    active = hub.active
    return {
        "lat": round(lat, 5),
        "lon": round(lon, 5),
        "data_source": {"mode": active.label, "kind": active.kind},
        "likelihood": _likelihood(exposures, rain, river["distance_km"]),
        "nearest_river": river,
        "modelled_floodplain": bool(exposures),
        "rivers": exposures,
        "rain": rain,
        "nearby": _nearby_facilities(lat, lon),
        "note": "Screening index from a terrain flood model and the active river forecast — not an official warning.",
    }
