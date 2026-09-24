"""Static exposure layer: counts of critical-infrastructure points tagged to a basin.
These are modelled potential exposure figures, not confirmed damage."""

import json
from pathlib import Path

from models import ImpactSummary, RiskLevel

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "impact_layer.geojson"

_RISK_ORDER = [RiskLevel.NORMAL, RiskLevel.WATCH, RiskLevel.ADVISORY, RiskLevel.HIGH, RiskLevel.CRITICAL]

_POPULATION_PER_TYPE = {
    "school": "population",
    "shelter": "capacity",
    "hospital": "capacity_beds",
}


def _load_features() -> list[dict]:
    with open(DATA_PATH, encoding="utf-8") as f:
        return json.load(f)["features"]


_FEATURES = _load_features()


def compute_impact(basin_id: str, risk: RiskLevel) -> ImpactSummary:
    risk_index = _RISK_ORDER.index(risk) if risk in _RISK_ORDER else 0
    exposure_fraction = min(1.0, risk_index / (len(_RISK_ORDER) - 1))

    basin_features = [f for f in _FEATURES if f["properties"].get("basin") == basin_id]

    hospitals = sum(1 for f in basin_features if f["properties"]["type"] == "hospital")
    schools = sum(1 for f in basin_features if f["properties"]["type"] == "school")
    shelters = sum(1 for f in basin_features if f["properties"]["type"] == "shelter")
    bridges = sum(1 for f in basin_features if f["properties"]["type"] == "bridge")

    base_population = sum(
        f["properties"].get(_POPULATION_PER_TYPE.get(f["properties"]["type"], ""), 0)
        for f in basin_features
    ) * 40

    exposed_hospitals = hospitals if risk_index >= 2 else 0
    exposed_schools = schools if risk_index >= 2 else 0
    exposed_shelters = shelters if risk_index >= 1 else 0
    exposed_bridges = bridges if risk_index >= 3 else 0
    exposed_population = round(base_population * exposure_fraction)

    return ImpactSummary(
        basin_id=basin_id,
        population=exposed_population,
        hospitals=exposed_hospitals,
        schools=exposed_schools,
        shelters=exposed_shelters,
        bridges=exposed_bridges,
    )
