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


class CameraSession(BaseModel):
    id: str
    name: str
    card_type: int = 24
    rectangle: Optional[Dict] = None  # {x, y, width, height} in image coords
    results: List[AnalysisResult] = []


class SessionCreate(BaseModel):
    name: str
    card_type: int = 24


class AnalysisRequest(BaseModel):
    image_path: str
    rectangle: Optional[Dict] = None


class Settings(BaseModel):
    screenshots_dir: str = "~/Desktop/webcam-cal"
