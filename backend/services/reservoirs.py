"""Reservoir outlook and pre-release advisory (decision support only).

For a dam this projects storage over the next 72 h under a median and a
worst-case inflow forecast, and — if the worst case would push storage past the
indicative upper rule level — estimates the extra controlled release that would
avoid it, how much of that the downstream river can take before reaching its
warning flow, the latest time to start, and the low-tide windows at the river
mouth when released water drains to sea most freely.

It never instructs a gate operation. Releases are decided by the dam owner
(KSEB / Irrigation) and the Dam Safety Authority under the approved rule curves
and Emergency Action Plans; this is input to that review.
"""

import json
from datetime import UTC, datetime, timedelta

import numpy as np
from shapely.geometry import Point, shape

from services.coastal import coastal
from services.glofas import discharge_for_level, glofas, load_calibrations
from services.sources.base import DATA_DIR
from services.sources.hub import hub

HORIZON_H = 72
STEP_H = 1
WATCH_PCT = 85.0
UPPER_RULE_PCT = 92.0  # indicative; real rule curves vary by month and dam
SIM_WORST_FACTOR = 1.3  # scenario inflow uncertainty envelope
NEAREST_RIVER_MAX_DEG = 0.15
DISCLAIMER = (
    "Decision support only. Gate operations are decided by the dam owner and the Dam Safety Authority "
    "under the approved rule curve and Emergency Action Plan."
)


def _load() -> tuple[dict[str, dict], dict[str, dict], dict[str, object]]:
    dams = {
        f["properties"]["id"]: {**f["properties"], "coordinates": f["geometry"]["coordinates"]}
        for f in json.loads((DATA_DIR / "kerala_dams.geojson").read_text(encoding="utf-8"))["features"]
    }
    catalog = {r["id"]: r for r in json.loads((DATA_DIR / "river_catalog.json").read_text(encoding="utf-8"))["rivers"]}
    geoms = {
        f["properties"]["id"]: shape(f["geometry"])
        for f in json.loads((DATA_DIR / "kerala_rivers.geojson").read_text(encoding="utf-8"))["features"]
    }
    return dams, catalog, geoms


def _downstream_river(dam: dict, catalog: dict[str, dict], geoms: dict) -> tuple[str | None, str]:
    """River a dam releases into: by name in the dam record, else the nearest modelled river."""
    text = (dam.get("river") or "").lower()
    for rid, entry in catalog.items():
        if any(n in text for n in [entry["name"].lower().split(" (")[0], *entry["osm_names"]]):
            return rid, "named"
    pt = Point(dam["coordinates"])
    rid, dist = min(((rid, g.distance(pt)) for rid, g in geoms.items()), key=lambda x: x[1], default=(None, 1e9))
    return (rid, "nearest") if dist <= NEAREST_RIVER_MAX_DEG else (None, "none")


class ReservoirService:
    def __init__(self) -> None:
        self.dams, self.catalog, self.river_geoms = _load()

    async def _inflow_series(self, dam_id: str, dam: dict) -> tuple[np.ndarray, np.ndarray, str]:
        hours = np.arange(0, HORIZON_H + 1, STEP_H)
        provider = hub.active
        sim = [provider.dam_inflow_forecast(dam_id, float(h)) for h in hours]
        if all(v is not None for v in sim):
            median = np.array(sim, dtype=float)
            return median, median * SIM_WORST_FACTOR, f"Scenario inflow (worst case +{int((SIM_WORST_FACTOR - 1) * 100)}%)"

        lon, lat = dam["coordinates"]
        outlook = await glofas.outlook(f"dam:{dam_id}", lon, lat)
        now = datetime.now(UTC)
        day_hours = np.array([
            (datetime.fromisoformat(d["date"]).replace(tzinfo=UTC, hour=12) - now).total_seconds() / 3600
            for d in outlook["days"]
        ])
        med = np.array([d["median"] if d["median"] is not None else np.nan for d in outlook["days"]], dtype=float)
        worst = np.array([d["max"] if d["max"] is not None else np.nan for d in outlook["days"]], dtype=float)
        ok = ~np.isnan(med) & ~np.isnan(worst)
        return (
            np.interp(hours, day_hours[ok], med[ok]),
            np.interp(hours, day_hours[ok], worst[ok]),
            "GloFAS ensemble at the dam (median / ensemble maximum), estimated natural inflow",
        )

    async def outlook(self, dam_id: str) -> dict | None:
        dam = self.dams.get(dam_id)
        reading = hub.get_dam(dam_id)
        if dam is None or reading is None:
            return None
        river_id, river_link = _downstream_river(dam, self.catalog, self.river_geoms)
        outlet_id = self.catalog.get(river_id, {}).get("outlet") if river_id else None
        now = datetime.now(UTC)

        median_in, worst_in, inflow_source = await self._inflow_series(dam_id, dam)
        capacity = dam.get("capacity_mcm")
        storage_known = reading.source != "static"
        outflow = reading.outflow_m3s if storage_known else None
        worst_volume = float(worst_in[1:].sum() * 3600 * STEP_H / 1e6)

        result = {
            "dam_id": dam_id,
            "name": dam["name"],
            "downstream": {"river_id": river_id, "link": river_link, "outlet_id": outlet_id},
            "inputs": {
                "storage_pct": reading.storage_pct if storage_known else None,
                "capacity_mcm": capacity,
                "outflow_m3s": outflow,
                "storage_source": reading.source,
                "inflow_source": inflow_source,
            },
            "inflow_forecast": [
                {"hours": int(h), "median_m3s": round(float(median_in[h]), 1), "worst_m3s": round(float(worst_in[h]), 1)}
                for h in range(0, HORIZON_H + 1, 6)
            ],
            "worst_case_inflow_72h_mcm": round(worst_volume, 1),
            "worst_case_inflow_72h_pct_of_capacity": round(worst_volume / capacity * 100, 1) if capacity else None,
            "upper_rule_pct": UPPER_RULE_PCT,
            "disclaimer": DISCLAIMER,
        }

        # Downstream capacity: flow at the downstream gauge's warning level (GloFAS 2-yr return flow)
        # minus the flow there now.
        headroom = None
        down = hub.get_river(river_id) if river_id else None
        cal = load_calibrations().get(river_id or "")
        if down and cal:
            q_now = discharge_for_level(cal, down.danger_level_m, down.level_m)
            headroom = max(0.0, cal["q2"] - q_now)
            result["downstream"].update({
                "flow_now_m3s": round(q_now, 1),
                "warning_flow_m3s": round(cal["q2"], 1),
                "headroom_m3s": round(headroom, 1),
                "risk": down.risk.value,
            })

        if outlet_id:
            outlet = await coastal.outlet(outlet_id)
            if outlet:
                result["coast"] = {
                    "outlet": outlet["name"],
                    "drainage": outlet["drainage"],
                    "low_tide_windows": outlet["low_tide_windows"][:4],
                    "high_water_windows": outlet["high_water_windows"][:3],
                }

        if not (storage_known and capacity and outflow is not None):
            missing = [n for n, ok in (("live storage", storage_known), ("capacity", capacity), ("outflow", outflow is not None)) if not ok]
            result.update({
                "status": "INSUFFICIENT_DATA",
                "headline": f"Worst-case inflow over 72 h ≈ {worst_volume:.0f} million m³"
                + (f" ({result['worst_case_inflow_72h_pct_of_capacity']}% of capacity)" if capacity else "")
                + f". Projection needs {', '.join(missing)}.",
            })
            return result

        def project(inflow: np.ndarray) -> np.ndarray:
            volume = reading.storage_pct / 100 * capacity + np.cumsum((inflow - outflow) * 3600 * STEP_H / 1e6)
            volume[0] = reading.storage_pct / 100 * capacity
            return np.clip(volume / capacity * 100, 0, None)

        med_pct, worst_pct = project(median_in), project(worst_in)
        result["projection"] = [
            {"hours": int(h), "median_pct": round(float(med_pct[h]), 1), "worst_pct": round(float(worst_pct[h]), 1)}
            for h in range(0, HORIZON_H + 1, 6)
        ]
        peak_idx = int(np.argmax(worst_pct))
        peak = float(worst_pct[peak_idx])
        full = np.nonzero(worst_pct >= 100)[0]
        result["hours_to_full_worst"] = int(full[0]) if len(full) else None
        result["peak_worst_pct"] = round(peak, 1)

        if peak < WATCH_PCT:
            result.update({"status": "COMFORTABLE", "headline": f"Worst case peaks at {peak:.0f}% storage in 72 h; no pre-release indicated."})
            return result
        if peak <= UPPER_RULE_PCT:
            result.update({"status": "WATCH", "headline": f"Worst case reaches {peak:.0f}% storage; stays under the {UPPER_RULE_PCT:.0f}% upper rule level."})
            return result

        excess_mcm = (peak - UPPER_RULE_PCT) / 100 * capacity
        hours_to_peak = max(peak_idx, 1)
        extra_now = excess_mcm * 1e6 / (hours_to_peak * 3600)
        if headroom and headroom > 0:
            duration_h = excess_mcm * 1e6 / (headroom * 3600)
            latest_start_h = hours_to_peak - duration_h
        else:
            duration_h, latest_start_h = None, None
        fits = headroom is not None and extra_now <= headroom
        rec = {
            "extra_release_if_started_now_m3s": round(extra_now, 1),
            "total_release_if_started_now_m3s": round(outflow + extra_now, 1),
            "volume_to_release_mcm": round(excess_mcm, 1),
            "latest_start": (now + timedelta(hours=latest_start_h)).isoformat() if latest_start_h and latest_start_h > 0 else None,
            "duration_at_downstream_capacity_h": round(duration_h, 1) if duration_h else None,
            "fits_downstream_capacity": fits if headroom is not None else None,
        }
        result["recommendation"] = rec

        if headroom is not None and not fits:
            result.update({
                "status": "CRITICAL",
                "headline": (
                    f"Worst case exceeds the {UPPER_RULE_PCT:.0f}% rule level (peak {peak:.0f}%). The release needed "
                    f"({extra_now:.0f} m³/s extra) is more than the downstream river can take before its warning flow "
                    f"({headroom:.0f} m³/s spare) — early staged release and downstream preparedness should be reviewed now."
                ),
            })
        else:
            when = f" by {datetime.fromisoformat(rec['latest_start']).strftime('%d %b %H:%M UTC')}" if rec["latest_start"] else " now"
            result.update({
                "status": "PRE_RELEASE_REVIEW",
                "headline": (
                    f"Worst case exceeds the {UPPER_RULE_PCT:.0f}% rule level (peak {peak:.0f}% in {hours_to_peak} h). "
                    f"A controlled pre-release of ~{excess_mcm:.0f} million m³ should be reviewed{when}, "
                    f"preferably in low-tide windows at the river mouth."
                ),
            })
        return result

    async def advisories(self) -> list[dict]:
        """Outlooks for dams whose storage the active source actually knows."""
        ids = [d.dam_id for d in hub.list_dams() if d.source != "static" and self.dams.get(d.dam_id, {}).get("capacity_mcm")]
        results = [await self.outlook(i) for i in ids]
        return [r for r in results if r]


reservoirs = ReservoirService()
