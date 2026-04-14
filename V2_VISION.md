# CamReport V2 — Automated Webcam Color Calibration

## What V1 Does (Current State)

- Python/FastAPI backend + React/Vite frontend, local macOS tool
- User manually takes screenshots of webcams with a SpyderCheckr 24 card in frame
- User clicks 4 corners of the card's patch area (inside the black border)
- Backend does perspective warp (OpenCV), divides into grid, detects divider lines between patches
- Samples center 40% of each cell, converts sRGB→Lab (D65 illuminant), computes CIEDE2000 delta-E
- Shows report card: overall score, per-patch grid (reference vs captured), adjustment recommendations (WB, tint, saturation, exposure, contrast), iteration history
- Dashboard view for comparing multiple cameras side-by-side
- File watcher on `~/Desktop/webcam-cal/` for new screenshots
- Sessions persisted to `sessions.json`

## V2 Vision: Closed-Loop Automated Calibration

### Core Idea

Replace the manual screenshot→adjust→screenshot loop with: select camera → draw corners once → click "Calibrate" → the tool automatically captures frames, analyzes them, adjusts UVC camera controls, and iterates until convergence.

### User Flow

1. Open CamReport, see list of connected webcams
2. Select a camera — live preview appears in the browser
3. Position the SpyderCheckr card in frame, click 4 corners on the live preview
4. Click "Start Calibration"
5. The tool automatically:
   - Disables auto white balance and auto exposure
   - Captures a full-resolution frame (4K if supported)
   - Analyzes it against reference values
   - Adjusts UVC controls (white balance temp, brightness, saturation, contrast, etc.)
   - Waits for camera ISP to settle (~2 seconds)
   - Captures again, re-analyzes
   - Repeats for each control phase until convergence or max iterations
6. User watches real-time progress: current phase, delta-E trend, control values being adjusted
7. Final report shows before/after comparison and all applied settings

### Also Useful Without Auto-Calibration

Even if a camera doesn't support certain UVC controls, V2 still adds value:
- Live camera preview (no more external screenshots)
- In-app capture button for manual workflow
- Manual UVC control sliders for cameras that do support them
- The existing recommendation system still works for controls that can't be automated

---

## Architecture

### Frame Capture

- **OpenCV** (`cv2.VideoCapture`) for both live preview and full-res capture
- **Live preview**: MJPEG stream at ~15fps, downscaled (e.g., 960x540) for bandwidth. Served via FastAPI `StreamingResponse` with `multipart/x-mixed-replace`. Browser renders it natively with just `<img src="/api/cameras/{id}/preview">` — no WebSocket or WebRTC needed
- **Analysis captures**: Full resolution (e.g., 3840x2160) single-frame grabs via `cap.set(CAP_PROP_FRAME_WIDTH, 3840)`. These are the frames that get analyzed — preview resolution is only for positioning the card
- The low-res preview does NOT affect analysis quality. Preview is for framing; analysis uses separate full-res captures

### UVC Control on macOS

**The hard part.** AVFoundation (Apple's camera framework) does NOT expose UVC controls — no white balance, saturation, gain, exposure.

**Recommended path: `uvc-util` via subprocess**

- Small Objective-C tool (~4 source files) that uses IOKit to send UVC control requests directly over USB
- Does NOT use libusb — avoids the exclusive device access / root permission problems
- Supports all UVC 1.1 and 1.5 controls: white balance temp, brightness, contrast, saturation, gain, exposure, gamma, hue, auto-exposure mode, auto-WB toggle, etc.
- Query min/max/step/default ranges for any control
- No root required, works with macOS's built-in USB stack
- Compile once: `gcc -o uvc-util -framework IOKit -framework Foundation *.m`
- Call from Python: `subprocess.run(["./uvc-util", "-s", "white-balance-temp", "--", "5000"])`
- GitHub: `github.com/jtfrey/uvc-util` (dormant but functional, last updated 2021)

**Alternatives considered and rejected:**
- `pyuvc` (Pupil Labs): Requires root on macOS due to libusb exclusive access — impractical
- AVFoundation via PyObjC: Doesn't expose the controls we need
- Direct IOKit from Python: Possible but enormous effort to reimplement
- `uvcc` (Node.js): Works but adds Node.js as a dependency

**Python wrapper module: `backend/uvc_control.py`**

```python
# Responsibilities:
list_controls(device_id) -> List[UVCControl]  # name, min, max, step, current, default
get_control(device_id, control_name) -> int
set_control(device_id, control_name, value) -> bool
reset_control(device_id, control_name) -> bool  # set to default
```

### Calibration Loop Algorithm

Coordinate-descent strategy — optimize one control at a time, in order of impact:

```
1. DISABLE AUTO MODES
   - Set auto_exposure to Manual
   - Set auto_white_balance to Off
   - Wait 2 seconds for ISP to settle

2. WHITE BALANCE TEMPERATURE (highest impact)
   - Error signal: average b* shift on gray patches
   - Binary search between UVC min and max
   - Positive b* = too warm → lower the Kelvin value
   - Target: b* shift < 0.5
   - Max 8 iterations

3. BRIGHTNESS / EXPOSURE
   - Error signal: average L* shift on gray patches
   - Binary search
   - Target: L* shift < 1.0
   - Max 8 iterations

4. SATURATION
   - Error signal: average (captured_chroma / ref_chroma) - 1.0 on color patches
   - Binary search
   - Target: ratio within 5%
   - Max 8 iterations

5. CONTRAST
   - Error signal: (captured_L_range - ref_L_range) / ref_L_range on gray patches
   - Binary search
   - Target: within 5%
   - Max 6 iterations

6. FINE-TUNE PASS
   - Repeat WB and brightness with narrowed bounds (current ± 10% of range)
   - Max 4 iterations each

7. FINAL CAPTURE AND REPORT
   - Full-res capture, full analysis
   - Show before/after delta-E comparison
   - Report all final UVC control values
```

Each binary search step: set control → wait settling time (2s) → capture full-res frame → analyze → compute error → narrow search range.

Expected total: ~20-30 captures over ~60-90 seconds.

### Claude API Optimizer (Optional Alternative to Binary Search)

Instead of per-control binary search, send the full analysis to Claude after each capture and let it suggest all control adjustments simultaneously:

```python
# Send: current control values, control ranges, last 5 analysis results
# Receive: JSON with suggested values for all controls
# Advantage: handles nonlinear interactions between controls
# Tradeoff: ~1-2s API latency per iteration, token costs
# Use claude-sonnet for speed, claude-opus for complex cases
```

This is an optional upgrade — binary search should work well for most cameras.

### Fallback When UVC Control Doesn't Work

1. **Discovery**: Probe each control on camera open — if min==max or set/get doesn't round-trip, mark unavailable
2. **Skip unavailable**: Calibration loop skips phases for unavailable controls
3. **Show recommendations**: For unavailable controls, show the existing text recommendations so user can adjust manually in camera software
4. **Manual hybrid**: User adjusts manually, clicks "Re-capture" to re-analyze with the live feed

---

## New Backend Modules

### `backend/camera.py`
- `list_devices()` — enumerate connected webcams (via `system_profiler SPCameraDataType -json` or OpenCV index probing)
- `open_camera(device_id, resolution)` — open capture session
- `capture_frame(handle)` — full-resolution single frame as numpy array
- `get_preview_generator(handle)` — yields MJPEG frames for streaming
- `close_camera(handle)`

### `backend/uvc_control.py`
- Wraps `uvc-util` CLI via subprocess
- `list_controls()`, `get_control()`, `set_control()`, `reset_control()`
- Caches device info to avoid repeated subprocess calls
- Handles the critical step: disable auto modes before manual control

### `backend/calibration.py`
- `run_calibration(session, device_id, corners, broadcast_fn, strategy, convergence_target)`
- Implements the coordinate-descent binary search loop
- Broadcasts progress via WebSocket for real-time UI updates
- Extracts numeric error functions from existing `_compute_recommendations` logic

### `backend/claude_optimizer.py` (optional)
- `get_next_settings(current_controls, control_ranges, analysis_history)` → dict of suggested values
- Calls Claude API with structured diagnostic data

## New API Endpoints

```
GET  /api/cameras                              — list connected webcams
POST /api/cameras/{id}/open                    — open camera session
GET  /api/cameras/{id}/preview                 — MJPEG live stream
POST /api/cameras/{id}/capture                 — capture full-res frame, save to disk
GET  /api/cameras/{id}/controls                — list UVC controls with ranges
PUT  /api/cameras/{id}/controls/{name}         — set a UVC control value
POST /api/cameras/{id}/controls/reset          — reset all to defaults
POST /api/sessions/{id}/calibrate              — start auto-calibration (background task)
POST /api/sessions/{id}/calibrate/stop         — abort calibration
```

## New Frontend Components

### `CameraFeed.tsx`
- Device selector dropdown
- Live MJPEG preview with corner-picking overlay
- "Capture" button for manual single-frame grab

### `UVCControls.tsx`
- Panel of sliders for each available UVC control
- Shows min/max/current/default for each
- Reset-to-default button per control
- Controls marked as unavailable are shown as disabled with explanation

### `CalibrationProgress.tsx`
- Phase indicator bar (WB → Brightness → Saturation → Contrast → Fine-tune)
- For active phase: visual of binary search range with current probe point
- Running delta-E trend chart
- Step-by-step log
- "Stop Calibration" button
- On completion: before/after comparison, final control values

## WebSocket Protocol Extensions

```json
{"type": "calibration_started", "session_id": "...", "initial_delta_e": 15.2}
{"type": "phase_started", "phase": "white_balance_temperature", "phase_index": 0}
{"type": "calibration_step", "phase": "white_balance_temperature", "step": 3, "value": 4500, "range": [2800, 6500], "error": -1.2, "mean_delta_e": 5.3}
{"type": "control_unavailable", "control": "saturation"}
{"type": "calibration_complete", "final_delta_e": 2.8, "iterations": 18, "controls": {...}}
{"type": "calibration_stopped"}
{"type": "calibration_error", "error": "Camera disconnected"}
```

## Dependencies to Add

Python:
- `pyusb` — only if going the libusb route instead of uvc-util
- `anthropic` — for Claude API optimizer (optional)

System:
- Compile `uvc-util` from source (4 Objective-C files, uses IOKit + Foundation frameworks)

## Implementation Order

1. Camera enumeration + live MJPEG preview (unblocks everything)
2. uvc-util compilation and Python wrapper
3. Manual UVC slider controls in UI (useful standalone, validates control works)
4. Refactor analysis.py to extract numeric error functions and support numpy array input
5. Auto-calibration loop with binary search (WB first, then other controls)
6. CalibrationProgress UI component
7. Claude API optimizer (optional upgrade)

## Key Risks

- **Camera-specific UVC support**: Not all webcams expose all controls. MacBook built-in cameras are very limited. High-end USB webcams (Logitech, Elgato) generally have good UVC support.
- **uvc-util on Apple Silicon**: Should work (IOKit is stable) but needs testing after compilation.
- **Control interactions**: Changing white balance can affect perceived brightness/saturation. The fine-tune pass handles this, but convergence isn't guaranteed for all cameras.
- **ISP settling time**: If we don't wait long enough after a control change, the captured frame may show intermediate values. 2 seconds is conservative; some cameras may need less or more.
