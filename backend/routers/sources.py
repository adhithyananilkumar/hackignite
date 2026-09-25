from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.sources.hub import hub
from services.sources.simulation import SimulationProvider

router = APIRouter(prefix="/sources", tags=["sources"])


class ModeRequest(BaseModel):
    mode: str


class SimulationRequest(BaseModel):
    scenario_id: str | None = None
    action: str | None = None  # play | pause | restart
    speed: float | None = None


@router.get("")
def get_sources():
    return hub.describe()


@router.post("/mode")
async def set_mode(req: ModeRequest):
    try:
        await hub.set_mode(req.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    return hub.describe()


@router.post("/simulation")
async def control_simulation(req: SimulationRequest):
    sim = hub.provider("simulation")
    assert isinstance(sim, SimulationProvider)
    try:
        sim.control(scenario_id=req.scenario_id, action=req.action, speed=req.speed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from None
    if hub.mode == sim.id:
        await hub.broadcast()
    return hub.describe()
