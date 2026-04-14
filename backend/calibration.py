"""
Auto-calibration loop: coordinate-descent binary search over UVC controls.

Optimizes one control at a time in order of impact:
1. White Balance Temperature (b* error on grays)
2. Brightness / Exposure (L* error on grays)
3. Saturation (chroma ratio on color patches)
4. Contrast (L* range on grays)
5. Fine-tune pass: repeat WB and brightness with narrowed bounds
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Dict, List, Optional

import numpy as np

from analysis import analyze_frame, compute_calibration_errors
from models import AnalysisResult, CalibrationStep
from reference_data import get_patches, get_grid_size
from camera import CameraManager
from uvc_control import UVCBackend


class Phase(str, Enum):
    DISABLE_AUTO = "disable_auto"
    WHITE_BALANCE = "white_balance_temperature"
    BRIGHTNESS = "brightness"
    SATURATION = "saturation"
    CONTRAST = "contrast"
    FINE_TUNE_WB = "fine_tune_wb"
    FINE_TUNE_BRIGHTNESS = "fine_tune_brightness"
    FINAL = "final_capture"


@dataclass
class CalibrationConfig:
    settling_time_ms: int = 1500
    discard_frames: int = 5
    convergence: Dict[str, float] = field(default_factory=lambda: {
        "wb_error": 0.5,       # b* shift threshold
        "brightness_error": 1.0,  # L* shift threshold
        "saturation_error": 0.05, # 5% chroma ratio threshold
        "contrast_error": 0.05,   # 5% L* range threshold
    })
    max_iterations: Dict[str, int] = field(default_factory=lambda: {
        Phase.WHITE_BALANCE: 8,
        Phase.BRIGHTNESS: 8,
        Phase.SATURATION: 8,
        Phase.CONTRAST: 6,
        Phase.FINE_TUNE_WB: 4,
        Phase.FINE_TUNE_BRIGHTNESS: 4,
    })


# Map phases to UVC control names and error keys
PHASE_CONFIG = {
    Phase.WHITE_BALANCE: {
        "control": "white_balance_temperature",
        "error_key": "wb_error",
        "positive_means": "too_warm",  # positive b* = warm -> lower Kelvin
    },
    Phase.BRIGHTNESS: {
        "control": "brightness",
        "error_key": "brightness_error",
        "positive_means": "too_high",  # positive L* shift = too bright -> lower brightness
    },
    Phase.SATURATION: {
        "control": "saturation",
        "error_key": "saturation_error",
        "positive_means": "too_high",
    },
    Phase.CONTRAST: {
        "control": "contrast",
        "error_key": "contrast_error",
        "positive_means": "too_high",
    },
    Phase.FINE_TUNE_WB: {
        "control": "white_balance_temperature",
        "error_key": "wb_error",
        "positive_means": "too_warm",
    },
    Phase.FINE_TUNE_BRIGHTNESS: {
        "control": "brightness",
        "error_key": "brightness_error",
        "positive_means": "too_high",
    },
}


class CalibrationRunner:
    """Runs the auto-calibration loop."""

    def __init__(
        self,
        camera_mgr: CameraManager,
        uvc_backend: UVCBackend,
        device_id: str,
        corners: List[List[float]],
        card_type: int,
        config: Optional[CalibrationConfig] = None,
        broadcast_fn: Optional[Callable] = None,
    ):
        self.camera_mgr = camera_mgr
        self.uvc = uvc_backend
        self.device_id = device_id
        self.corners = corners
        self.card_type = card_type
        self.config = config or CalibrationConfig()
        self.broadcast_fn = broadcast_fn

        self._stop_event = asyncio.Event()
        self._steps: List[CalibrationStep] = []
        self._control_ranges: Dict[str, tuple] = {}  # name -> (low, high)

        # Detect portrait from corners
        tl, tr, br, bl = [np.array(c) for c in corners]
        card_w = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
        card_h = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
        self.portrait = card_h > card_w
        self.patches = get_patches(card_type, portrait=self.portrait)

    def stop(self):
        self._stop_event.set()

    async def _broadcast(self, msg: dict):
        if self.broadcast_fn:
            await self.broadcast_fn(msg)

    def _capture_and_analyze(self) -> tuple[AnalysisResult, Dict[str, float]]:
        """Capture a frame and run analysis. Returns (result, errors)."""
        frame = self.camera_mgr.capture_frame_rgb(self.device_id)
        if frame is None:
            raise RuntimeError("Camera disconnected")
        result = analyze_frame(frame, self.corners, self.patches, self.card_type)
        errors = compute_calibration_errors(result.patches)
        return result, errors

    def _settle_and_capture(self) -> tuple[AnalysisResult, Dict[str, float]]:
        """Wait for camera to settle, then capture and analyze."""
        self.camera_mgr.discard_frames(
            self.device_id,
            count=self.config.discard_frames,
            settle_ms=self.config.settling_time_ms,
        )
        return self._capture_and_analyze()

    async def run(self) -> Dict:
        """Execute the full calibration loop. Returns a CalibrationResult-like dict."""
        start_time = time.monotonic()
        total_iterations = 0
        final_controls = {}

        try:
            # ---- Phase 0: Disable auto modes ----
            await self._broadcast({"type": "phase_started", "phase": "disable_auto", "phase_index": -1})

            self.uvc.set_control(self.device_id, "auto_white_balance", 0)
            self.uvc.set_control(self.device_id, "auto_exposure", 1)  # 1 = manual on most cameras

            # Initial capture
            before_result, errors = self._settle_and_capture()
            initial_delta_e = before_result.mean_delta_e

            await self._broadcast({
                "type": "calibration_started",
                "session_id": self.device_id,
                "initial_delta_e": initial_delta_e,
            })

            # Discover available controls and their ranges
            controls = self.uvc.probe_controls(self.device_id)
            available = {c.name: c for c in controls if c.available}

            for c in controls:
                self._control_ranges[c.name] = (c.min_val, c.max_val)

            # ---- Main phases ----
            phases = [
                Phase.WHITE_BALANCE,
                Phase.BRIGHTNESS,
                Phase.SATURATION,
                Phase.CONTRAST,
                Phase.FINE_TUNE_WB,
                Phase.FINE_TUNE_BRIGHTNESS,
            ]

            for phase_idx, phase in enumerate(phases):
                if self._stop_event.is_set():
                    break

                pc = PHASE_CONFIG[phase]
                control_name = pc["control"]

                # Skip if control unavailable
                if control_name not in available:
                    await self._broadcast({
                        "type": "control_unavailable",
                        "control": control_name,
                        "phase": phase.value,
                    })
                    continue

                await self._broadcast({
                    "type": "phase_started",
                    "phase": phase.value,
                    "phase_index": phase_idx,
                })

                ctrl = available[control_name]
                max_iter = self.config.max_iterations.get(phase, 8)
                threshold = self.config.convergence.get(pc["error_key"], 1.0)

                # Determine search range
                if phase in (Phase.FINE_TUNE_WB, Phase.FINE_TUNE_BRIGHTNESS):
                    # Narrow range: current ± 10% of total range
                    current = self.uvc.get_control(self.device_id, control_name) or ctrl.current
                    total_range = ctrl.max_val - ctrl.min_val
                    margin = int(total_range * 0.10)
                    low = max(ctrl.min_val, current - margin)
                    high = min(ctrl.max_val, current + margin)
                else:
                    low = ctrl.min_val
                    high = ctrl.max_val

                # Binary search
                for step_num in range(max_iter):
                    if self._stop_event.is_set():
                        break

                    mid = (low + high) // 2
                    self.uvc.set_control(self.device_id, control_name, mid)

                    result, errors = self._settle_and_capture()
                    error_val = errors[pc["error_key"]]
                    total_iterations += 1

                    step = CalibrationStep(
                        phase=phase.value,
                        step=step_num,
                        control_value=mid,
                        search_range=[low, high],
                        error=round(error_val, 3),
                        mean_delta_e=result.mean_delta_e,
                    )
                    self._steps.append(step)

                    await self._broadcast({
                        "type": "calibration_step",
                        "phase": phase.value,
                        "step": step_num,
                        "value": mid,
                        "range": [low, high],
                        "error": round(error_val, 3),
                        "mean_delta_e": result.mean_delta_e,
                    })

                    # Check convergence
                    if abs(error_val) < threshold:
                        break

                    # Narrow range based on error sign
                    if pc["positive_means"] == "too_warm" or pc["positive_means"] == "too_high":
                        # Positive error means value is too high -> search lower half
                        if error_val > 0:
                            high = mid
                        else:
                            low = mid
                    else:
                        if error_val > 0:
                            low = mid
                        else:
                            high = mid

                await self._broadcast({
                    "type": "phase_complete",
                    "phase": phase.value,
                    "final_value": mid,
                    "final_error": round(error_val, 3),
                })

            # ---- Final capture ----
            after_result, final_errors = self._settle_and_capture()
            total_iterations += 1

            # Collect final control values
            for c in controls:
                if c.available:
                    val = self.uvc.get_control(self.device_id, c.name)
                    if val is not None:
                        final_controls[c.name] = val

            duration = time.monotonic() - start_time

            result_dict = {
                "initial_delta_e": round(initial_delta_e, 2),
                "final_delta_e": round(after_result.mean_delta_e, 2),
                "total_iterations": total_iterations,
                "duration_seconds": round(duration, 1),
                "steps": [s.dict() for s in self._steps],
                "final_controls": final_controls,
                "before_analysis": before_result.dict(),
                "after_analysis": after_result.dict(),
            }

            await self._broadcast({
                "type": "calibration_complete",
                "final_delta_e": round(after_result.mean_delta_e, 2),
                "iterations": total_iterations,
                "duration_s": round(duration, 1),
                "controls": final_controls,
            })

            return result_dict

        except Exception as e:
            await self._broadcast({
                "type": "calibration_error",
                "error": str(e),
            })
            raise
