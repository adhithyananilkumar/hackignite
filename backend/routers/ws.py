import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from services.sources.hub import hub

router = APIRouter(tags=["ws"])


@router.websocket("/ws/live")
async def live_updates(websocket: WebSocket):
    await websocket.accept()
    queue = hub.subscribe()
    try:
        await websocket.send_json(hub.snapshot())
        while True:
            snap = await queue.get()
            await websocket.send_json(snap)
    except (WebSocketDisconnect, asyncio.CancelledError):
        pass
    finally:
        hub.unsubscribe(queue)
