from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.gemini_chat import chat

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    text: str


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = []
    # What the dashboard is showing: {"pin": {lat, lon, label}, "selection": {type, id}}
    ui: dict | None = None


@router.post("")
async def ask_varuna(request: ChatRequest):
    return await chat(request.message, [t.model_dump() for t in request.history], request.ui)
