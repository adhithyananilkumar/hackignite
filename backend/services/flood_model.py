"""Flood-extent model: forecast river stage -> inundated cells, water depth, and
the people/assets inside them.

Model `rem-v1` is a relative elevation model built offline per river by
scripts/build_flood_grids.py. A cell floods at stage S (metres above the river's
danger level) when a connected path from the channel reaches it below S
(`fill <= S`); water depth there is S minus the cell's height above the river.

It is a screening model, not a hydrodynamic one: one stage per river, no flow
routing, no embankments, permanent water bodies not masked. Everything it
produces is labelled "modelled". A calibrated basin model or an observed
(satellite) extent plugs in by exposing the same summary/png/polygons methods.

Outputs are keyed by (river, stage in decimetres), so they are deterministic and
cacheable: the map fetches extents as immutable XYZ tiles (all rivers composited
per forecast horizon), and polygons are available as GeoJSON for export.
"""

import hashlib
import io
import json
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np
import shapely
from PIL import Image
from shapely.geometry import mapping

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
TERRAIN_DIR = DATA_DIR / "terrain"
ASSETS_PATH = DATA_DIR / "impact_layer.geojson"

MODEL_ID = "rem-v1"
MODEL_LABEL = "Relative elevation model on SRTM terrain (screening, modelled)"
STAGE_STEP_M = 0.1
SIMPLIFY_DEG = 0.0003  # ~33 m, under half a terrain cell
COORD_PRECISION_DEG = 1e-5
NODATA = np.iinfo(np.uint16).max
TILE_PX = 256


def _empty_tile() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (TILE_PX, TILE_PX), (0, 0, 0, 0)).save(buf, "PNG")
    return buf.getvalue()


EMPTY_TILE = _empty_tile()

# (min depth m, RGBA). Single source of truth for the PNG overlay and the UI legend.
# Saturated blues so floodwater reads clearly against a light basemap and is
# distinct from the pale sea colour.
DEPTH_BANDS = (
    (0.0, (100, 160, 245, 150)),
    (0.5, (52, 120, 235, 175)),
    (1.0, (25, 90, 200, 200)),
    (2.0, (13, 55, 150, 220)),
)


@dataclass(frozen=True)
class ExposedAsset:
    id: str
    name: str
    type: str
    depth_m: float
    lon: float
    lat: float


@dataclass(frozen=True)
class FloodExtent:
    river_id: str
    stage_m: float
    area_km2: float = 0.0
    max_depth_m: float = 0.0
    population: int = 0
    assets: list[ExposedAsset] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return self.area_km2 == 0


def _depth_lut(max_dm: int) -> np.ndarray:
    lut = np.zeros((max_dm + 1, 4), dtype=np.uint8)
    for band_m, rgba in DEPTH_BANDS:
        lut[round(band_m * 10):] = rgba
    return lut


def _polygonize(mask: np.ndarray, lon_edges: np.ndarray, lat_edges: np.ndarray):
    """Raster mask -> one (multi)polygon. Runs of flooded cells in each row become
    rectangles, which are unioned; far fewer shapes than one box per cell."""
    h, w = mask.shape
    padded = np.zeros((h, w + 2), dtype=np.int8)
    padded[:, 1:-1] = mask
    step = np.diff(padded, axis=1)
    rows, starts = np.nonzero(step == 1)
    _, ends = np.nonzero(step == -1)  # row-major order, so starts and ends pair up
    boxes = shapely.box(lon_edges[starts], lat_edges[rows + 1], lon_edges[ends], lat_edges[rows])
    merged = shapely.union_all(boxes)
    return shapely.set_precision(merged.simplify(SIMPLIFY_DEG, preserve_topology=True), COORD_PRECISION_DEG)


class RiverGrid:
    def __init__(self, path: Path, assets: list[dict]):
        with np.load(path) as npz:
            self.rem_dm = npz["rem_dm"].astype(np.int32)
            self.fill_dm = npz["fill_dm"].astype(np.int32)
            self.pop = npz["pop"]
            self.water = npz["water"] if "water" in npz.files else np.zeros(self.rem_dm.shape, dtype=bool)
            zoom, px0, py0 = (int(v) for v in npz["origin"])

        h, w = self.rem_dm.shape
        world = TILE_PX * 2**zoom
        self.zoom, self.px0, self.py0, self.h, self.w = zoom, px0, py0, h, w
        self.lon_edges = (px0 + np.arange(w + 1)) / world * 360 - 180
        self.lat_edges = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (py0 + np.arange(h + 1)) / world))))
        lat_centres = (self.lat_edges[:-1] + self.lat_edges[1:]) / 2
        self.row_km2 = (40075.016686 * np.cos(np.radians(lat_centres)) / world) ** 2

        # Pre-locate every asset that sits on a floodable cell of this grid.
        self.assets: list[dict] = []
        if assets:
            lon = np.array([a["geometry"]["coordinates"][0] for a in assets])
            lat = np.array([a["geometry"]["coordinates"][1] for a in assets])
            col = np.floor((lon + 180) / 360 * world - px0).astype(int)
            lat_r = np.radians(lat)
            row = np.floor((1 - np.log(np.tan(lat_r) + 1 / np.cos(lat_r)) / np.pi) / 2 * world - py0).astype(int)
            inside = (row >= 0) & (row < h) & (col >= 0) & (col < w)
            for i in np.nonzero(inside)[0]:
                if self.fill_dm[row[i], col[i]] != NODATA:
                    self.assets.append({
                        **assets[i]["properties"],
                        "_lon": float(lon[i]),
                        "_lat": float(lat[i]),
                        "_row": int(row[i]),
                        "_col": int(col[i]),
                    })

    def _flood(self, stage_dm: int) -> tuple[np.ndarray, np.ndarray]:
        flooded = (self.fill_dm <= stage_dm) & ~self.water
        depth_dm = np.where(flooded, stage_dm - self.rem_dm, 0)
        return flooded, depth_dm

    def summary(self, river_id: str, stage_dm: int) -> FloodExtent:
        if stage_dm <= 0:
            return FloodExtent(river_id=river_id, stage_m=stage_dm / 10)
        flooded, depth_dm = self._flood(stage_dm)
        assets = [
            ExposedAsset(
                id=a["id"], name=a["name"], type=a["type"],
                depth_m=int(depth_dm[a["_row"], a["_col"]]) / 10, lon=a["_lon"], lat=a["_lat"],
            )
            for a in self.assets
            if flooded[a["_row"], a["_col"]]
        ]
        assets.sort(key=lambda a: -a.depth_m)
        return FloodExtent(
            river_id=river_id,
            stage_m=stage_dm / 10,
            area_km2=round(float((flooded * self.row_km2[:, None]).sum()), 2),
            max_depth_m=int(depth_dm.max()) / 10,
            population=int(round(float(self.pop[flooded].sum()), -1)),
            assets=assets,
        )

    def tile_depth(self, stage_dm: int, z: int, x: int, y: int) -> np.ndarray | None:
        """Water depth (dm) for one web-mercator tile, -1 where dry; None if the
        tile misses this grid. The grid shares the tile pyramid, so sampling is
        exact index arithmetic (nearest neighbour)."""
        scale = 2.0 ** (self.zoom - z)
        offsets = (np.arange(TILE_PX) + 0.5) * scale
        cols = np.floor(x * TILE_PX * scale + offsets).astype(np.int64) - self.px0
        rows = np.floor(y * TILE_PX * scale + offsets).astype(np.int64) - self.py0
        col_ok = (cols >= 0) & (cols < self.w)
        row_ok = (rows >= 0) & (rows < self.h)
        if not col_ok.any() or not row_ok.any():
            return None
        ix = np.ix_(np.clip(rows, 0, self.h - 1), np.clip(cols, 0, self.w - 1))
        flooded = (self.fill_dm[ix] <= stage_dm) & ~self.water[ix] & row_ok[:, None] & col_ok[None, :]
        return np.where(flooded, stage_dm - self.rem_dm[ix], -1)

    def polygons(self, stage_dm: int) -> list[tuple[float, dict]]:
        if stage_dm <= 0:
            return []
        flooded, depth_dm = self._flood(stage_dm)
        out = []
        for band_m, _ in DEPTH_BANDS:
            mask = flooded & (depth_dm >= round(band_m * 10))
            if mask.any():
                out.append((band_m, mapping(_polygonize(mask, self.lon_edges, self.lat_edges))))
        return out


class RemFloodModel:
    def __init__(self, terrain_dir: Path = TERRAIN_DIR, assets_path: Path = ASSETS_PATH):
        self._terrain_dir = terrain_dir
        self._assets_path = assets_path
        self._grids: dict[str, RiverGrid] = {}
        self._assets: list[dict] | None = None
        self._lock = threading.Lock()
        self.manifest = self._load_manifest()
        # Changes whenever grids are rebuilt, so extent URLs can be cached forever.
        fingerprint = f"{self.manifest.get('built_at', '')}|{DEPTH_BANDS}"
        self.version = f"{MODEL_ID}-{hashlib.sha1(fingerprint.encode()).hexdigest()[:8]}"

    def _load_manifest(self) -> dict:
        path = self._terrain_dir / "manifest.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"rivers": {}}

    def has_river(self, river_id: str) -> bool:
        return (self._terrain_dir / f"{river_id}.npz").exists()

    def grid(self, river_id: str) -> RiverGrid | None:
        if river_id in self._grids:
            return self._grids[river_id]
        path = self._terrain_dir / f"{river_id}.npz"
        if not path.exists():
            return None
        with self._lock:
            if river_id not in self._grids:
                if self._assets is None:
                    self._assets = (
                        json.loads(self._assets_path.read_text(encoding="utf-8"))["features"]
                        if self._assets_path.exists()
                        else []
                    )
                self._grids[river_id] = RiverGrid(path, self._assets)
        return self._grids[river_id]

    @staticmethod
    def quantise(stage_m: float) -> int:
        """Stage in decimetres; every output is cached per step."""
        return int(round(stage_m / STAGE_STEP_M))

    @lru_cache(maxsize=2048)
    def summary(self, river_id: str, stage_dm: int) -> FloodExtent | None:
        grid = self.grid(river_id)
        return grid.summary(river_id, stage_dm) if grid else None

    @lru_cache(maxsize=4096)
    def tile_png(self, stages: tuple[tuple[str, int], ...], z: int, x: int, y: int) -> bytes:
        """One map tile compositing every river's extent (deepest water wins where
        corridors overlap), coloured by depth band."""
        depth = np.full((TILE_PX, TILE_PX), -1, dtype=np.int64)
        for river_id, stage_dm in stages:
            grid = self.grid(river_id)
            if grid is None or stage_dm <= 0:
                continue
            river_depth = grid.tile_depth(stage_dm, z, x, y)
            if river_depth is not None:
                np.maximum(depth, river_depth, out=depth)
        if depth.max() < 0:
            return EMPTY_TILE
        rgba = _depth_lut(int(depth.max()))[np.clip(depth, 0, None)]
        rgba[depth < 0] = 0
        buf = io.BytesIO()
        Image.fromarray(rgba, "RGBA").save(buf, "PNG", compress_level=3)
        return buf.getvalue()

    @lru_cache(maxsize=64)
    def polygons(self, river_id: str, stage_dm: int) -> list[tuple[float, dict]] | None:
        grid = self.grid(river_id)
        return grid.polygons(stage_dm) if grid else None


flood_model = RemFloodModel()
