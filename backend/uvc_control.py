"""
UVC camera control wrapper.

Abstracts the underlying tool (uvc-util, AVFoundation, etc.) behind a
common interface. Currently uses uvc-util via subprocess on macOS.
"""
from __future__ import annotations

import re
import subprocess
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional


@dataclass
class UVCControl:
    """A single UVC control with its metadata."""
    name: str
    min_val: int
    max_val: int
    step: int
    default: int
    current: int
    available: bool = True


class UVCBackend(ABC):
    """Abstract base for UVC control backends."""

    @abstractmethod
    def list_controls(self, device_id: str) -> List[UVCControl]:
        ...

    @abstractmethod
    def get_control(self, device_id: str, name: str) -> Optional[int]:
        ...

    @abstractmethod
    def set_control(self, device_id: str, name: str, value: int) -> bool:
        ...

    def reset_control(self, device_id: str, name: str) -> bool:
        controls = self.list_controls(device_id)
        for c in controls:
            if c.name == name:
                return self.set_control(device_id, name, c.default)
        return False

    def reset_all(self, device_id: str) -> bool:
        controls = self.list_controls(device_id)
        ok = True
        for c in controls:
            if c.available:
                if not self.set_control(device_id, c.name, c.default):
                    ok = False
        return ok

    def probe_controls(self, device_id: str) -> List[UVCControl]:
        """Test each control to determine actual availability.

        A control is marked unavailable if:
        - min == max (no range to adjust)
        - set/get doesn't round-trip (driver ignores writes)
        """
        controls = self.list_controls(device_id)
        for c in controls:
            if c.min_val == c.max_val:
                c.available = False
                continue

            # Try setting to a value and reading back
            test_val = c.min_val if c.current != c.min_val else c.max_val
            if self.set_control(device_id, c.name, test_val):
                readback = self.get_control(device_id, c.name)
                if readback is None or abs(readback - test_val) > c.step:
                    c.available = False
                # Restore original value
                self.set_control(device_id, c.name, c.current)
            else:
                c.available = False

        return controls


class UvcUtilBackend(UVCBackend):
    """UVC control via jtfrey/uvc-util command-line tool."""

    # Map friendly names to uvc-util control names
    CONTROL_NAMES = {
        "white_balance_temperature": "white-balance-temp",
        "brightness": "brightness",
        "contrast": "contrast",
        "saturation": "saturation",
        "sharpness": "sharpness",
        "gain": "gain",
        "exposure_time": "exposure-time-abs",
        "auto_exposure": "auto-exposure-mode",
        "auto_white_balance": "auto-white-balance-temp",
        "gamma": "gamma",
        "hue": "hue",
        "backlight_compensation": "backlight-compensation",
        "power_line_frequency": "power-line-freq",
    }

    def __init__(self, binary_path: Optional[str] = None):
        if binary_path:
            self._binary = binary_path
        else:
            # Search for uvc-util in common locations
            candidates = [
                Path(__file__).parent / "bin" / "uvc-util",
                Path("/usr/local/bin/uvc-util"),
                Path.home() / "bin" / "uvc-util",
            ]
            self._binary = None
            for p in candidates:
                if p.exists() and p.is_file():
                    self._binary = str(p)
                    break

        self._cache: Dict[str, List[UVCControl]] = {}

    @property
    def available(self) -> bool:
        return self._binary is not None

    def _run(self, *args: str, timeout: int = 5) -> Optional[str]:
        if not self._binary:
            return None
        try:
            result = subprocess.run(
                [self._binary, *args],
                capture_output=True, text=True, timeout=timeout,
            )
            return result.stdout
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            return None

    def _find_device_arg(self, device_id: str) -> List[str]:
        """Build uvc-util device selection args."""
        # uvc-util uses -d <vid:pid> or nothing (first device)
        # For now, just use the first device — most setups have one USB webcam
        # TODO: support multiple devices by VID:PID or location
        return []

    def list_controls(self, device_id: str) -> List[UVCControl]:
        if device_id in self._cache:
            return self._cache[device_id]

        controls = []
        device_args = self._find_device_arg(device_id)

        for friendly_name, uvc_name in self.CONTROL_NAMES.items():
            output = self._run(*device_args, "-g", uvc_name)
            if output is None:
                continue

            # Parse output: uvc-util prints something like:
            # "brightness = 128 (min=0 max=255 step=1 default=128)"
            # or just the value on some versions
            val = self._parse_value(output)
            info = self._parse_range(output)

            if val is not None:
                controls.append(UVCControl(
                    name=friendly_name,
                    min_val=info.get("min", 0),
                    max_val=info.get("max", 255),
                    step=info.get("step", 1),
                    default=info.get("default", val),
                    current=val,
                ))

        self._cache[device_id] = controls
        return controls

    def get_control(self, device_id: str, name: str) -> Optional[int]:
        uvc_name = self.CONTROL_NAMES.get(name, name)
        device_args = self._find_device_arg(device_id)
        output = self._run(*device_args, "-g", uvc_name)
        if output:
            return self._parse_value(output)
        return None

    def set_control(self, device_id: str, name: str, value: int) -> bool:
        uvc_name = self.CONTROL_NAMES.get(name, name)
        device_args = self._find_device_arg(device_id)
        output = self._run(*device_args, "-s", uvc_name, "--", str(int(value)))
        return output is not None

    def invalidate_cache(self, device_id: str):
        self._cache.pop(device_id, None)

    @staticmethod
    def _parse_value(output: str) -> Optional[int]:
        """Extract the current value from uvc-util output."""
        # Try "name = <value>" pattern
        m = re.search(r'=\s*(-?\d+)', output)
        if m:
            return int(m.group(1))
        # Try bare number
        m = re.search(r'(-?\d+)', output)
        if m:
            return int(m.group(1))
        return None

    @staticmethod
    def _parse_range(output: str) -> Dict[str, int]:
        """Extract min/max/step/default from uvc-util output."""
        info = {}
        for key in ("min", "max", "step", "default"):
            m = re.search(rf'{key}\s*=?\s*(-?\d+)', output, re.IGNORECASE)
            if m:
                info[key] = int(m.group(1))
        return info


class MockBackend(UVCBackend):
    """Mock backend for testing without uvc-util installed."""

    def __init__(self):
        self._values: Dict[str, Dict[str, int]] = {}
        self._controls = {
            "white_balance_temperature": (2800, 6500, 10, 4500),
            "brightness": (0, 255, 1, 128),
            "contrast": (0, 255, 1, 128),
            "saturation": (0, 255, 1, 128),
            "gain": (0, 255, 1, 0),
            "exposure_time": (1, 10000, 1, 333),
            "auto_exposure": (1, 8, 1, 8),
            "auto_white_balance": (0, 1, 1, 1),
        }

    def list_controls(self, device_id: str) -> List[UVCControl]:
        if device_id not in self._values:
            self._values[device_id] = {
                name: default for name, (_, _, _, default) in self._controls.items()
            }

        controls = []
        for name, (min_v, max_v, step, default) in self._controls.items():
            controls.append(UVCControl(
                name=name,
                min_val=min_v,
                max_val=max_v,
                step=step,
                default=default,
                current=self._values[device_id].get(name, default),
            ))
        return controls

    def get_control(self, device_id: str, name: str) -> Optional[int]:
        if device_id not in self._values:
            self.list_controls(device_id)
        return self._values.get(device_id, {}).get(name)

    def set_control(self, device_id: str, name: str, value: int) -> bool:
        if device_id not in self._values:
            self.list_controls(device_id)
        if name in self._controls:
            self._values[device_id][name] = int(value)
            return True
        return False


def get_backend(binary_path: Optional[str] = None) -> UVCBackend:
    """Return the best available UVC backend."""
    backend = UvcUtilBackend(binary_path)
    if backend.available:
        return backend
    # Fallback to mock for development
    return MockBackend()
