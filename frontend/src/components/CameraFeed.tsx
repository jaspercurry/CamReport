import { useState, useEffect, useRef, useCallback } from 'react';
import type { CameraDevice, Corners } from '../types';

interface Props {
  onCornersSet: (corners: Corners, deviceId: string) => void;
  onCaptureAndAnalyze: (filename: string, corners: Corners, deviceId: string) => void;
  existingCorners: Corners | null;
  activeDeviceId: string | null;
  onDeviceChange: (deviceId: string | null) => void;
}

const CORNER_LABELS = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'];

type Mode = 'live' | 'review';

export default function CameraFeed({
  onCornersSet,
  onCaptureAndAnalyze,
  existingCorners,
  activeDeviceId,
  onDeviceChange,
}: Props) {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(activeDeviceId);
  const [isOpen, setIsOpen] = useState(false);
  const [resolution, setResolution] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Corner picking state
  const [pickMode, setPickMode] = useState(false);
  const [pendingCorners, setPendingCorners] = useState<[number, number][]>([]);

  // Captured image review state
  const [mode, setMode] = useState<Mode>('live');
  const [capturedFilename, setCapturedFilename] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const liveImgRef = useRef<HTMLImageElement>(null);
  const stillImgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgNaturalSize, setImgNaturalSize] = useState<{ w: number; h: number } | null>(null);

  // Fetch devices on mount
  useEffect(() => {
    fetch('/api/cameras').then(r => r.json()).then(setDevices).catch(() => {});
  }, []);

  const openCamera = async (deviceId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cameras/${deviceId}/open`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setIsOpen(true);
        setResolution(data.resolution);
        setMode('live');
        setCapturedFilename(null);
        onDeviceChange(deviceId);
      }
    } finally {
      setLoading(false);
    }
  };

  const closeCamera = async () => {
    if (selectedDevice) {
      await fetch(`/api/cameras/${selectedDevice}`, { method: 'DELETE' });
    }
    setIsOpen(false);
    setResolution(null);
    setMode('live');
    setCapturedFilename(null);
    onDeviceChange(null);
  };

  const handleDeviceSelect = async (deviceId: string) => {
    if (isOpen && selectedDevice) {
      await closeCamera();
    }
    setSelectedDevice(deviceId);
    await openCamera(deviceId);
  };

  const handleCapture = async () => {
    if (!selectedDevice) return;
    setCapturing(true);
    try {
      const res = await fetch(`/api/cameras/${selectedDevice}/capture`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setCapturedFilename(data.filename);
        setMode('review');
        setPickMode(true);
        setPendingCorners([]);
      }
    } finally {
      setCapturing(false);
    }
  };

  const handleRetake = () => {
    setCapturedFilename(null);
    setMode('live');
    setPickMode(false);
    setPendingCorners([]);
  };

  // Get image coordinates from click (works for both live preview and still image)
  const getImageCoords = useCallback((e: React.MouseEvent): [number, number] | null => {
    // In review mode, use the still image's natural size
    if (mode === 'review' && stillImgRef.current && imgNaturalSize) {
      const rect = stillImgRef.current.getBoundingClientRect();
      const scaleX = imgNaturalSize.w / rect.width;
      const scaleY = imgNaturalSize.h / rect.height;
      return [
        (e.clientX - rect.left) * scaleX,
        (e.clientY - rect.top) * scaleY,
      ];
    }
    // In live mode, use the camera resolution
    const img = liveImgRef.current;
    if (!img || !resolution) return null;
    const rect = img.getBoundingClientRect();
    const scaleX = resolution[0] / rect.width;
    const scaleY = resolution[1] / rect.height;
    return [
      (e.clientX - rect.left) * scaleX,
      (e.clientY - rect.top) * scaleY,
    ];
  }, [resolution, mode, imgNaturalSize]);

  const handleImageClick = (e: React.MouseEvent) => {
    if (!pickMode) return;
    const coords = getImageCoords(e);
    if (!coords) return;

    const updated = [...pendingCorners, coords] as [number, number][];
    if (updated.length === 4) {
      setPendingCorners(updated);
      setPickMode(false);

      if (mode === 'review' && capturedFilename && selectedDevice) {
        // In review mode: save corners and analyze the captured image
        onCornersSet(updated, selectedDevice);
        onCaptureAndAnalyze(capturedFilename, updated, selectedDevice);
        // Stay in review mode — parent will show analysis results
        // User can click "Back to Live" to return to preview
        setCapturedFilename(null);
        setMode('live');
      } else if (selectedDevice) {
        // In live mode: just save the corners
        onCornersSet(updated, selectedDevice);
      }
    } else {
      setPendingCorners(updated);
    }
  };

  // Draw corner overlay on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = mode === 'review' ? stillImgRef.current : liveImgRef.current;
    if (!canvas || !img) return;

    const rect = img.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Determine image dimensions for coordinate mapping
    const imgW = mode === 'review' ? (imgNaturalSize?.w || 1) : (resolution?.[0] || 1);
    const imgH = mode === 'review' ? (imgNaturalSize?.h || 1) : (resolution?.[1] || 1);
    const scaleX = rect.width / imgW;
    const scaleY = rect.height / imgH;

    const points = pickMode ? pendingCorners : (existingCorners || []);
    if (points.length === 0) return;

    // Draw polygon
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash(pickMode && points.length < 4 ? [6, 4] : []);

    if (points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(points[0][0] * scaleX, points[0][1] * scaleY);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i][0] * scaleX, points[i][1] * scaleY);
      }
      if (points.length === 4) ctx.closePath();
      ctx.stroke();
    }

    // Draw corner dots + labels
    for (let i = 0; i < points.length; i++) {
      const [px, py] = points[i];
      const sx = px * scaleX;
      const sy = py * scaleY;

      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'white';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText(CORNER_LABELS[i], sx + 10, sy - 8);
    }
  }, [pickMode, pendingCorners, existingCorners, resolution, mode, imgNaturalSize]);

  const remaining = 4 - pendingCorners.length;

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Device selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <select
          value={selectedDevice || ''}
          onChange={e => e.target.value && handleDeviceSelect(e.target.value)}
          style={{
            padding: '8px 12px',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 14,
            flex: 1,
          }}
        >
          <option value="">Select a camera...</option>
          {devices.map(d => (
            <option key={d.device_id} value={d.device_id}>{d.name}</option>
          ))}
        </select>
        <button
          onClick={() => fetch('/api/cameras').then(r => r.json()).then(setDevices)}
          className="btn-redraw"
          title="Refresh camera list"
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)' }}>
          Opening camera...
        </div>
      )}

      {/* === REVIEW MODE: Show captured still image for corner picking === */}
      {isOpen && selectedDevice && mode === 'review' && capturedFilename && (
        <div>
          <div style={{
            fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8,
            background: 'var(--bg-tertiary)', padding: '8px 12px', borderRadius: 6,
          }}>
            Click the 4 corners of the SpyderCheckr patch area (inside the black border), starting from top-left.
          </div>
          <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
            <img
              ref={stillImgRef}
              src={`/screenshots/${capturedFilename}`}
              alt="Captured frame"
              onLoad={(e) => {
                const img = e.currentTarget;
                setImgNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
              }}
              style={{
                width: '100%',
                borderRadius: 8,
                display: 'block',
                cursor: 'crosshair',
              }}
              onClick={handleImageClick}
            />
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
              }}
            />
            {remaining > 0 && (
              <div style={{
                position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.8)', color: 'white', padding: '8px 16px',
                borderRadius: 8, fontSize: 13, textAlign: 'center', pointerEvents: 'none',
              }}>
                Click the {CORNER_LABELS[4 - remaining]} corner ({remaining} remaining)
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button className="btn-delete" onClick={handleRetake} style={{ fontSize: 13 }}>
              Retake
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center' }}>
              Pick all 4 corners to analyze, or Retake for a new capture
            </span>
          </div>
        </div>
      )}

      {/* === LIVE MODE: Show MJPEG preview === */}
      {isOpen && selectedDevice && mode === 'live' && (
        <div>
          <div style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
            <img
              ref={liveImgRef}
              src={`/api/cameras/${selectedDevice}/preview`}
              alt="Camera preview"
              style={{
                width: '100%',
                borderRadius: 8,
                display: 'block',
                cursor: pickMode ? 'crosshair' : 'default',
              }}
              onClick={handleImageClick}
            />
            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
              }}
            />
            {pickMode && remaining > 0 && (
              <div style={{
                position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                background: 'rgba(0,0,0,0.8)', color: 'white', padding: '8px 16px',
                borderRadius: 8, fontSize: 13, textAlign: 'center', pointerEvents: 'none',
              }}>
                Click the {CORNER_LABELS[4 - remaining]} corner ({remaining} remaining)
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn-create" onClick={handleCapture} disabled={capturing}>
              {capturing ? 'Capturing...' : 'Capture Frame'}
            </button>
            <button
              className="btn-redraw"
              onClick={() => { setPickMode(!pickMode); setPendingCorners([]); }}
            >
              {pickMode ? 'Cancel Picking' : 'Pick Corners on Preview'}
            </button>
            <button className="btn-redraw" onClick={closeCamera}>
              Close Camera
            </button>
            {resolution && (
              <span style={{ fontSize: 12, color: 'var(--text-secondary)', alignSelf: 'center' }}>
                {resolution[0]}x{resolution[1]}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
