"""Ask VARUNA: a Gemini chat that answers with tools over VARUNA's own data.

Gemini decides which tools to call (river/dam status, point flood assessment,
place search, statewide overview); every number it reports comes from a tool
result. Tool calls also become map actions for the dashboard — asking about a
river selects it, asking about a place drops a pin there."""

import asyncio
import json
import os
import re
from pathlib import Path

import httpx

from services.ai_service import _exposure_context, build_context
from services.geocode import search_places
from services.point_risk import RIVER_NAMES, RIVER_PROPS, assess_point, in_kerala, river_points
from services.sources.hub import hub
from services.weather_client import get_point_rain_outlook, imd_category

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
DEFAULT_MODEL = "gemini-flash-latest"
MAX_TOOL_ROUNDS = 5
MAX_HISTORY_TURNS = 12
# Points along each river where basin rain is sampled (fractions of its vertices).
_BASIN_RAIN_SAMPLES = (0.2, 0.5, 0.8)

_DAMS_PATH = Path(__file__).resolve().parent.parent / "data" / "kerala_dams.geojson"
_DAMS = json.loads(_DAMS_PATH.read_text(encoding="utf-8"))["features"]
DAM_NAMES = {f["properties"]["id"]: f["properties"]["name"] for f in _DAMS}

SYSTEM_PROMPT = """You are "Ask VARUNA", the assistant inside VARUNA, a Kerala flood intelligence dashboard with a live map.

How to work:
- Use the tools for every factual answer. Never invent levels, rainfall, probabilities or counts — only report numbers from tool results.
- Asking about a river, dam or place moves the map to it automatically when you call the matching tool, so call it even for simple questions (e.g. "chance of rain in Periyar" -> get_river_status("periyar")).
- For a town, village, address or landmark use assess_place. For the user's pinned point or raw coordinates use assess_coordinates.
- "Chance of rain" = chance_of_rain_24h_pct and rainfall totals from the rain outlook. "Chance of flooding" at a place = the likelihood score/level from the assessment; explain its main driver in plain words and say it is a screening index, not an official forecast.
- If data_source kind is "simulation", say the numbers come from a simulated scenario.
- Be concise and practical: lead with the answer, then 2-4 short bullet points of supporting numbers. Mention the nearest relief shelter when flood likelihood is Moderate or higher.
- Never order dam gate operations or evacuations; frame those as items for KSDMA/KSEB/district authorities. For emergencies tell people to call 112 (or 1077 district control room).
- Reply in the user's language (English or Malayalam).

River ids: {rivers}
Dam ids: {dams}"""

TOOLS = [{
    "functionDeclarations": [
        {
            "name": "get_river_status",
            "description": "Current level, danger/warning levels, risk, 12h level forecast, modelled flood exposure and basin rainfall outlook (chance of rain, mm) for one river. Selects the river on the map.",
            "parameters": {
                "type": "object",
                "properties": {"river_id": {"type": "string", "description": "River id from the list in the instructions"}},
                "required": ["river_id"],
            },
        },
        {
            "name": "get_dam_status",
            "description": "Storage %, inflow/outflow, rule-curve status and risk for one dam. Selects the dam on the map.",
            "parameters": {
                "type": "object",
                "properties": {"dam_id": {"type": "string", "description": "Dam id from the list in the instructions"}},
                "required": ["dam_id"],
            },
        },
        {
            "name": "assess_place",
            "description": "Find a place in Kerala by name (town, village, locality, landmark) and assess its flood likelihood, rain outlook and nearest shelters/hospitals. Drops a pin on the map.",
            "parameters": {
                "type": "object",
                "properties": {"place_name": {"type": "string", "description": "Place name, e.g. 'Aluva' or 'Chengannur railway station'"}},
                "required": ["place_name"],
            },
        },
        {
            "name": "assess_coordinates",
            "description": "Assess flood likelihood, rain outlook and nearest shelters at exact coordinates (e.g. the user's pinned location). Drops a pin on the map.",
            "parameters": {
                "type": "object",
                "properties": {
                    "lat": {"type": "number"},
                    "lon": {"type": "number"},
                    "label": {"type": "string", "description": "Short label for the pin"},
                },
                "required": ["lat", "lon"],
            },
        },
        {
            "name": "kerala_overview",
            "description": "Statewide snapshot: every river's level and risk, dams on watch, sea level at river mouths and reservoir advisories. Use for 'which river is worst', 'overall situation' questions.",
            "parameters": {"type": "object", "properties": {}},
        },
    ]
}]


# ---------------- tools ----------------

async def _basin_rain(river_id: str) -> dict:
    outlooks = [o for o in await asyncio.gather(*(get_point_rain_outlook(lat, lon) for lat, lon in river_points(river_id, _BASIN_RAIN_SAMPLES))) if o.get("available")]
    if not outlooks:
        return {"available": False}
    mean_24 = round(sum(o["next_24h_mm"] for o in outlooks) / len(outlooks), 1)
    return {
        "available": True,
        "source": "Open-Meteo forecast, sampled at points along the river and its gauge",
        "chance_of_rain_24h_pct": max(o["chance_of_rain_24h_pct"] for o in outlooks),
        "basin_mean_next_24h_mm": mean_24,
        "basin_max_next_24h_mm": max(o["next_24h_mm"] for o in outlooks),
        "basin_mean_next_72h_mm": round(sum(o["next_72h_mm"] for o in outlooks) / len(outlooks), 1),
        "imd_category_24h": imd_category(mean_24),
    }


async def get_river_status(river_id: str) -> tuple[dict, dict | None]:
    river_id = river_id.strip().lower()
    reading = hub.get_river(river_id)
    if reading is None:
        return {"error": f"Unknown river '{river_id}'", "valid_ids": list(RIVER_NAMES)}, None
    props = next(p for p in RIVER_PROPS if p["id"] == river_id)
    result = {
        "river": props["name"],
        "gauge_town": props.get("gauge_town"),
        "data_source": {"mode": hub.active.label, "kind": hub.active.kind},
        "reading": reading.model_dump(mode="json"),
        "level_forecast": [p.model_dump() for p in hub.level_forecast(reading, (1.0, 3.0, 6.0, 12.0))],
        "danger_crossing_hours": hub.danger_crossing_hours(reading),
        "flood_exposure": _exposure_context(river_id),
        "dams_on_river": [
            {"dam_id": f["properties"]["id"], "name": f["properties"]["name"], "risk": d.risk.value, "storage_pct": d.storage_pct}
            for f in _DAMS
            if f["properties"].get("river", "").lower() == props["name"].lower() and (d := hub.get_dam(f["properties"]["id"]))
        ],
        "rain_outlook": await _basin_rain(river_id),
    }
    return result, {"type": "select_river", "id": river_id}


async def get_dam_status(dam_id: str) -> tuple[dict, dict | None]:
    dam_id = dam_id.strip().lower()
    reading = hub.get_dam(dam_id)
    feature = next((f for f in _DAMS if f["properties"]["id"] == dam_id), None)
    if reading is None or feature is None:
        return {"error": f"Unknown dam '{dam_id}'", "valid_ids": list(DAM_NAMES)}, None
    lon, lat = feature["geometry"]["coordinates"]
    return {
        "dam": feature["properties"],
        "data_source": {"mode": hub.active.label, "kind": hub.active.kind},
        "reading": reading.model_dump(mode="json"),
        "rain_outlook_at_dam": await get_point_rain_outlook(lat, lon),
    }, {"type": "select_dam", "id": dam_id}


async def assess_coordinates(lat: float, lon: float, label: str | None = None) -> tuple[dict, dict | None]:
    if not in_kerala(lat, lon):
        return {"error": "Those coordinates are outside Kerala; VARUNA only covers Kerala."}, None
    result = await assess_point(lat, lon)
    label = label or "Pinned location"
    return {"place": label, **result}, {"type": "pin", "lat": lat, "lon": lon, "label": label, "assessment": result}


async def assess_place(place_name: str) -> tuple[dict, dict | None]:
    matches = await search_places(place_name, limit=3)
    if not matches:
        return {"error": f"Could not find '{place_name}' in Kerala. Ask the user for a nearby town or to drop a pin."}, None
    top = matches[0]
    result, action = await assess_coordinates(top["lat"], top["lon"], top["name"])
    result["matched_place"] = f"{top['name']}, {top['detail']}"
    if len(matches) > 1:
        result["other_matches"] = [f"{m['name']}, {m['detail']}" for m in matches[1:]]
    return result, action


async def kerala_overview() -> tuple[dict, dict | None]:
    return await build_context(), {"type": "overview"}


async def run_tool(name: str, args: dict) -> tuple[dict, dict | None]:
    try:
        if name == "get_river_status":
            return await get_river_status(str(args.get("river_id", "")))
        if name == "get_dam_status":
            return await get_dam_status(str(args.get("dam_id", "")))
        if name == "assess_place":
            return await assess_place(str(args.get("place_name", "")))
        if name == "assess_coordinates":
            return await assess_coordinates(float(args["lat"]), float(args["lon"]), args.get("label"))
        if name == "kerala_overview":
            return await kerala_overview()
    except (KeyError, TypeError, ValueError) as exc:
        return {"error": f"Bad arguments for {name}: {exc}"}, None
    return {"error": f"Unknown tool {name}"}, None


# ---------------- chat ----------------

def _ui_context(ui: dict | None) -> str:
    if not ui:
        return ""
    lines = []
    if pin := ui.get("pin"):
        lines.append(f"The user has a pin dropped at lat {pin['lat']:.5f}, lon {pin['lon']:.5f} ({pin.get('label') or 'unnamed point'}). \"Here\", \"this place\" or \"my location\" means this pin.")
    if sel := ui.get("selection"):
        lines.append(f"The map currently has the {sel['type']} '{sel['id']}' selected.")
    return "\n[Dashboard state]\n" + "\n".join(lines) if lines else ""


async def chat(message: str, history: list[dict], ui: dict | None) -> dict:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return await _offline_chat(message, ui)

    contents = [
        {"role": "model" if t["role"] == "assistant" else "user", "parts": [{"text": t["text"]}]}
        for t in history[-MAX_HISTORY_TURNS:]
        if t.get("text")
    ]
    contents.append({"role": "user", "parts": [{"text": message + _ui_context(ui)}]})
    system = SYSTEM_PROMPT.replace("{rivers}", ", ".join(RIVER_NAMES)).replace("{dams}", ", ".join(DAM_NAMES))
    model = os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL

    actions: list[dict] = []
    steps: list[dict] = []
    async with httpx.AsyncClient(timeout=60.0) as client:
        for _ in range(MAX_TOOL_ROUNDS):
            resp = await client.post(
                GEMINI_URL.format(model=model),
                headers={"x-goog-api-key": api_key},
                json={
                    "systemInstruction": {"parts": [{"text": system}]},
                    "contents": contents,
                    "tools": TOOLS,
                    "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1200},
                },
            )
            if resp.status_code != 200:
                detail = resp.json().get("error", {}).get("message", resp.text[:200]) if resp.headers.get("content-type", "").startswith("application/json") else resp.text[:200]
                return {"answer": f"Gemini request failed ({resp.status_code}): {detail}", "actions": actions, "steps": steps}
            candidate = (resp.json().get("candidates") or [{}])[0]
            content = candidate.get("content") or {"role": "model", "parts": []}
            parts = content.get("parts", [])
            calls = [p["functionCall"] for p in parts if "functionCall" in p]
            if not calls:
                answer = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
                return {"answer": answer or "I couldn't produce an answer — try rephrasing.", "actions": actions, "steps": steps}

            # Echo the model turn verbatim (it may carry thought signatures),
            # then answer every call in one user turn.
            contents.append(content)
            results = await asyncio.gather(*(run_tool(c["name"], c.get("args") or {}) for c in calls))
            responses = []
            for call, (result, action) in zip(calls, results):
                steps.append({"tool": call["name"], "args": call.get("args") or {}, "ok": "error" not in result})
                if action:
                    actions.append(action)
                response = {"name": call["name"], "response": result}
                if "id" in call:
                    response["id"] = call["id"]
                responses.append({"functionResponse": response})
            contents.append({"role": "user", "parts": responses})

    return {"answer": "That needed too many lookups — try a more specific question.", "actions": actions, "steps": steps}


# ---------------- offline fallback (no GEMINI_API_KEY) ----------------

def _mentioned(message: str, names: dict[str, str]) -> str | None:
    text = message.lower()
    for id_, name in names.items():
        base = re.sub(r"\s+(dam|river)$", "", name.lower())
        if re.search(rf"\b({re.escape(id_)}|{re.escape(base)})\b", text):
            return id_
    return None


async def _offline_chat(message: str, ui: dict | None) -> dict:
    note = "_Offline mode — set GEMINI_API_KEY for full answers._\n\n"
    pin = (ui or {}).get("pin")
    if river_id := _mentioned(message, RIVER_NAMES):
        result, action = await get_river_status(river_id)
        r, rain = result["reading"], result["rain_outlook"]
        text = (
            f"**{result['river']}** is at **{r['level_m']} m** (danger {r['danger_level_m']} m), risk **{r['risk']}**, "
            f"changing {r['rise_rate_m_per_hr']} m/hr."
        )
        if rain.get("available"):
            text += f"\n- Chance of rain next 24h: **{rain['chance_of_rain_24h_pct']}%**, basin mean {rain['basin_mean_next_24h_mm']} mm ({rain['imd_category_24h']})."
        return {"answer": note + text, "actions": [action], "steps": [{"tool": "get_river_status", "args": {"river_id": river_id}, "ok": True}]}
    if dam_id := _mentioned(message, DAM_NAMES):
        result, action = await get_dam_status(dam_id)
        d = result["reading"]
        text = f"**{result['dam']['name']}**: {d['storage_pct']}% storage, inflow {d['inflow_m3s']} m³/s, outflow {d['outflow_m3s']} m³/s, risk **{d['risk']}**."
        return {"answer": note + text, "actions": [action], "steps": [{"tool": "get_dam_status", "args": {"dam_id": dam_id}, "ok": True}]}
    if pin:
        result, action = await assess_coordinates(pin["lat"], pin["lon"], pin.get("label"))
        lk, rain = result["likelihood"], result["rain"]
        text = f"Flood likelihood at **{result['place']}**: **{lk['level']} ({lk['score']}/100)** — {lk['driver']}."
        if rain.get("available"):
            text += f"\n- Chance of rain next 24h: {rain['chance_of_rain_24h_pct']}%, {rain['next_24h_mm']} mm expected."
        return {"answer": note + text, "actions": [action], "steps": [{"tool": "assess_coordinates", "args": pin, "ok": True}]}
    context, action = await kerala_overview()
    worst = max(context["rivers"].items(), key=lambda kv: kv[1]["current_m"] / kv[1]["danger_m"])
    text = f"Highest-risk river right now is **{RIVER_NAMES.get(worst[0], worst[0])}** at {worst[1]['current_m']} m of {worst[1]['danger_m']} m danger (risk {worst[1]['risk']})."
    return {"answer": note + text, "actions": [{"type": "select_river", "id": worst[0]}], "steps": [{"tool": "kerala_overview", "args": {}, "ok": True}]}
