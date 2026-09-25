"""Build data/kerala_rivers.geojson (and register gauges) from data/river_catalog.json.

Run from backend/:
    python scripts/build_rivers.py
    python scripts/build_flood_grids.py <new river ids...>

For each catalog river, OpenStreetMap waterway=river ways whose name matches
`osm_names` are merged into one course. The mouth is the lower-elevation end of
the longest merged part (terrain tiles); a reference gauge point is placed
upstream of it. Existing gauges in data/gauges.json are never overwritten —
only rivers without one get an auto-placed reference point.
"""

import json
import math
import re

import numpy as np
from shapely.geometry import LineString, MultiLineString, mapping
from shapely.ops import linemerge

from build_flood_grids import DATA, KERALA_RELATION, TILE, ZOOM, fetch_tile, lonlat_to_px, overpass

GAUGE_KM_ABOVE_MOUTH = 25.0
GAUGE_MAX_FRACTION = 0.3  # short rivers: at most 30% of the way up
KM_PER_DEG = 108.0
DEFAULT_THRESHOLDS = {"normal_m": 1.2, "warning_m": 3.0, "danger_m": 3.8}


def norm(name: str) -> str:
    name = re.sub(r"\b(river|rive|r\.)\b", "", name.lower())
    return re.sub(r"\s+", " ", name).strip()


def elevation(lon: float, lat: float) -> float:
    x, y = lonlat_to_px(lon, lat)
    tile = fetch_tile(int(x // TILE), int(y // TILE))
    return float(tile[int(y % TILE), int(x % TILE)])


def main() -> None:
    catalog = json.loads((DATA / "river_catalog.json").read_text(encoding="utf-8"))["rivers"]
    query = f"""[out:json][timeout:300];
rel({KERALA_RELATION});map_to_area->.k;
way["waterway"="river"]["name"](area.k);
out geom;"""
    ways = overpass(query, "all_rivers.json")["elements"]

    gauges_path = DATA / "gauges.json"
    gauges_doc = json.loads(gauges_path.read_text(encoding="utf-8"))
    gauges = gauges_doc["gauges"]

    features = []
    for entry in catalog:
        wanted = {norm(n) for n in entry["osm_names"]}
        lines = [
            LineString([(p["lon"], p["lat"]) for p in w["geometry"]])
            for w in ways
            if len(w.get("geometry") or []) >= 2
            and norm(w["tags"].get("name:en") or w["tags"]["name"]) in wanted
        ]
        if not lines:
            print(f"  {entry['id']}: no OSM ways matched {entry['osm_names']} — skipped")
            continue
        merged = linemerge(lines)
        parts = list(merged.geoms) if isinstance(merged, MultiLineString) else [merged]
        main_part = max(parts, key=lambda p: p.length)

        # Orient the main stem mouth -> source using terrain.
        start, end = main_part.coords[0], main_part.coords[-1]
        if elevation(*start) > elevation(*end):
            main_part = LineString(list(main_part.coords)[::-1])
        length_km = main_part.length * KM_PER_DEG
        gauge_km = min(GAUGE_KM_ABOVE_MOUTH, GAUGE_MAX_FRACTION * length_km)
        gauge_pt = main_part.interpolate(gauge_km / KM_PER_DEG)
        gauge_xy = [round(gauge_pt.x, 4), round(gauge_pt.y, 4)]

        if entry["id"] not in gauges:
            gauges[entry["id"]] = {
                "name": f"Reference point, {gauge_km:.0f} km above mouth",
                "coordinates": gauge_xy,
                "reference": "auto",
                **DEFAULT_THRESHOLDS,
            }
        gauge = gauges[entry["id"]]

        simplified = merged.simplify(0.0006, preserve_topology=True)
        features.append({
            "type": "Feature",
            "properties": {
                "id": entry["id"],
                "name": entry["name"],
                "featured": entry.get("featured", False),
                "gauge_town": gauge["name"],
                "gauge_coordinates": gauge["coordinates"],
                "outlet": entry.get("outlet"),
                "length_km": round(sum(p.length for p in parts) * KM_PER_DEG, 1),
                "source": "OpenStreetMap",
            },
            "geometry": mapping(simplified),
        })
        print(f"  {entry['id']}: {len(lines)} ways, main stem {length_km:.0f} km, gauge {gauge['name']} @ {gauge['coordinates']}")

    (DATA / "kerala_rivers.geojson").write_text(
        json.dumps({
            "type": "FeatureCollection",
            "note": "River courses from OpenStreetMap (ODbL), built by scripts/build_rivers.py from data/river_catalog.json.",
            "features": features,
        }),
        encoding="utf-8",
    )
    gauges_path.write_text(json.dumps(gauges_doc, indent=2), encoding="utf-8")
    print(f"{len(features)} rivers written")


if __name__ == "__main__":
    main()
