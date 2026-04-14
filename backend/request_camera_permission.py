"""Request macOS camera permission via AVFoundation, then start the server."""
import sys
import time

import AVFoundation
from AppKit import NSApplication, NSApp, NSApplicationActivationPolicyAccessory
from PyObjCTools import AppHelper


def check_and_request_camera():
    """Check camera authorization and request if needed."""
    status = AVFoundation.AVCaptureDevice.authorizationStatusForMediaType_(
        AVFoundation.AVMediaTypeVideo
    )

    status_names = {0: "notDetermined", 1: "restricted", 2: "denied", 3: "authorized"}
    print(f"Camera auth status: {status} ({status_names.get(status, 'unknown')})")

    if status == 3:  # authorized
        print("Camera access: authorized")
        start_server()
        return

    if status == 2:  # denied
        print("Camera access: DENIED")
        print("Go to System Settings > Privacy & Security > Camera and enable access for Terminal.")
        sys.exit(1)

    if status == 1:  # restricted
        print("Camera access: restricted by system policy")
        sys.exit(1)

    # status == 0: notDetermined — need to request
    print("Requesting camera permission (a dialog should appear)...")

    def on_response(granted):
        if granted:
            print("Camera access: GRANTED!")
            # Schedule server start on main thread
            AppHelper.callAfter(start_server)
        else:
            print("Camera access: DENIED by user")
            AppHelper.callAfter(lambda: sys.exit(1))

    AVFoundation.AVCaptureDevice.requestAccessForMediaType_completionHandler_(
        AVFoundation.AVMediaTypeVideo,
        on_response,
    )


def start_server():
    """Start the FastAPI server."""
    # Stop the run loop since we don't need it anymore
    NSApp.stop_(None)

    # Verify we can actually open a camera now
    import cv2
    cap = cv2.VideoCapture(0)
    if cap.isOpened():
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        print(f"Camera test: OK ({w}x{h})")
        cap.release()
    else:
        print("WARNING: Camera still not opening via OpenCV.")
        print("Trying AVFoundation device enumeration as a secondary check...")
        devices = AVFoundation.AVCaptureDevice.devicesWithMediaType_(AVFoundation.AVMediaTypeVideo)
        print(f"AVFoundation sees {len(devices)} camera(s):")
        for d in devices:
            print(f"  - {d.localizedName()} (id: {d.uniqueID()})")

    print("\nStarting CamReport server on http://0.0.0.0:8000 ...")
    import uvicorn
    from server import app as fastapi_app
    uvicorn.run(fastapi_app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    app = NSApplication.sharedApplication()
    # Make us a proper app that can show dialogs
    app.setActivationPolicy_(NSApplicationActivationPolicyAccessory)
    app.activateIgnoringOtherApps_(True)

    # Schedule the permission check to run once the run loop is active
    AppHelper.callAfter(check_and_request_camera)

    # Run the event loop (required for macOS to show permission dialogs)
    # This will be stopped by start_server() after permission is granted
    AppHelper.runEventLoop()
