from __future__ import annotations

import asyncio
from pathlib import Path
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler


class _Handler(FileSystemEventHandler):
    def __init__(self, callback):
        self._callback = callback

    def on_created(self, event):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if path.suffix.lower() in (".png", ".jpg", ".jpeg", ".tiff", ".bmp"):
            message = {"type": "new_image", "path": path.name}
            try:
                loop = asyncio.get_running_loop()
                asyncio.run_coroutine_threadsafe(self._callback(message), loop)
            except RuntimeError:
                pass  # No event loop yet — acceptable during startup


class FolderWatcher:
    def __init__(self, directory: str, broadcast_fn):
        self._directory = directory
        self._observer = Observer()
        self._handler = _Handler(broadcast_fn)

    def start(self):
        self._observer.schedule(self._handler, self._directory, recursive=False)
        self._observer.daemon = True
        self._observer.start()

    def stop(self):
        self._observer.stop()
        self._observer.join(timeout=2)
