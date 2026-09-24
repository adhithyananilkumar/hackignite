import json
from pathlib import Path

from shapely.geometry import LineString, mapping
from shapely.ops import linemerge, polygonize, unary_union

RAW = Path(__file__).parent
DATA = Path(__file__).parent.parent / "data"

# ---------- Kerala boundary ----------
boundary_raw = json.loads((RAW / "boundary.json").read_text(encoding="utf-8"))
relation = boundary_raw["elements"][0]

outer_lines = []
for m in relation["members"]:
    if m["type"] != "way" or m["role"] != "outer":
        continue
    geom = m.get("geometry")
    if not geom or len(geom) < 2:
        continue
    outer_lines.append(LineString([(pt["lon"], pt["lat"]) for pt in geom]))

merged = linemerge(outer_lines)
polys = list(polygonize(merged))
polys.sort(key=lambda p: p.area, reverse=True)
mainland = polys[0]
mainland = mainland.simplify(0.0015, preserve_topology=True)

boundary_geojson = {
    "type": "FeatureCollection",
    "note": "Kerala state boundary derived from OpenStreetMap (relation 2018151), simplified for map rendering.",
    "features": [
        {
            "type": "Feature",
            "properties": {"id": "kerala", "name": "Kerala", "source": "OpenStreetMap"},
            "geometry": mapping(mainland),
        }
    ],
}
(DATA / "kerala_boundary.geojson").write_text(json.dumps(boundary_geojson), encoding="utf-8")
print("boundary polygon points:", len(mainland.exterior.coords))
print("boundary bbox:", mainland.bounds)

# ---------- Rivers ----------
RIVER_NAME_WHITELIST = {
    "periyar": {"Periyar", "Periyar River", "Periyar river", "periyar river"},
    "bharathapuzha": {"Bharathapuzha", "BHARATHAPUZHA"},
    "pamba": {"Pamba", "Pamba River"},
    "chaliyar": {"Chaliyar River", "Chaliyar river"},
    "chalakudy": {"Chalakudy River"},
    "achankovil": {"Achankovil", "joining achankovil", "distributory of achankovil"},
    "kabini": {"Kabini"},
    "valapattanam": {"Valapattanam"},
}

# Preserve existing properties (featured flag, gauge town/coords) from the current file.
existing = json.loads((DATA / "kerala_rivers.geojson").read_text(encoding="utf-8"))
existing_props = {f["properties"]["id"]: f["properties"] for f in existing["features"]}

rivers_raw = json.loads((RAW / "rivers.json").read_text(encoding="utf-8"))
ways_by_river: dict[str, list[LineString]] = {k: [] for k in RIVER_NAME_WHITELIST}

for el in rivers_raw["elements"]:
    if el["type"] != "way":
        continue
    name = el.get("tags", {}).get("name")
    geom = el.get("geometry")
    if not geom or len(geom) < 2:
        continue
    for river_id, names in RIVER_NAME_WHITELIST.items():
        if name in names:
            ways_by_river[river_id].append(LineString([(pt["lon"], pt["lat"]) for pt in geom]))
            break

features = []
for river_id, lines in ways_by_river.items():
    props = dict(existing_props[river_id])
    if not lines:
        # No OSM match — keep the previous hand-drawn approximation.
        old_feature = next(f for f in existing["features"] if f["properties"]["id"] == river_id)
        features.append(old_feature)
        print(river_id, "-> kept hand-drawn fallback (0 OSM ways)")
        continue
    merged_river = linemerge(lines)
    simplified = merged_river.simplify(0.0006, preserve_topology=True)
    features.append({
        "type": "Feature",
        "properties": {**props, "source": "OpenStreetMap"},
        "geometry": mapping(simplified),
    })
    n_points = len(simplified.coords) if simplified.geom_type == "LineString" else sum(len(g.coords) for g in simplified.geoms)
    print(river_id, "->", simplified.geom_type, "ways:", len(lines), "points:", n_points)

rivers_geojson = {
    "type": "FeatureCollection",
    "note": "River courses derived from OpenStreetMap waterway data where available; simplified for map rendering. Rivers without a clean OSM match keep a hand-approximated course.",
    "features": features,
}
(DATA / "kerala_rivers.geojson").write_text(json.dumps(rivers_geojson), encoding="utf-8")
print("done")
