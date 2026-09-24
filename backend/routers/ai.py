from fastapi import APIRouter
from pydantic import BaseModel

from services.ai_service import ask

router = APIRouter(prefix="/ai", tags=["ai"])


class AskRequest(BaseModel):
    question: str


@router.post("/ask")
async def ask_ai(request: AskRequest):
    return await ask(request.question)
