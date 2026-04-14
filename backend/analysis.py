"""
Image analysis pipeline for SpyderCheckr color calibration.

1. Load image, crop to rectangle
2. Divide into grid cells
3. Sample center 50% of each cell, compute mean RGB
4. RGB -> Lab via colour-science (sRGB assumed)
5. CIEDE2000 delta-E per patch
6. Aggregate metrics + recommendations
"""
from __future__ import annotations

import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List

import cv2
import numpy as np
import colour

from models import PatchResult, Recommendations, AnalysisResult
from reference_data import get_grid_size


def _rgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """Convert sRGB (0-255 uint8) to CIE Lab."""
    rgb_float = rgb.astype(np.float64) / 255.0
    xyz = colour.sRGB_to_XYZ(rgb_float)
    lab = colour.XYZ_to_Lab(xyz, illuminant=colour.CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]["D65"])
    return lab


def _lab_to_rgb(lab: List[float]) -> List[int]:
    """Convert Lab to sRGB (0-255) for display purposes."""
    lab_arr = np.array(lab)
    xyz = colour.Lab_to_XYZ(lab_arr, illuminant=colour.CCS_ILLUMINANTS["CIE 1931 2 Degree Standard Observer"]["D65"])
    rgb = colour.XYZ_to_sRGB(xyz)
    rgb_clipped = np.clip(rgb * 255, 0, 255).astype(int)
    return rgb_clipped.tolist()


def _delta_e_ciede2000(lab1: np.ndarray, lab2: np.ndarray) -> float:
    """Compute CIEDE2000 delta-E between two Lab colors."""
    return float(colour.delta_E(lab1, lab2, method="CIE 2000"))


def _chroma(a: float, b: float) -> float:
    return math.sqrt(a ** 2 + b ** 2)


def analyze_image(
    image_path: str,
    corners: List[List[float]],
    patches: List[Dict],
    card_type: int = 24,
    screenshots_dir: str = "~/Desktop/webcam-cal",
) -> AnalysisResult:
    """Run the full analysis pipeline on an image.

    corners: 4 points [x, y] in order: top-left, top-right, bottom-right, bottom-left
    of the patch area (inside the black border).
    """

    # Resolve path - could be absolute or relative to screenshots dir
    img_path = Path(image_path).expanduser()
    if not img_path.is_absolute():
        base = Path(screenshots_dir).expanduser()
        img_path = base / image_path

    img = cv2.imread(str(img_path))
    if img is None:
        raise ValueError(f"Could not load image: {img_path}")

    # Convert BGR to RGB
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    # Auto-detect portrait vs landscape from the corner positions
    # Measure the width (top-left to top-right) and height (top-left to bottom-left)
    tl, tr, br, bl = [np.array(c) for c in corners]
    card_width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    card_height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    portrait = card_height > card_width

    # Determine grid size
    rows, cols = get_grid_size(card_type, portrait=portrait)

    # Perspective warp: map the 4 corners to a perfect rectangle
    dst_w = int(cols * 100)  # 100px per cell for good sampling resolution
    dst_h = int(rows * 100)

    src_pts = np.array(corners, dtype=np.float32)
    dst_pts = np.array([
        [0, 0],
        [dst_w, 0],
        [dst_w, dst_h],
        [0, dst_h],
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(src_pts, dst_pts)
    cropped = cv2.warpPerspective(img_rgb, M, (dst_w, dst_h))

    w = dst_w
    h = dst_h
    cell_h = h / rows
    cell_w = w / cols

    # Analyze each patch
    patch_results: List[PatchResult] = []

    for patch in patches:
        row = patch["row"]
        col = patch["col"]
        ref_lab = patch["lab"]

        # Cell boundaries
        cy = int(row * cell_h)
        cx = int(col * cell_w)
        ch = int(cell_h)
        cw = int(cell_w)

        # Sample center 50%
        margin_y = int(ch * 0.25)
        margin_x = int(cw * 0.25)
        sample = cropped[cy + margin_y:cy + ch - margin_y, cx + margin_x:cx + cw - margin_x]

        if sample.size == 0:
            continue

        # Mean RGB
        mean_rgb = sample.mean(axis=(0, 1))
        captured_lab = _rgb_to_lab(mean_rgb)

        # Delta-E
        de = _delta_e_ciede2000(np.array(ref_lab), captured_lab)

        patch_results.append(PatchResult(
            name=patch["name"],
            row=row,
            col=col,
            ref_lab=ref_lab,
            captured_lab=captured_lab.tolist(),
            captured_rgb=[int(c) for c in mean_rgb],
            ref_rgb=_lab_to_rgb(ref_lab),
            delta_e=round(de, 2),
            is_gray=patch["is_gray"],
        ))

    # Compute aggregates
    mean_de = sum(p.delta_e for p in patch_results) / max(len(patch_results), 1)

    # Gray patch analysis
    gray_patches = [p for p in patch_results if p.is_gray]
    recommendations = _compute_recommendations(gray_patches, patch_results)

    return AnalysisResult(
        image_path=image_path,
        mean_delta_e=round(mean_de, 2),
        patches=patch_results,
        recommendations=recommendations,
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


def _compute_recommendations(
    gray_patches: List[PatchResult],
    all_patches: List[PatchResult],
) -> Recommendations:
    """Generate practical adjustment recommendations."""

    wb_msg = "No gray patches detected"
    tint_msg = "No gray patches detected"
    exposure_msg = "No gray patches detected"
    contrast_msg = "No gray patches detected"
    saturation_msg = "No color patches detected"

    if gray_patches:
        # White balance: average b* shift on gray patches
        # Positive b* = too warm, negative = too cool
        b_shifts = [p.captured_lab[2] - p.ref_lab[2] for p in gray_patches]
        avg_b_shift = sum(b_shifts) / len(b_shifts)

        # Approximate Kelvin offset: ~5 units b* ≈ 300-500K
        kelvin_offset = int(avg_b_shift * 80)  # rough: 1 b* unit ≈ 80K

        if abs(avg_b_shift) < 1.0:
            wb_msg = "White balance looks good (b* shift < 1.0)"
        elif avg_b_shift > 0:
            wb_msg = f"~{abs(kelvin_offset)}K too warm — lower color temperature"
        else:
            wb_msg = f"~{abs(kelvin_offset)}K too cool — raise color temperature"

        # Tint: average a* shift on gray patches
        # Positive a* = magenta shift, negative = green shift
        a_shifts = [p.captured_lab[1] - p.ref_lab[1] for p in gray_patches]
        avg_a_shift = sum(a_shifts) / len(a_shifts)

        if abs(avg_a_shift) < 1.0:
            tint_msg = "Tint looks good (a* shift < 1.0)"
        elif avg_a_shift > 0:
            tint_msg = f"Slight magenta tint (a* +{avg_a_shift:.1f}) — shift tint toward green"
        else:
            tint_msg = f"Slight green tint (a* {avg_a_shift:.1f}) — shift tint toward magenta"

        # Exposure: average L* shift on gray patches
        l_shifts = [p.captured_lab[0] - p.ref_lab[0] for p in gray_patches]
        avg_l_shift = sum(l_shifts) / len(l_shifts)
        stops = avg_l_shift / 18.0  # rough conversion

        if abs(avg_l_shift) < 2.0:
            exposure_msg = "Exposure looks good (L* shift < 2.0)"
        elif avg_l_shift > 0:
            exposure_msg = f"~{abs(stops):.1f} stops overexposed (L* +{avg_l_shift:.1f}) — reduce exposure"
        else:
            exposure_msg = f"~{abs(stops):.1f} stops underexposed (L* {avg_l_shift:.1f}) — increase exposure"

        # Contrast: compare L* range
        captured_l_range = max(p.captured_lab[0] for p in gray_patches) - min(p.captured_lab[0] for p in gray_patches)
        ref_l_range = max(p.ref_lab[0] for p in gray_patches) - min(p.ref_lab[0] for p in gray_patches)
        contrast_diff = captured_l_range - ref_l_range
        contrast_pct = (contrast_diff / ref_l_range * 100) if ref_l_range > 0 else 0

        if abs(contrast_pct) < 5:
            contrast_msg = "Contrast looks good"
        elif contrast_pct > 0:
            contrast_msg = f"Contrast ~{abs(contrast_pct):.0f}% too high — reduce contrast"
        else:
            contrast_msg = f"Contrast ~{abs(contrast_pct):.0f}% too low — increase contrast"

    # Saturation: compare chroma of non-gray patches
    color_patches = [p for p in all_patches if not p.is_gray]
    if color_patches:
        chroma_ratios = []
        for p in color_patches:
            ref_c = _chroma(p.ref_lab[1], p.ref_lab[2])
            cap_c = _chroma(p.captured_lab[1], p.captured_lab[2])
            if ref_c > 5:  # skip near-neutral patches
                chroma_ratios.append(cap_c / ref_c)

        if chroma_ratios:
            avg_ratio = sum(chroma_ratios) / len(chroma_ratios)
            sat_pct = (avg_ratio - 1.0) * 100

            if abs(sat_pct) < 5:
                saturation_msg = "Saturation looks good"
            elif sat_pct > 0:
                saturation_msg = f"~{abs(sat_pct):.0f}% oversaturated — reduce saturation"
            else:
                saturation_msg = f"~{abs(sat_pct):.0f}% undersaturated — increase saturation"

    return Recommendations(
        white_balance=wb_msg,
        tint=tint_msg,
        saturation=saturation_msg,
        exposure=exposure_msg,
        contrast=contrast_msg,
    )
