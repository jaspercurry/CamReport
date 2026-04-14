# CamReport V2 — Handoff Prompt

Use this as context for a fresh conversation to continue where we left off.

---

## What This Project Is

CamReport is a local macOS web app (Python/FastAPI backend + React/Vite frontend) for measuring webcam color accuracy against a Datacolor SpyderCheckr 24 reference card. Built for a YouTube video comparing multiple webcams. Not production software — just needs to work for measuring cameras.

## What V1 Does (complete, working)

- User manually takes screenshots of webcams with the SpyderCheckr card in frame
- User clicks 4 corners of the card's patch area in the browser
- Backend does perspective warp, divides into grid, detects divider lines between patches
- Samples center 40% of each cell, converts sRGB→Lab (D65), computes CIEDE2000 delta-E
- Shows report card: overall score, per-patch grid, adjustment recommendations
- File watcher on `~/Desktop/webcam-cal/` for new screenshots
- Sessions persisted to `sessions.json`

## What V2 Adds (Phases 1-4 implemented, needs testing/polish)

### Phase 1: Live Camera (working)
- `backend/camera.py` — CameraManager with single reader thread per camera, MJPEG preview, full-res capture
- Camera enumeration via AVFoundation (PyObjC) for accurate OpenCV index mapping
- Filters out virtual cameras and iPhone/Continuity Camera
- Opens at max resolution, resizes for preview (macOS OpenCV crashes on dynamic res switching)
- Frontend: `CameraFeed.tsx` — device dropdown, live MJPEG preview, capture-then-pick-corners flow

### Phase 2: UVC Controls (needs real hardware testing)
- `backend/uvc_control.py` — Abstract UVCBackend with UvcUtilBackend (subprocess to uvc-util) and MockBackend
- `scripts/build-uvc-util.sh` — compiles uvc-util from jtfrey/uvc-util repo (NOT YET COMPILED)
- Control probing to detect which controls each camera actually supports
- Frontend: `UVCControls.tsx` — collapsible slider panel with per-control reset
- Currently running MockBackend since uvc-util hasn't been compiled yet

### Phase 3: Analysis Refactor (working)
- `analyze_frame()` accepts numpy array directly (no file path needed)
- `compute_calibration_errors()` extracts numeric error signals for the calibration loop
- Original `analyze_image()` is now a thin wrapper around `analyze_frame()`

### Phase 4: Auto-Calibration Loop (implemented, not yet tested with real UVC)
- `backend/calibration.py` — CalibrationRunner with coordinate-descent binary search
- Phases: WB → brightness → saturation → contrast → fine-tune WB → fine-tune brightness
- WebSocket progress broadcasting
- Frontend: `CalibrationProgress.tsx` — phase bar, delta-E trend chart, step log, start/stop

### Phase 5: UI polish (not started)
- CalibrationProgress UI could use more polish
- Before/after comparison view on calibration completion

## Key Architecture Decisions

### macOS Camera Permissions (CRITICAL)
- OpenCV camera access requires TCC authorization on macOS
- The `opencv-contrib-python` pip wheel has a bug where its internal auth check reports "status 0" even when AVFoundation says authorized
- **Solution**: `backend/request_camera_permission.py` — spins up an NSApplication run loop, requests camera access via AVFoundation, then starts the server
- **To start the server**: Run from Terminal.app: `cd ~/Code/CamReport && python3 backend/request_camera_permission.py`
- If camera stops working: `tccutil reset Camera` then re-run the permission script
- The Vite frontend dev server can run from anywhere (no camera needed): `cd frontend && npm run dev`

### Camera Enumeration
- Uses AVFoundation DiscoverySession (via PyObjC) for device enumeration — this matches OpenCV's internal device ordering exactly
- Virtual cameras and iPhone are filtered out to avoid triggering Continuity Camera on the network
- `system_profiler SPCameraDataType` is a fallback but its ordering doesn't match OpenCV indices

### Single Reader Thread Pattern
- One background thread per camera continuously reads frames into a shared buffer
- Preview endpoint and capture endpoint both read from this buffer
- Can't open two VideoCapture instances on the same camera (crashes OpenCV)

### Resolution Strategy
- Always open at max resolution (typically 3840x2160 for 4K webcams)
- Resize to 960px wide for MJPEG preview streaming
- Analysis uses full-res frames from the shared buffer

## Connected Cameras (Jasper's setup)

- **EMEET SmartCam C960 Ultra** — the "960 Ultra", USB webcam
- **S3-25350036** — YoloCAM S3
- **Y-CAM-25360269** — another YoloCam model
- **Cam Link 4K** — Elgato capture card
- Plus virtual cameras (filtered out) and iPhone (filtered out)

## What Needs to Happen Next

### Immediate (to get calibration working end-to-end)
1. **Compile uvc-util**: `bash scripts/build-uvc-util.sh` — needs testing on this machine
2. **Test UVC controls**: Open a Logitech/EMEET camera, check which controls it actually exposes
3. **Test auto-calibration with real UVC**: Run the calibration loop with actual hardware control changes
4. **Settling time tuning**: The 1.5s + 5-frame-discard might need adjustment per camera

### Polish
5. **Capture flow UX**: After capturing and picking corners, the analysis results should be clearly visible. Currently goes back to live preview (which is actually correct for iterative calibration — you want to see the live feed updating as you adjust). But could show a toast/notification with the score.
6. **Before/after comparison**: After calibration completes, show the delta-E improvement clearly
7. **Multiple camera workflow**: Create sessions for each camera, calibrate each one, compare on the Dashboard

### Optional
8. **Claude API optimizer** (Phase 6 from the plan) — send analysis results to Claude to suggest all control changes simultaneously instead of binary search

## File Map

| File | Purpose |
|------|---------|
| `backend/server.py` | FastAPI server, all endpoints |
| `backend/camera.py` | CameraManager, MJPEG streaming, frame capture |
| `backend/uvc_control.py` | UVC control abstraction (uvc-util + mock) |
| `backend/calibration.py` | Auto-calibration loop (coordinate descent) |
| `backend/analysis.py` | Color analysis pipeline (analyze_frame, compute_calibration_errors) |
| `backend/reference_data.py` | SpyderCheckr 48 Lab reference values |
| `backend/request_camera_permission.py` | macOS camera permission + server launcher |
| `backend/models.py` | Pydantic models |
| `frontend/src/components/CameraFeed.tsx` | Camera dropdown + live preview + capture + corner picking |
| `frontend/src/components/UVCControls.tsx` | UVC slider panel |
| `frontend/src/components/CalibrationProgress.tsx` | Auto-calibration progress UI |
| `frontend/src/components/ReportCard.tsx` | Main session view (integrates all V2 components) |
| `scripts/build-uvc-util.sh` | Compiles uvc-util from source |
| `V2_VISION.md` | Original V2 design document |

## How to Run

```bash
# Terminal 1: Backend (must run from Terminal.app for camera access)
cd ~/Code/CamReport && python3 backend/request_camera_permission.py

# Terminal 2: Frontend (can run from anywhere)
cd ~/Code/CamReport/frontend && npm run dev
```

Then open http://localhost:5173
