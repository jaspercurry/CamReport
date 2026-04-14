from __future__ import annotations

from typing import Dict, List, Optional
from pydantic import BaseModel


class PatchResult(BaseModel):
    name: str
    row: int
    col: int
    ref_lab: List[float]
    captured_lab: List[float]
    captured_rgb: List[int]
    ref_rgb: List[int]
    delta_e: float
    is_gray: bool = False


class Recommendations(BaseModel):
    white_balance: str
    tint: str
    saturation: str
    exposure: str
    contrast: str


class AnalysisResult(BaseModel):
    image_path: str
    mean_delta_e: float
    patches: List[PatchResult]
    recommendations: Recommendations
    timestamp: str


# Corners: list of 4 [x, y] points in order: top-left, top-right, bottom-right, bottom-left
class CameraSession(BaseModel):
    id: str
    name: str
    card_type: int = 24
    corners: Optional[List[List[float]]] = None
    results: List[AnalysisResult] = []


class SessionCreate(BaseModel):
    name: str
    card_type: int = 24


class AnalysisRequest(BaseModel):
    image_path: str
    corners: Optional[List[List[float]]] = None


class Settings(BaseModel):
    screenshots_dir: str = "~/Desktop/webcam-cal"


# --- V2: Camera + Calibration models ---

class CameraDevice(BaseModel):
    device_id: str
    name: str
    index: int
    vid_pid: str = ""
    resolution: Optional[List[int]] = None  # [width, height]

class UVCControlInfo(BaseModel):
    name: str
    min_val: int
    max_val: int
    step: int
    default: int
    current: int
    available: bool = True

class CalibrationErrors(BaseModel):
    """Numeric error signals used by the auto-calibration loop."""
    wb_error: float = 0.0           # mean b* shift on gray patches
    brightness_error: float = 0.0    # mean L* shift on gray patches
    saturation_error: float = 0.0    # mean (chroma_ratio - 1.0) on color patches
    contrast_error: float = 0.0      # (captured_L_range - ref_L_range) / ref_L_range

class CalibrationStep(BaseModel):
    phase: str
    step: int
    control_value: int
    search_range: List[int]  # [low, high]
    error: float
    mean_delta_e: float

class CalibrationResult(BaseModel):
    initial_delta_e: float
    final_delta_e: float
    total_iterations: int
    duration_seconds: float
    steps: List[CalibrationStep] = []
    final_controls: Dict[str, int] = {}
    before_analysis: Optional[AnalysisResult] = None
    after_analysis: Optional[AnalysisResult] = None
