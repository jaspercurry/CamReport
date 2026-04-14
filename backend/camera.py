"""
Camera management: enumeration, streaming, and frame capture.

Uses a single reader thread per camera to avoid OpenCV crash on macOS
when multiple VideoCapture instances access the same device.
Always opens at max resolution and resizes for preview (macOS OpenCV
crashes when switching from low-res to high-res via cap.set()).
"""
from __future__ import annotations

import subprocess
import json
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, Generator, List, Optional

import cv2
import numpy as np


@dataclass
class CameraInfo:
    """Describes a connected webcam."""
    device_id: str          # uniqueID or index string
    name: str
    index: int              # OpenCV index
    vid_pid: str = ""       # USB vendor:product


@dataclass
class CameraHandle:
    """Active camera session with a reader thread."""
    info: CameraInfo
    cap: cv2.VideoCapture
    frame: Optional[np.ndarray] = None
    frame_lock: threading.Lock = field(default_factory=threading.Lock)
    running: bool = False
    thread: Optional[threading.Thread] = None
    width: int = 0
    height: int = 0


class CameraManager:
    """Singleton manager for all camera sessions."""

    def __init__(self):
        self._cameras: Dict[str, CameraHandle] = {}

    # Names/patterns to exclude from camera lists (virtual cameras, iPhone)
    EXCLUDED_PATTERNS = [
        "virtual", "camo", "iphone", "ipad", "continuity",
        "obs ", "snap camera", "mmhmm",
    ]

    def _is_excluded(self, name: str) -> bool:
        """Check if a camera name matches an exclusion pattern."""
        lower = name.lower()
        return any(p in lower for p in self.EXCLUDED_PATTERNS)

    def list_devices(self) -> List[CameraInfo]:
        """Enumerate connected webcams using AVFoundation via PyObjC.

        This gives us the exact device list that OpenCV's AVFoundation
        backend uses, with correct ordering. Falls back to system_profiler
        if AVFoundation is not available.
        """
        try:
            return self._enumerate_avfoundation()
        except Exception:
            return self._enumerate_system_profiler()

    def _enumerate_avfoundation(self) -> List[CameraInfo]:
        """Use AVFoundation DiscoverySession for accurate device enumeration.

        This returns devices in the same order OpenCV uses, giving us
        correct index-to-name mapping.
        """
        import AVFoundation

        # Get all video devices via AVFoundation — same API OpenCV uses
        discovery = AVFoundation.AVCaptureDevice.DiscoverySession.alloc() \
            .initWithDeviceTypes_mediaType_position_(
                [
                    AVFoundation.AVCaptureDeviceTypeExternal,
                    AVFoundation.AVCaptureDeviceTypeBuiltInWideAngleCamera,
                ],
                AVFoundation.AVMediaTypeVideo,
                AVFoundation.AVCaptureDevicePositionUnspecified,
            )

        devices = []
        for i, device in enumerate(discovery.devices()):
            name = str(device.localizedName())
            uid = str(device.uniqueID())
            model = str(device.modelID()) if device.modelID() else ""

            if self._is_excluded(name):
                continue

            devices.append(CameraInfo(
                device_id=uid,
                name=name,
                index=i,  # This IS the correct OpenCV index
                vid_pid=model,
            ))

        return devices

    def _enumerate_system_profiler(self) -> List[CameraInfo]:
        """Fallback: use system_profiler (less accurate index mapping)."""
        devices = []
        try:
            out = subprocess.run(
                ["system_profiler", "SPCameraDataType", "-json"],
                capture_output=True, text=True, timeout=5,
            )
            data = json.loads(out.stdout)
            for i, cam in enumerate(data.get("SPCameraDataType", [])):
                name = cam.get("_name", "Unknown Camera")
                uid = cam.get("spcamera_unique-id", name)
                model = cam.get("spcamera_model-id", "")

                if self._is_excluded(name):
                    continue

                devices.append(CameraInfo(
                    device_id=uid,
                    name=name,
                    index=i,
                    vid_pid=model,
                ))
        except Exception:
            pass
        return devices

    def _find_opencv_index(self, device_id: str, name: str) -> int:
        """Find the correct OpenCV index for a device.

        Uses AVFoundation to get the authoritative device ordering,
        which matches what OpenCV's AVFoundation backend uses internally.
        """
        try:
            import AVFoundation
            discovery = AVFoundation.AVCaptureDevice.DiscoverySession.alloc() \
                .initWithDeviceTypes_mediaType_position_(
                    [
                        AVFoundation.AVCaptureDeviceTypeExternal,
                        AVFoundation.AVCaptureDeviceTypeBuiltInWideAngleCamera,
                    ],
                    AVFoundation.AVMediaTypeVideo,
                    AVFoundation.AVCaptureDevicePositionUnspecified,
                )

            for i, device in enumerate(discovery.devices()):
                uid = str(device.uniqueID())
                if uid == device_id:
                    return i
                # Also match by name as fallback
                if str(device.localizedName()) == name:
                    return i

        except Exception:
            pass

        # Last resort: find in our filtered list and use that position
        all_devices = self.list_devices()
        for d in all_devices:
            if d.device_id == device_id:
                return d.index
        return 0

    def open_camera(self, device_id: str) -> CameraHandle:
        """Open a camera at max resolution and start the reader thread."""
        if device_id in self._cameras:
            return self._cameras[device_id]

        # Find the camera name from our device list
        devices = self.list_devices()
        name = f"Camera {device_id}"
        for d in devices:
            if d.device_id == device_id:
                name = d.name
                break

        # Find the correct OpenCV index
        index = self._find_opencv_index(device_id, name)

        cap = cv2.VideoCapture(index)
        if not cap.isOpened():
            raise RuntimeError(f"Could not open camera {device_id} (index {index}). Check macOS camera permissions.")

        # Request max resolution — camera will give its highest supported
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 3840)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 2160)

        # Read actual resolution
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        handle = CameraHandle(
            info=CameraInfo(device_id=device_id, name=name, index=index),
            cap=cap,
            width=w,
            height=h,
        )
        handle.running = True
        handle.thread = threading.Thread(target=self._reader_loop, args=(handle,), daemon=True)
        handle.thread.start()

        self._cameras[device_id] = handle
        return handle

    def _reader_loop(self, handle: CameraHandle):
        """Continuously read frames from the camera into the shared buffer."""
        while handle.running:
            ret, frame = handle.cap.read()
            if ret and frame is not None:
                with handle.frame_lock:
                    handle.frame = frame.copy()
            else:
                time.sleep(0.01)

    def get_latest_frame(self, device_id: str) -> Optional[np.ndarray]:
        """Return the latest full-resolution frame (BGR)."""
        handle = self._cameras.get(device_id)
        if not handle:
            return None
        with handle.frame_lock:
            return handle.frame.copy() if handle.frame is not None else None

    def capture_frame_rgb(self, device_id: str) -> Optional[np.ndarray]:
        """Return the latest full-resolution frame as RGB numpy array."""
        frame = self.get_latest_frame(device_id)
        if frame is None:
            return None
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    def discard_frames(self, device_id: str, count: int = 5, settle_ms: int = 500):
        """Wait for settling time and discard stale frames.

        Used after UVC control changes to ensure the captured frame
        reflects the new settings.
        """
        time.sleep(settle_ms / 1000.0)
        # The reader thread is continuously updating, so just wait
        # for enough frames to have been read
        handle = self._cameras.get(device_id)
        if not handle:
            return
        fps = handle.cap.get(cv2.CAP_PROP_FPS) or 30
        frame_time = 1.0 / fps
        time.sleep(frame_time * count)

    def get_preview_generator(
        self, device_id: str, scale_width: int = 960, fps: int = 15,
    ) -> Generator[bytes, None, None]:
        """Yield JPEG-encoded preview frames for MJPEG streaming."""
        handle = self._cameras.get(device_id)
        if not handle:
            return

        frame_interval = 1.0 / fps
        while handle.running:
            start = time.monotonic()
            with handle.frame_lock:
                frame = handle.frame.copy() if handle.frame is not None else None

            if frame is not None:
                # Resize for preview
                h, w = frame.shape[:2]
                scale = scale_width / w
                new_h = int(h * scale)
                small = cv2.resize(frame, (scale_width, new_h))

                _, jpeg = cv2.imencode('.jpg', small, [cv2.IMWRITE_JPEG_QUALITY, 70])
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n"
                    + jpeg.tobytes()
                    + b"\r\n"
                )

            elapsed = time.monotonic() - start
            sleep_time = frame_interval - elapsed
            if sleep_time > 0:
                time.sleep(sleep_time)

    def close_camera(self, device_id: str):
        """Stop the reader thread and release the camera."""
        handle = self._cameras.pop(device_id, None)
        if handle:
            handle.running = False
            if handle.thread:
                handle.thread.join(timeout=3)
            handle.cap.release()

    def close_all(self):
        """Release all cameras."""
        for device_id in list(self._cameras.keys()):
            self.close_camera(device_id)

    def get_handle(self, device_id: str) -> Optional[CameraHandle]:
        """Get the active handle for a camera."""
        return self._cameras.get(device_id)
