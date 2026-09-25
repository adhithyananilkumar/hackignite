"""Flood forecast: joins each river's current reading and level forecast (from
whichever data source the hub has active) to the flood-extent model, producing
extent tiles and exposure per horizon."""

from datetime import UTC, datetime

from models import (
    DepthBand,
    ExposedAsset,
    FloodForecast,
    FloodHorizon,
    ImpactSummary,
    RiverFloodForecast,
    RiverReading,
)
from services.flood_model import DEPTH_BANDS, MODEL_LABEL, flood_model
from services.sources.hub import hub

FLOOD_HORIZONS_HR = (0.0, 3.0, 6.0, 12.0)
_ASSET_TYPES = ("hospital", "school", "shelter", "bridge")


def encode_stages(stages: dict[str, int]) -> str:
    return ",".join(f"{rid}.{dm}" for rid, dm in sorted(stages.items()))


def decode_stages(encoded: str) -> tuple[tuple[str, int], ...]:
    pairs = []
    for part in filter(None, encoded.split(",")):
        rid, _, dm = part.rpartition(".")
        pairs.append((rid, int(dm)))
    return tuple(sorted(pairs))


def _tile_template(stages: dict[str, int]) -> str | None:
    flooding = {rid: dm for rid, dm in stages.items() if dm > 0}
    if not flooding:
        return None
    return f"/flood/{flood_model.version}/tiles/{{z}}/{{x}}/{{y}}.png?s={encode_stages(flooding)}"


def _river_forecast(reading: RiverReading) -> RiverFloodForecast:
    points = hub.level_forecast(reading, FLOOD_HORIZONS_HR)
    horizons = []
    for point in points:
        # Quantise the level once so the reported level, stage and extent all agree.
        stage_dm = flood_model.quantise(point.level_m - reading.danger_level_m)
        extent = flood_model.summary(reading.river_id, stage_dm)
        counts = {t: 0 for t in _ASSET_TYPES}
        for asset in extent.assets:
            counts[asset.type] = counts.get(asset.type, 0) + 1
        horizons.append(FloodHorizon(
            horizon_hours=point.horizon_hours,
            level_m=round(reading.danger_level_m + stage_dm / 10, 2),
            stage_m=stage_dm / 10,
            confidence_pct=point.confidence_pct,
            flooded_area_km2=extent.area_km2,
            max_depth_m=extent.max_depth_m,
            population=extent.population,
            hospitals=counts["hospital"],
            schools=counts["school"],
            shelters=counts["shelter"],
            bridges=counts["bridge"],
            exposed_assets=[ExposedAsset(**vars(a)) for a in extent.assets],
        ))
    return RiverFloodForecast(river_id=reading.river_id, danger_level_m=reading.danger_level_m, horizons=horizons)


def build_flood_forecast(river_ids: set[str] | None = None) -> FloodForecast:
    rivers, unmodelled = [], []
    for reading in hub.list_rivers():
        if river_ids and reading.river_id not in river_ids:
            continue
        if flood_model.has_river(reading.river_id):
            rivers.append(_river_forecast(reading))
        else:
            unmodelled.append(reading.river_id)
    horizon_tiles = [
        _tile_template({r.river_id: flood_model.quantise(r.horizons[i].stage_m) for r in rivers})
        for i in range(len(FLOOD_HORIZONS_HR))
    ]
    return FloodForecast(
        model=flood_model.version,
        model_label=MODEL_LABEL,
        generated_at=datetime.now(UTC).isoformat(),
        horizons_hours=list(FLOOD_HORIZONS_HR),
        horizon_tiles=horizon_tiles,
        depth_bands=[DepthBand(min_m=m, color=f"rgba({r},{g},{b},{a / 255:.2f})") for m, (r, g, b, a) in DEPTH_BANDS],
        rivers=rivers,
        unmodelled_rivers=unmodelled,
    )


def impact_at(river_id: str, horizon_hours: float) -> ImpactSummary | None:
    reading = hub.get_river(river_id)
    if reading is None or not flood_model.has_river(river_id):
        return None
    horizon = min(
        _river_forecast(reading).horizons,
        key=lambda h: abs(h.horizon_hours - horizon_hours),
    )
    return ImpactSummary(
        basin_id=river_id,
        horizon_hours=horizon.horizon_hours,
        flooded_area_km2=horizon.flooded_area_km2,
        population=horizon.population,
        hospitals=horizon.hospitals,
        schools=horizon.schools,
        shelters=horizon.shelters,
        bridges=horizon.bridges,
        model=flood_model.version,
    )
