"""AI explanation/Q&A layer. Claude is only ever handed structured numeric context
built from the simulator + impact engine — it never invents its own numbers."""

import json
import os

from anthropic import AsyncAnthropic

from services.impact_engine import compute_impact
from services.risk_engine import danger_crossing_hours, forecast_river_level
from services.simulator import FEATURED_RIVER_CONFIG, simulator

_client: AsyncAnthropic | None = None
_MODEL = "claude-sonnet-5"

SYSTEM_PROMPT = (
    "You are VARUNA's decision-support assistant for Kerala flood monitoring. "
    "You are given a JSON snapshot of live river, dam and exposure data. "
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
    context: dict = {"rivers": {}, "dams": {}, "exposure": {}}
    for river_id in FEATURED_RIVER_CONFIG:
        reading = simulator.get_river(river_id)
        if reading is None:
            continue
        forecast = forecast_river_level(reading.level_m, reading.rise_rate_m_per_hr)
        crossing = danger_crossing_hours(reading.level_m, reading.danger_level_m, reading.rise_rate_m_per_hr)
        context["rivers"][river_id] = {
            "current_m": reading.level_m,
            "danger_m": reading.danger_level_m,
            "warning_m": reading.warning_level_m,
            "rise_rate_m_per_hr": reading.rise_rate_m_per_hr,
            "risk": reading.risk.value,
            "forecast": [p.model_dump() for p in forecast],
            "danger_crossing_hours": crossing,
        }
        impact = compute_impact(river_id, reading.risk)
        context["exposure"][river_id] = impact.model_dump()

    idukki = simulator.get_dam("idukki")
    if idukki:
        context["dams"]["idukki"] = idukki.model_dump(mode="json")

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
