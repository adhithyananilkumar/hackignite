import asyncio
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

load_dotenv()

from routers import ai, alerts, boundary, dams, flood, forecast, health, hydrology, impact, rivers, sources, weather, ws
from services.sources.hub import hub


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(hub.run())
    yield
    task.cancel()


app = FastAPI(title="VARUNA — Kerala Flood Intelligence", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
# Flood forecasts and the asset layer are large JSON documents.
app.add_middleware(GZipMiddleware, minimum_size=1024)

app.include_router(rivers.router)
app.include_router(dams.router)
app.include_router(boundary.router)
app.include_router(weather.router)
app.include_router(forecast.router)
app.include_router(flood.router)
app.include_router(impact.router)
app.include_router(alerts.router)
app.include_router(ai.router)
app.include_router(health.router)
app.include_router(sources.router)
app.include_router(hydrology.router)
app.include_router(ws.router)


@app.get("/")
def root():
    return {"message": "VARUNA API", "docs": "/docs"}
