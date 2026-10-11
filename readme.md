<h1 align="center">🌊 VARUNA</h1>
<p align="center"><b>Kerala Flood Intelligence System</b><br>
Built at <b>HackIgnite'26</b> · IEDC GPTC Pala</p>

---

> In 2018, the warnings about Kerala's floods already existed. They just weren't connected.

Rainfall forecasts, river levels, dam storage and tides all live in different places. In August 2018 the rivers rose while the dams were nearly full, and high tide at the coast stopped floodwater from draining into the sea — it backed up into Kuttanad instead.

**VARUNA puts all of those signals on one live map and answers one question: who will be underwater in the next few hours?**

## What it does

| | Feature | Details |
|---|---|---|
| 🏞️ | **River monitoring** | 21 rivers (Periyar, Pamba, Bharathapuzha, Chaliyar, Chalakudy, Meenachil, …). Live discharge from Copernicus GloFAS, calibrated per gauge on 1984–2023 history (2‑ and 5‑year return flows). Five risk levels and a "hours until danger level" estimate. |
| 🗺️ | **Flood extent forecast** | Which areas flood, and how deep, at 0 / 3 / 6 / 12 hours. Relative-elevation model on SRTM/NASADEM terrain (~75 m cells, 2M+ cells across river corridors home to ~1 crore people). |
| 🏥 | **Impact** | 15,647 mapped assets from OpenStreetMap — 11,284 schools, 3,766 hospitals, 561 bridges, 36 relief shelters — checked against the flood extent. |
| 🏗️ | **Dams & reservoirs** | 44 dams incl. Idukki and Mullaperiyar. 72‑hour storage outlook under median and worst‑case inflow, downstream headroom, and latest time to start a controlled pre‑release. |
| 🌕 | **Sea level & tides** | Hourly sea level (tide + storm surge) at 9 river mouths, Kasaragod → Thiruvananthapuram. Flags **backwater risk** when high tide meets a swollen river, and finds low‑tide windows for draining released water. |
| ⛰️ | **Landslide early warning** | 8 hotspots (Mundakkai–Chooralmala, Puthumala, Kavalappara, Pettimudi, …). 24 h / 72 h rain + soil moisture + ground sensors → Green / Yellow / Orange / Red. |
| 🌧️ | **Point check** | Search any place in Kerala or drop a pin: rain outlook (IMD categories), flood likelihood with its main driver, nearest shelter and hospital. |
| 🤖 | **Ask VARUNA** | Gemini assistant (English / Malayalam) that answers only from VARUNA's own data via tool calls, and moves the map to whatever you ask about. |
| 🔁 | **Scenarios** | Replay a 2018‑style statewide flood, a monsoon surge or a steady monsoon to stress‑test the whole pipeline. |

### Data sources

| Source | Used for | Status |
|---|---|---|
| Copernicus GloFAS (via Open‑Meteo Flood API) | River discharge, dam inflow | Live, key‑free |
| Open‑Meteo forecast (ECMWF / GFS) | Rainfall, soil moisture | Live, key‑free |
| Copernicus Marine (via Open‑Meteo Marine API) | Sea level, tide, surge | Live, key‑free |
| OpenStreetMap (Overpass, Nominatim) | Rivers, assets, place search | Pre‑built + live search |
| AWS Terrain Tiles (SRTM / NASADEM) | Terrain for flood model | Pre‑built (`backend/data/terrain`) |
| Census of India 2011 | Population density | Pre‑built |
| Google Gemini | Ask VARUNA chat | Needs `GEMINI_API_KEY` |
| CWC gauges, KSEB telemetry, ISRO MOSDAC | — | Shown as *not connected* (need agreements) |

### Honest limits

- The flood extent is a **screening model**, not a hydrodynamic simulation — it is labelled "modelled" in the UI.
- Landslide **ground sensors are simulated** (no public telemetry exists); a real node plugs in without changing the alert logic.
- The app starts in **Simulation** mode; switch to **Live** from the data‑source switcher. Simulated data is always labelled.
- VARUNA is **decision support only**. It never orders dam gate operations or evacuations — those belong to KSDMA, KSEB and district authorities.

## Tech stack

**Backend:** Python · FastAPI · NumPy · Shapely · Pillow · httpx · WebSockets
**Frontend:** Next.js 16 · React 19 · TypeScript · Tailwind CSS
**AI:** Google Gemini (function calling)

```
hackignite/
├── backend/
│   ├── main.py              # FastAPI app
│   ├── routers/             # REST + WebSocket endpoints
│   ├── services/            # flood model, dams, coastal, landslide, chat, data sources
│   ├── data/                # rivers, dams, gauges, assets, scenarios, terrain grids
│   └── scripts/             # offline builders for terrain / river data
├── frontend/
│   └── app/                 # Next.js dashboard (/) and command view (/command)
├── run.bat                  # start both services (Windows CMD)
└── run.ps1                  # start both services (PowerShell)
```

## Getting started

### Prerequisites

- **Python 3.11+**
- **Node.js 20+** and npm
- Internet access (live data feeds are fetched at runtime)
- *Optional:* a [Gemini API key](https://aistudio.google.com/apikey) for the Ask VARUNA chat

### 1. Clone

```bash
git clone https://github.com/adhithyananilkumar/hackignite.git
cd hackignite
```

### 2. Backend setup

```bash
cd backend
python -m venv .venv
```

Activate the virtual environment:

```bash
# Windows (PowerShell)
.venv\Scripts\Activate.ps1
# Windows (CMD)
.venv\Scripts\activate.bat
# macOS / Linux
source .venv/bin/activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create `backend/.env` (optional — everything except the chat works without it):

```env
GEMINI_API_KEY=your-gemini-key
# GEMINI_MODEL=gemini-flash-latest
```

### 3. Frontend setup

```bash
cd frontend
npm install
```

The frontend talks to `http://localhost:8000` by default. To point it elsewhere, create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

### 4. Run

**Quick start (Windows)** — launches backend and frontend in separate windows:

- Double‑click `run.bat`, or
- In PowerShell: `.\run.ps1`

**Or run each service manually:**

```bash
# Terminal 1 — backend
cd backend
.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
# (macOS / Linux: .venv/bin/python -m uvicorn main:app --reload --port 8000)
```

```bash
# Terminal 2 — frontend
cd frontend
npm run dev
```

### 5. Open

| URL | What |
|---|---|
| http://localhost:3000 | Main dashboard |
| http://localhost:3000/command | Command center view |
| http://127.0.0.1:8000/docs | Interactive API docs (Swagger) |
| http://127.0.0.1:8000/health | Data source health |

> The first switch to **Live** mode calibrates every gauge against 40 years of GloFAS history, which takes a minute or two. Results are cached in `backend/.cache/`, so later starts are fast.

## API overview

| Endpoint | Purpose |
|---|---|
| `GET /rivers`, `GET /rivers/{id}` | River levels and risk |
| `GET /dams`, `GET /dams/{id}` | Dam storage and risk |
| `GET /flood/forecast` | Flood extent + exposure per horizon |
| `GET /flood/{version}/tiles/{z}/{x}/{y}.png` | Flood depth map tiles |
| `GET /impact/{basin_id}` | People and assets affected |
| `GET /coastal` | Sea level, tides, backwater risk |
| `GET /landslide` | Landslide alerts per hotspot |
| `GET /reservoirs/{dam_id}/outlook` | 72 h reservoir outlook and pre‑release advisory |
| `GET /locate/search`, `GET /locate/assess` | Place search and point flood check |
| `GET /alerts` | Active alerts |
| `POST /chat` | Ask VARUNA |
| `GET /sources`, `POST /sources/mode`, `POST /sources/simulation` | Switch Live / Simulation, control scenarios |
| `WS /ws/live` | Live state stream |

Full schema at `/docs` while the backend is running.

## Rebuilding the flood model (optional)

The terrain grids in `backend/data/terrain/` are committed, so this is only needed when adding a river:

```bash
cd backend
python scripts/build_flood_grids.py            # all rivers
python scripts/build_flood_grids.py periyar    # one river
```

Needs network on first run (AWS Terrain Tiles, OpenStreetMap Overpass).

---

<p align="center"><i>We can't stop the rain. But we can make sure the warning arrives in time.</i></p>
