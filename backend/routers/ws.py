import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.simulator import simulator

router = APIRouter(tags=["ws"])


@router.websocket("/ws/live")
async def live_updates(websocket: WebSocket):
    await websocket.accept()
    queue = simulator.subscribe()
    try:
        await websocket.send_json(simulator.snapshot())
        while True:
            snap = await queue.get()
            await websocket.send_json(snap)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        simulator.unsubscribe(queue)
