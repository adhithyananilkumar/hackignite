"""AI explanation/Q&A layer. Claude is only ever handed structured numeric context
built from the active data source + flood/impact model — it never invents its own numbers."""

import json
import os

from anthropic import AsyncAnthropic

from models import RiskLevel
from services.flood_forecast import build_flood_forecast
from services.sources.hub import hub

_NAMED_ASSETS_PER_TYPE = 8


def _exposure_context(river_id: str) -> dict:
    """Modelled flood exposure per forecast horizon, with the named hospitals and
    shelters inside the extent so the assistant can answer 'which' questions."""
    forecast = build_flood_forecast({river_id})
    if not forecast.rivers:
        return {"modelled": False}
    horizons = {}
    for h in forecast.rivers[0].horizons:
        named = {}
        for kind in ("hospital", "shelter", "school"):
            assets = [a for a in h.exposed_assets if a.type == kind][:_NAMED_ASSETS_PER_TYPE]
            if assets:
                named[kind] = [{"name": a.name, "depth_m": a.depth_m} for a in assets]
        horizons[f"T+{h.horizon_hours:g}h"] = {
            "flooded_area_km2": h.flooded_area_km2,
            "max_depth_m": h.max_depth_m,
            "population": h.population,
            "hospitals": h.hospitals,
            "schools": h.schools,
            "shelters": h.shelters,
            "bridges": h.bridges,
            "named_exposed_assets": named,
        }
    return {"modelled": True, "model": forecast.model_label, "note": "modelled potential exposure, not confirmed damage", "horizons": horizons}

_client: AsyncAnthropic | None = None
_MODEL = "claude-sonnet-5"

SYSTEM_PROMPT = (
    "You are VARUNA's decision-support assistant for Kerala flood monitoring. "
    "You are given a JSON snapshot of river, dam and exposure data; `data_source` says "
    "whether it is live or a simulated scenario — say so when it is simulated. "
    "Answer only from that JSON — never invent numbers. Be concise, operational, "
    "and do not issue commands to open/close dams; only note when thresholds are "
    "being approached, consistent with Kerala's approved rule curves and EAPs."
)


def _get_client() -> AsyncAnthropic | None:
    global _client
    if _client is None and os.environ.get("ANTHROPIC_API_KEY"):
        _client = AsyncAnthropic()
    return _client


def build_context() -> dict:
    """Every river, but full forecast/exposure detail only for rivers above
    NORMAL, so the prompt stays small as more rivers are added."""
    active = hub.active
    context: dict = {
        "data_source": {"mode": active.label, "kind": active.kind, "note": active.description},
        "rivers": {},
        "dams": {},
        "exposure": {},
    }
    for reading in hub.list_rivers():
        entry = {
            "current_m": reading.level_m,
            "danger_m": reading.danger_level_m,
            "warning_m": reading.warning_level_m,
            "rise_rate_m_per_hr": reading.rise_rate_m_per_hr,
            "risk": reading.risk.value,
        }
        if reading.discharge_m3s is not None:
            entry["discharge_m3s"] = reading.discharge_m3s
        if reading.rain_next_24h_mm is not None:
            entry["rain_past_24h_mm"] = reading.rain_past_24h_mm
            entry["rain_next_24h_mm"] = reading.rain_next_24h_mm
        if reading.risk != RiskLevel.NORMAL:
            entry["forecast"] = [p.model_dump() for p in hub.level_forecast(reading, (1.0, 3.0, 6.0, 12.0))]
            entry["danger_crossing_hours"] = hub.danger_crossing_hours(reading)
            context["exposure"][reading.river_id] = _exposure_context(reading.river_id)
        context["rivers"][reading.river_id] = entry

    for dam in hub.list_dams():
        if dam.risk != RiskLevel.NORMAL or dam.source != "static":
            context["dams"][dam.dam_id] = dam.model_dump(mode="json")

    return context


def _fallback_answer(question: str, context: dict) -> str:
    highest = max(context["rivers"].items(), key=lambda kv: kv[1]["current_m"] / kv[1]["danger_m"], default=(None, None))
    if highest[0] is None:
        return "No live basin data is available right now."
    river_id, data = highest
    return (
        f"[Offline mode — no ANTHROPIC_API_KEY set] Highest-risk basin right now is "
        f"{river_id.title()}: level {data['current_m']}m against a danger level of "
        f"{data['danger_m']}m, risk classified {data['risk']}, rising at "
        f"{data['rise_rate_m_per_hr']} m/hr."
    )


async def ask(question: str) -> dict:
    context = build_context()
    client = _get_client()
    if client is None:
        return {"answer": _fallback_answer(question, context), "context": context}

    message = await client.messages.create(
        model=_MODEL,
        max_tokens=400,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": f"Current state:\n{json.dumps(context)}\n\nQuestion: {question}",
        }],
    )
    answer = "".join(block.text for block in message.content if block.type == "text")
    return {"answer": answer, "context": context}


async def explain_transition(river_id: str, old_risk: str, new_risk: str) -> str:
    context = build_context()
    client = _get_client()
    if client is None:
        data = context["rivers"].get(river_id, {})
        return (
            f"[Offline mode] {river_id.title()} risk moved {old_risk} -> {new_risk}: "
            f"level {data.get('current_m')}m, rising {data.get('rise_rate_m_per_hr')} m/hr."
        )

    message = await client.messages.create(
        model=_MODEL,
        max_tokens=200,
        system=SYSTEM_PROMPT,
        messages=[{
            "role": "user",
            "content": (
                f"River {river_id} risk changed from {old_risk} to {new_risk}. "
                f"Context:\n{json.dumps(context)}\n\nExplain why in 2 sentences."
            ),
        }],
    )
    return "".join(block.text for block in message.content if block.type == "text")
