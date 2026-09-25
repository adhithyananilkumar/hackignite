"""Offline build for the flood-extent model's terrain and exposure inputs.

Run from backend/:
    python scripts/build_flood_grids.py            # every river in data/kerala_rivers.geojson
    python scripts/build_flood_grids.py periyar    # just one

Needs network on first run (AWS Terrain Tiles, OpenStreetMap Overpass); raw
downloads are cached in _raw_dem/ and _raw_osm/ so reruns are offline.

Outputs (committed, read at runtime by services/flood_model.py):
    data/terrain/<river_id>.npz   per-river grid: relative elevation, connectivity, population
    data/terrain/manifest.json    build parameters + sources, surfaced via /health
    data/impact_layer.geojson     hospitals / schools / shelters / bridges near modelled rivers

Adding a river = add it to kerala_rivers.geojson and rerun this script.
"""

import heapq
import json
import math
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import shapely
from PIL import Image
from shapely.geometry import LineString, shape
from shapely.ops import polygonize, unary_union

BACKEND = Path(__file__).resolve().parent.parent
DATA = BACKEND / "data"
TERRAIN_OUT = DATA / "terrain"
RAW_OSM = BACKEND / "_raw_osm"
DEM_CACHE = BACKEND / "_raw_dem"

ZOOM = 11  # ~75 m cells at Kerala's latitude
TILE = 256
WORLD_PX = TILE * 2**ZOOM
CELL_DEG = 360 / WORLD_PX
CORRIDOR_DEG = 0.1  # ~11 km either side of the channel
MAX_REM_M = 15.0  # higher than this above the river never floods in any modelled scenario
# Floodwater surface falls away from the channel (friction/storage losses), so a
# cell's effective height above the river grows with distance. Without this, flat
# lowlands flood uniformly right up to the corridor edge.
LATERAL_ATTENUATION_M_PER_KM = 0.3
MIN_WATER_AREA_DEG2 = 1e-6  # ~2 terrain cells; smaller ponds don't matter at this resolution
MIN_RIVER_Z_M = -2.0  # Kuttanad sits ~2 m below sea level; clip deeper bathymetry at river mouths
BRIDGE_MAX_DIST_DEG = 0.004  # ~450 m: road bridges this close to a river are treated as crossing it
NODATA = np.iinfo(np.uint16).max

DEM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
USER_AGENT = "varuna-flood-intelligence-build/0.1"
KERALA_RELATION = 2018151

# Census of India 2011 district population density (persons / km²).
CENSUS_2011_DENSITY = {
    ("thiruvananthapuram", "trivandrum"): 1508,
    ("kollam", "quilon"): 1061,
    ("pathanamthitta",): 452,
    ("alappuzha", "alleppey"): 1504,
    ("kottayam",): 896,
    ("idukki",): 254,
    ("ernakulam",): 1072,
    ("thrissur", "trichur"): 1031,
    ("palakkad", "palghat"): 627,
    ("malappuram",): 1157,
    ("kozhikode", "calicut"): 1316,
    ("wayanad",): 384,
    ("kannur", "cannanore"): 852,
    ("kasaragod", "kasargod"): 657,
}
KERALA_DENSITY = 860

NEIGHBOURS = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


# ---------- Web-Mercator pixel helpers (same grid the terrain tiles use) ----------

def lonlat_to_px(lon, lat):
    lon = np.asarray(lon, dtype=np.float64)
    lat_r = np.radians(np.asarray(lat, dtype=np.float64))
    x = (lon + 180) / 360 * WORLD_PX
    y = (1 - np.log(np.tan(lat_r) + 1 / np.cos(lat_r)) / math.pi) / 2 * WORLD_PX
    return x, y


def px_to_lon(x):
    return np.asarray(x) / WORLD_PX * 360 - 180


def px_to_lat(y):
    return np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * np.asarray(y) / WORLD_PX))))


# ---------- Network fetchers with on-disk cache ----------

def _http(url: str, data: bytes | None = None, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def fetch_tile(tx: int, ty: int) -> np.ndarray:
    path = DEM_CACHE / str(ZOOM) / str(tx) / f"{ty}.png"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(_http(DEM_URL.format(z=ZOOM, x=tx, y=ty)))
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def load_dem(px0: int, py0: int, px1: int, py1: int) -> np.ndarray:
    tx0, ty0 = px0 // TILE, py0 // TILE
    tx1, ty1 = (px1 - 1) // TILE, (py1 - 1) // TILE
    tiles = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    with ThreadPoolExecutor(8) as pool:
        arrays = list(pool.map(lambda t: fetch_tile(*t), tiles))
    mosaic = np.empty(((ty1 - ty0 + 1) * TILE, (tx1 - tx0 + 1) * TILE), np.float32)
    for (tx, ty), arr in zip(tiles, arrays):
        mosaic[(ty - ty0) * TILE:(ty - ty0 + 1) * TILE, (tx - tx0) * TILE:(tx - tx0 + 1) * TILE] = arr
    return mosaic[py0 - ty0 * TILE:py1 - ty0 * TILE, px0 - tx0 * TILE:px1 - tx0 * TILE]


def overpass(query: str, cache_name: str) -> dict:
    cache = RAW_OSM / cache_name
    if cache.exists():
        return json.loads(cache.read_text(encoding="utf-8"))
    body = urllib.parse.urlencode({"data": query}).encode()
    errors = []
    for url in OVERPASS_MIRRORS:
        try:
            payload = _http(url, data=body, timeout=400)
            data = json.loads(payload)
            cache.write_bytes(payload)
            return data
        except Exception as exc:  # noqa: BLE001 - try the next mirror
            errors.append(f"{url}: {exc}")
            print(f"  overpass mirror failed, trying next ({url})")
    raise RuntimeError("All Overpass mirrors failed:\n" + "\n".join(errors))


# ---------- Districts → population density ----------

def density_for(name: str) -> int:
    low = name.lower()
    for aliases, density in CENSUS_2011_DENSITY.items():
        if any(a in low for a in aliases):
            return density
    return KERALA_DENSITY


def load_districts() -> list[tuple[str, int, object]]:
    query = f"""[out:json][timeout:300];
rel({KERALA_RELATION});map_to_area->.k;
rel(area.k)["boundary"="administrative"]["admin_level"="5"];
out geom;"""
    districts = []
    for rel in overpass(query, "districts.json")["elements"]:
        lines = [
            LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
            for m in rel.get("members", [])
            if m["type"] == "way" and m.get("role") == "outer" and len(m.get("geometry") or []) >= 2
        ]
        polys = list(polygonize(unary_union(lines))) if lines else []
        if not polys:
            continue
        name = rel["tags"].get("name:en") or rel["tags"].get("name", "")
        geom = unary_union(polys)
        shapely.prepare(geom)
        districts.append((name, density_for(name), geom))
    print(f"districts: {len(districts)} ({sum(1 for d in districts if d[1] != KERALA_DENSITY)} matched to Census 2011)")
    return districts


# ---------- Permanent water (lakes, backwaters, reservoirs, wide channels) ----------

def load_water() -> shapely.STRtree:
    query = f"""[out:json][timeout:400];
rel({KERALA_RELATION});map_to_area->.k;
(
  way["natural"="water"](area.k);
  rel["natural"="water"](area.k);
  way["waterway"="riverbank"](area.k);
  rel["waterway"="riverbank"](area.k);
);
out geom;"""
    polys = []
    for el in overpass(query, "water.json")["elements"]:
        if el["type"] == "way":
            ring = [(p["lon"], p["lat"]) for p in el.get("geometry") or []]
            if len(ring) >= 4 and ring[0] == ring[-1]:
                polys.append(shapely.Polygon(ring))
        else:
            lines = [
                LineString([(p["lon"], p["lat"]) for p in m["geometry"]])
                for m in el.get("members", [])
                if m["type"] == "way" and m.get("role") == "outer" and len(m.get("geometry") or []) >= 2
            ]
            if lines:
                polys.extend(polygonize(unary_union(lines)))
    polys = [p.buffer(0) if not p.is_valid else p for p in polys]
    polys = [p for p in polys if p.area >= MIN_WATER_AREA_DEG2]
    print(f"permanent water polygons: {len(polys)}")
    return shapely.STRtree(polys)


# ---------- Terrain model ----------

def minimax_fill(rem: np.ndarray, river_cells: np.ndarray) -> np.ndarray:
    """Priority-flood from the channel: for every cell, the lowest water stage at
    which a connected path from the river reaches it. Flooding at stage S is then
    just `fill <= S`, which keeps isolated low ground behind ridges dry."""
    h, w = rem.shape
    flat_rem = np.nan_to_num(rem, nan=np.inf).ravel().tolist()
    fill = [math.inf] * (h * w)
    heap = []
    for r, c in river_cells:
        idx = int(r) * w + int(c)
        fill[idx] = 0.0
        heap.append((0.0, idx))
    heapq.heapify(heap)
    while heap:
        f, idx = heapq.heappop(heap)
        if f > fill[idx]:
            continue
        r, c = divmod(idx, w)
        for dr, dc in NEIGHBOURS:
            nr, nc = r + dr, c + dc
            if nr < 0 or nr >= h or nc < 0 or nc >= w:
                continue
            n = nr * w + nc
            cell_rem = flat_rem[n]
            if cell_rem == math.inf:
                continue
            nf = f if f > cell_rem else cell_rem
            if nf < fill[n]:
                fill[n] = nf
                heapq.heappush(heap, (nf, n))
    return np.array(fill, dtype=np.float32).reshape(h, w)


def to_dm(values: np.ndarray) -> np.ndarray:
    out = np.full(values.shape, NODATA, dtype=np.uint16)
    ok = np.isfinite(values)
    out[ok] = np.clip(np.round(values[ok] * 10), 0, NODATA - 1).astype(np.uint16)
    return out


def build_river_grid(feature: dict, kerala, districts, water_index: shapely.STRtree) -> dict:
    river_id = feature["properties"]["id"]
    river = shape(feature["geometry"])
    corridor = river.buffer(CORRIDOR_DEG).intersection(kerala)
    shapely.prepare(corridor)

    minx, miny, maxx, maxy = corridor.bounds
    fx0, fy1 = lonlat_to_px(minx, miny)
    fx1, fy0 = lonlat_to_px(maxx, maxy)
    px0, py0 = int(math.floor(fx0)), int(math.floor(fy0))
    px1, py1 = int(math.ceil(fx1)), int(math.ceil(fy1))

    elev = load_dem(px0, py0, px1, py1)
    h, w = elev.shape
    lons = px_to_lon(np.arange(px0, px1) + 0.5)
    lats = px_to_lat(np.arange(py0, py1) + 0.5)
    lon_grid, lat_grid = np.meshgrid(lons, lats)
    inside = shapely.contains_xy(corridor, lon_grid, lat_grid) & (elev > -1)  # -1: drop open sea

    # Channel cells: the OSM centreline sampled finer than the grid.
    coords = shapely.get_coordinates(shapely.segmentize(river, CELL_DEG / 3))
    rx, ry = lonlat_to_px(coords[:, 0], coords[:, 1])
    ci, ri = (rx - px0).astype(int), (ry - py0).astype(int)
    keep = (ci >= 0) & (ci < w) & (ri >= 0) & (ri < h)
    river_cells = np.unique(np.stack([ri[keep], ci[keep]], axis=1), axis=0)
    river_cells = river_cells[inside[river_cells[:, 0], river_cells[:, 1]]]

    # The DEM is a surface model (canopy, roofs, bridges). A 3x3 minimum is a
    # cheap ground-surface approximation, and at channel cells it tracks the water.
    padded = np.pad(elev, 1, mode="edge")
    ground = np.min(
        np.stack([padded[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] for dy in (-1, 0, 1) for dx in (-1, 0, 1)]),
        axis=0,
    )
    river_z = np.maximum(ground[river_cells[:, 0], river_cells[:, 1]], MIN_RIVER_Z_M)

    # Relative elevation model (REM): height above the nearest channel cell, plus
    # lateral attenuation with distance from it.
    iy, ix = np.nonzero(inside)
    tree = shapely.STRtree(shapely.points(river_cells[:, 1], river_cells[:, 0]))
    src, dst = tree.query_nearest(shapely.points(ix, iy), all_matches=False)
    cy, cx = iy[src], ix[src]
    cell_km = 40075.016686 * np.cos(np.radians(lats)) / WORLD_PX
    dist_km = np.hypot(cy - river_cells[dst, 0], cx - river_cells[dst, 1]) * cell_km[cy]
    rem = np.full((h, w), np.nan, dtype=np.float32)
    rem[cy, cx] = np.maximum(ground[cy, cx] - river_z[dst], 0) + LATERAL_ATTENUATION_M_PER_KM * dist_km
    rem[river_cells[:, 0], river_cells[:, 1]] = 0
    rem[rem > MAX_REM_M] = np.nan

    fill = minimax_fill(rem, river_cells)
    valid = np.isfinite(fill)

    # Permanent water still conducts flow (it stays in the fill above) but is not
    # "flooded land": it's masked out of extents, area and population at runtime.
    water = np.zeros((h, w), dtype=bool)
    vy, vx = np.nonzero(valid)
    nearby = water_index.geometries.take(water_index.query(corridor))
    if len(nearby):
        water_geom = shapely.union_all(shapely.intersection(nearby, corridor))
        shapely.prepare(water_geom)
        water[vy, vx] = shapely.contains_xy(water_geom, lon_grid[vy, vx], lat_grid[vy, vx])

    # Resident population per cell from district density × cell area.
    row_km2 = (40075.016686 * np.cos(np.radians(lats)) / WORLD_PX) ** 2
    density = np.zeros((h, w), dtype=np.float32)
    for _, dens, geom in districts:
        hit = shapely.contains_xy(geom, lon_grid[vy, vx], lat_grid[vy, vx])
        density[vy[hit], vx[hit]] = dens
    density[valid & (density == 0)] = KERALA_DENSITY
    pop = (density * row_km2[:, None].astype(np.float32)) * (valid & ~water)

    # Crop to the cells that can actually flood.
    rows, cols = np.nonzero(valid)
    r0, r1, c0, c1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    out = TERRAIN_OUT / f"{river_id}.npz"
    np.savez_compressed(
        out,
        rem_dm=to_dm(np.where(valid, rem, np.nan)[r0:r1, c0:c1]),
        fill_dm=to_dm(np.where(valid, fill, np.nan)[r0:r1, c0:c1]),
        pop=pop[r0:r1, c0:c1].astype(np.float32),
        water=water[r0:r1, c0:c1],
        origin=np.array([ZOOM, px0 + c0, py0 + r0], dtype=np.int64),
    )
    stats = {
        "cells": int(valid.sum()),
        "water_cells": int(water.sum()),
        "grid": [int(r1 - r0), int(c1 - c0)],
        "population_in_corridor": int(pop.sum()),
        "bytes": out.stat().st_size,
    }
    print(f"  {river_id}: {stats}")
    return {"corridor": corridor, "river": river, **stats}


# ---------- Exposure assets (OpenStreetMap) ----------

def _asset_type(tags: dict) -> str | None:
    if tags.get("amenity") == "hospital":
        return "hospital"
    if tags.get("amenity") == "school":
        return "school"
    if tags.get("emergency") == "assembly_point" or tags.get("social_facility") == "shelter":
        return "shelter"
    if tags.get("bridge") == "yes" and "highway" in tags:
        return "bridge"
    return None


def build_assets(river_geoms: dict[str, dict]) -> None:
    query = f"""[out:json][timeout:400];
rel({KERALA_RELATION});map_to_area->.k;
(
  nwr["amenity"="hospital"](area.k);
  nwr["amenity"="school"](area.k);
  nwr["emergency"="assembly_point"](area.k);
  nwr["social_facility"="shelter"](area.k);
  way["bridge"="yes"]["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](area.k);
);
out center tags;"""
    elements = overpass(query, "infrastructure.json")["elements"]

    features = []
    for el in elements:
        tags = el.get("tags", {})
        kind = _asset_type(tags)
        lon = el.get("lon", el.get("center", {}).get("lon"))
        lat = el.get("lat", el.get("center", {}).get("lat"))
        if kind is None or lon is None:
            continue
        pt = shapely.Point(lon, lat)
        if kind == "bridge":
            candidates = [(g["river"].distance(pt), rid) for rid, g in river_geoms.items()]
            candidates = [c for c in candidates if c[0] <= BRIDGE_MAX_DIST_DEG]
        else:
            candidates = [(g["river"].distance(pt), rid) for rid, g in river_geoms.items() if g["corridor"].contains(pt)]
        if not candidates:
            continue
        basin = min(candidates)[1]
        name = tags.get("name:en") or tags.get("name") or f"Unnamed {kind}"
        props = {"id": f"osm_{el['type'][0]}{el['id']}", "name": name, "type": kind, "basin": basin, "source": "OpenStreetMap"}
        if "beds" in tags and tags["beds"].isdigit():
            props["capacity_beds"] = int(tags["beds"])
        features.append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]}})

    # Hand-curated relief shelters (with capacities) have no OSM equivalent; keep them.
    impact_path = DATA / "impact_layer.geojson"
    existing = json.loads(impact_path.read_text(encoding="utf-8"))["features"] if impact_path.exists() else []
    curated = [
        {**f, "properties": {**f["properties"], "source": "curated"}}
        for f in existing
        if f["properties"].get("source", "curated") == "curated" and f["properties"]["type"] == "shelter"
    ]

    counts: dict[str, int] = {}
    for f in features + curated:
        counts[f["properties"]["type"]] = counts.get(f["properties"]["type"], 0) + 1
    impact_path.write_text(
        json.dumps({
            "type": "FeatureCollection",
            "note": "Critical infrastructure near modelled rivers. OpenStreetMap (ODbL) plus curated relief shelters. Built by scripts/build_flood_grids.py.",
            "features": features + curated,
        }),
        encoding="utf-8",
    )
    print(f"assets: {counts}")


def main(only: list[str]) -> None:
    TERRAIN_OUT.mkdir(parents=True, exist_ok=True)
    RAW_OSM.mkdir(exist_ok=True)

    kerala = shape(json.loads((DATA / "kerala_boundary.geojson").read_text(encoding="utf-8"))["features"][0]["geometry"])
    rivers = json.loads((DATA / "kerala_rivers.geojson").read_text(encoding="utf-8"))["features"]
    districts = load_districts()
    water_index = load_water()

    manifest_path = TERRAIN_OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {"rivers": {}}

    river_geoms = {}
    for feature in rivers:
        rid = feature["properties"]["id"]
        if only and rid not in only:
            river = shape(feature["geometry"])
            river_geoms[rid] = {"river": river, "corridor": river.buffer(CORRIDOR_DEG).intersection(kerala)}
            continue
        print(f"building {rid} ...")
        result = build_river_grid(feature, kerala, districts, water_index)
        river_geoms[rid] = result
        manifest["rivers"][rid] = {k: v for k, v in result.items() if k not in ("corridor", "river")}

    build_assets(river_geoms)

    manifest.update({
        "model": "rem-v1",
        "built_at": datetime.now(UTC).isoformat(),
        "zoom": ZOOM,
        "corridor_deg": CORRIDOR_DEG,
        "max_rem_m": MAX_REM_M,
        "lateral_attenuation_m_per_km": LATERAL_ATTENUATION_M_PER_KM,
        "sources": {
            "terrain": "AWS Terrain Tiles (SRTM/NASADEM-derived), terrarium z11",
            "permanent_water": "OpenStreetMap natural=water / waterway=riverbank",
            "population": "Census of India 2011 district density",
            "assets": "OpenStreetMap via Overpass",
        },
    })
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1:])
