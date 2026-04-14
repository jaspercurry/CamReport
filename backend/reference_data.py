"""
SpyderCheckr 48 reference Lab values from Bartneck's published tables.
https://www.bartneck.de/2017/10/24/patch-color-definitions-for-datacolor-spydercheckr-48/

The SpyderCheckr 48 is an 8-row x 6-column grid (rows A-H, cols 1-6).
The SpyderCheckr 24 uses rows E-H (the bottom 4 rows): grays, primaries,
saturated colors, and skin tones.
"""
from __future__ import annotations

from typing import Dict, List, Tuple

# Each patch: (name, row, col, L*, a*, b*, is_gray)
# Rows 0-7 = A-H, Cols 0-5 = 1-6
SPYDERCHECKR_48 = [
    # Row A (row 0): Low Saturation colors
    ("Low Sat. Red",        0, 0, 61.35,  34.81,  18.38, False),
    ("Low Sat. Yellow",     0, 1, 75.50,   5.84,  50.42, False),
    ("Low Sat. Green",      0, 2, 66.82, -25.10,  23.47, False),
    ("Low Sat. Cyan",       0, 3, 60.53, -22.60, -20.40, False),
    ("Low Sat. Blue",       0, 4, 59.66,  -2.03, -28.46, False),
    ("Low Sat. Magenta",    0, 5, 59.15,  30.83,  -5.72, False),

    # Row B (row 1): Tints and Tones
    ("10% Red Tint",        1, 0, 82.68,   5.03,   3.02, False),
    ("10% Green Tint",      1, 1, 82.25,  -2.42,   3.78, False),
    ("10% Blue Tint",       1, 2, 82.29,   2.20,  -2.04, False),
    ("90% Red Tone",        1, 3, 24.89,   4.43,   0.78, False),
    ("90% Green Tone",      1, 4, 25.16,  -3.88,   2.13, False),
    ("90% Blue Tone",       1, 5, 26.13,   2.61,  -5.03, False),

    # Row C (row 2): Skin tones + 95% gray
    ("Lightest Skin",       2, 0, 85.42,   9.41,  14.49, False),
    ("Lighter Skin",        2, 1, 74.28,   9.05,  27.21, False),
    ("Moderate Skin",       2, 2, 64.57,  12.39,  37.24, False),
    ("Medium Skin",         2, 3, 44.49,  17.23,  26.24, False),
    ("Deep Skin",           2, 4, 25.29,   7.95,   8.87, False),
    ("95% Gray",            2, 5, 22.67,   2.11,  -1.10, True),

    # Row D (row 3): Gray ramp (primary grays)
    ("5% Gray",             3, 0, 92.72,   1.89,   2.76, True),
    ("10% Gray",            3, 1, 88.85,   1.59,   2.27, True),
    ("30% Gray",            3, 2, 73.42,   0.99,   1.89, True),
    ("50% Gray",            3, 3, 57.15,   0.57,   1.19, True),
    ("70% Gray",            3, 4, 41.57,   0.24,   1.45, True),
    ("90% Gray",            3, 5, 25.65,   1.24,   0.05, True),

    # Row E (row 4): Card White + more grays
    ("Card White",          4, 0, 96.04,   2.16,   2.60, True),
    ("20% Gray",            4, 1, 80.44,   1.17,   2.05, True),
    ("40% Gray",            4, 2, 65.52,   0.69,   1.86, True),
    ("60% Gray",            4, 3, 49.62,   0.58,   1.56, True),
    ("80% Gray",            4, 4, 33.55,   0.35,   1.40, True),
    ("Card Black",          4, 5, 16.91,   1.43,  -0.81, True),

    # Row F (row 5): Primary colors
    ("Primary Cyan",        5, 0, 47.12, -32.50, -28.75, False),
    ("Primary Magenta",     5, 1, 50.49,  53.45, -13.55, False),
    ("Primary Yellow",      5, 2, 83.61,   3.36,  87.02, False),
    ("Primary Red",         5, 3, 41.05,  60.75,  31.17, False),
    ("Primary Green",       5, 4, 54.14, -40.80,  34.75, False),
    ("Primary Blue",        5, 5, 24.75,  13.78, -49.48, False),

    # Row G (row 6): More saturated colors
    ("Primary Orange",      6, 0, 60.94,  38.21,  61.31, False),
    ("Blueprint",           6, 1, 37.80,   7.30, -43.04, False),
    ("Pink",                6, 2, 49.81,  48.50,  15.76, False),
    ("Violet",              6, 3, 28.88,  19.36, -24.48, False),
    ("Apple Green",         6, 4, 72.45, -23.60,  60.47, False),
    ("Sunflower",           6, 5, 71.65,  23.74,  72.28, False),

    # Row H (row 7): Mixed colors + classic skins
    ("Aqua",                7, 0, 70.19, -31.90,   1.98, False),
    ("Lavender",            7, 1, 54.38,   8.84, -25.71, False),
    ("Evergreen",           7, 2, 42.03, -15.80,  22.93, False),
    ("Steel Blue",          7, 3, 48.82,  -5.11, -23.08, False),
    ("Classic Light Skin",  7, 4, 65.10,  18.14,  18.68, False),
    ("Classic Dark Skin",   7, 5, 36.13,  14.15,  15.78, False),
]


def get_patches(card_type: int = 24, portrait: bool = False) -> List[Dict]:
    """Return patch reference data for the given card type.

    For the SpyderCheckr 24, returns rows E-H (rows 4-7, indices 24-47).
    Row indices are remapped to 0-3 for the 24-patch grid.

    If portrait=True, the grid is transposed: landscape (r, c) -> portrait (c, r).
    This handles the card being held vertically (6 rows x 4 cols for the 24).
    """
    if card_type == 24:
        patches = []
        for name, row, col, L, a, b, is_gray in SPYDERCHECKR_48:
            if row >= 4:
                r = row - 4  # remap to 0-3
                c = col
                if portrait:
                    # Transpose: grays run down the first column
                    r, c = c, r
                patches.append({
                    "name": name,
                    "row": r,
                    "col": c,
                    "lab": [L, a, b],
                    "is_gray": is_gray,
                })
        return patches
    else:
        patches = []
        for name, row, col, L, a, b, is_gray in SPYDERCHECKR_48:
            r, c = row, col
            if portrait:
                r, c = c, r
            patches.append({
                "name": name,
                "row": r,
                "col": c,
                "lab": [L, a, b],
                "is_gray": is_gray,
            })
        return patches


def get_grid_size(card_type: int = 24, portrait: bool = False) -> Tuple[int, int]:
    """Return (rows, cols) for the card type."""
    if card_type == 24:
        if portrait:
            return (6, 4)
        return (4, 6)
    if portrait:
        return (6, 8)
    return (8, 6)
