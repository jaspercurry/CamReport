from __future__ import annotations

import json
import uuid
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from models import CameraSession, AnalysisRequest, SessionCreate, Settings
from analysis import analyze_image, generate_debug_image
from reference_data import get_patches
from watcher import FolderWatcher

BASE_DIR = Path(__file__).resolve().parent.parent
SESSIONS_FILE = BASE_DIR / "sessions.json"

# In-memory state
sessions: Dict[str, CameraSession] = {}
settings = Settings()
connected_ws: List[WebSocket] = []
watcher: Optional[FolderWatcher] = None


def load_sessions():
    if SESSIONS_FILE.exists():
        data = json.loads(SESSIONS_FILE.read_text())
        for s in data.get("sessions", []):
            session = CameraSession(**s)
            sessions[session.id] = session
        stored = data.get("settings")
        if stored:
            global settings
            settings = Settings(**stored)


def save_sessions():
    data = {
        "sessions": [s.dict() for s in sessions.values()],
        "settings": settings.dict(),
    }
    SESSIONS_FILE.write_text(json.dumps(data, indent=2))


async def broadcast(message: dict):
    for ws in list(connected_ws):
        try:
            await ws.send_json(message)
        except Exception:
            connected_ws.remove(ws)


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_sessions()
    screenshots_dir = Path(settings.screenshots_dir).expanduser()
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    global watcher
    watcher = FolderWatcher(str(screenshots_dir), broadcast)
    watcher.start()
    yield
    if watcher:
        watcher.stop()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- WebSocket ---

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_ws.append(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        connected_ws.remove(ws)


# --- Sessions ---

@app.post("/api/sessions")
def create_session(body: SessionCreate):
    session = CameraSession(
        id=str(uuid.uuid4()),
        name=body.name,
        card_type=body.card_type,
    )
    sessions[session.id] = session
    save_sessions()
    return session.dict()


@app.get("/api/sessions")
def list_sessions():
    return [s.dict() for s in sessions.values()]


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    s = sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    return s.dict()


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: str):
    if session_id not in sessions:
        raise HTTPException(404, "Session not found")
    del sessions[session_id]
    save_sessions()
    return {"ok": True}


@app.patch("/api/sessions/{session_id}/corners")
def update_corners(session_id: str, body: dict):
    s = sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    s.corners = body.get("corners")
    save_sessions()
    return s.dict()


@app.post("/api/sessions/{session_id}/analyze")
def analyze(session_id: str, body: AnalysisRequest):
    s = sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Session not found")

    corners = body.corners or s.corners
    if not corners or len(corners) != 4:
        raise HTTPException(400, "4 corner points required. Click the corners of the card first.")

    # Update stored corners
    s.corners = corners

    # Detect portrait from corner geometry
    import numpy as np
    tl, tr, br, bl = [np.array(c) for c in corners]
    card_w = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    card_h = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    portrait = card_h > card_w

    patches = get_patches(s.card_type, portrait=portrait)
    result = analyze_image(body.image_path, corners, patches, s.card_type, settings.screenshots_dir)
    s.results.append(result)
    save_sessions()
    return result.dict()


@app.get("/api/sessions/{session_id}/debug-image")
def get_debug_image(session_id: str):
    """Return the warped card image with grid lines and sampling regions overlaid."""
    s = sessions.get(session_id)
    if not s:
        raise HTTPException(404, "Session not found")
    if not s.corners or len(s.corners) != 4:
        raise HTTPException(400, "No corners defined")
    if not s.results:
        raise HTTPException(400, "No analysis results yet")

    import cv2 as cv2_import
    debug_img = generate_debug_image(
        s.results[-1].image_path, s.corners, s.card_type, settings.screenshots_dir
    )
    # Encode as PNG
    debug_bgr = cv2_import.cvtColor(debug_img, cv2_import.COLOR_RGB2BGR)
    _, png_data = cv2_import.imencode('.png', debug_bgr)
    return Response(content=png_data.tobytes(), media_type="image/png")


# --- Images ---

@app.get("/api/images")
def list_images():
    """List all image files in the watched screenshots folder."""
    screenshots_dir = Path(settings.screenshots_dir).expanduser()
    extensions = {".png", ".jpg", ".jpeg", ".tiff", ".bmp"}
    images = []
    for f in sorted(screenshots_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if f.is_file() and f.suffix.lower() in extensions:
            images.append(f.name)
    return images


# --- Settings ---

@app.get("/api/settings")
def get_settings():
    return settings.dict()


@app.put("/api/settings")
def update_settings(body: Settings):
    global settings, watcher
    settings = body
    # Restart watcher if dir changed
    screenshots_dir = Path(settings.screenshots_dir).expanduser()
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    if watcher:
        watcher.stop()
    watcher = FolderWatcher(str(screenshots_dir), broadcast)
    watcher.start()
    save_sessions()
    return settings.dict()


# Mount screenshots directory for serving images — must be LAST (catch-all)
_screenshots_dir = Path(settings.screenshots_dir).expanduser()
_screenshots_dir.mkdir(parents=True, exist_ok=True)
app.mount("/screenshots", StaticFiles(directory=str(_screenshots_dir)), name="screenshots")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
