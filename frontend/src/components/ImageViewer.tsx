import { useRef, useState, useEffect, useCallback } from 'react';
import type { Corners } from '../types';

interface Props {
  imagePath: string;
  corners: Corners | null;
  onCornersSet: (corners: Corners) => void;
  pickMode: boolean;
}

const CORNER_LABELS = ['Top-Left', 'Top-Right', 'Bottom-Right', 'Bottom-Left'];

export default function ImageViewer({ imagePath, corners, onCornersSet, pickMode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [pendingCorners, setPendingCorners] = useState<[number, number][]>([]);

  const getImageCoords = useCallback((e: React.MouseEvent): [number, number] | null => {
    const canvas = canvasRef.current;
    if (!canvas || !imageSize) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = imageSize.width / rect.width;
    const scaleY = imageSize.height / rect.height;
    return [
      (e.clientX - rect.left) * scaleX,
      (e.clientY - rect.top) * scaleY,
    ];
  }, [imageSize]);

  const drawOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageSize) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displayRect = canvas.getBoundingClientRect();
    canvas.width = displayRect.width * 2;
    canvas.height = displayRect.height * 2;
    ctx.scale(2, 2);
    ctx.clearRect(0, 0, displayRect.width, displayRect.height);

    const scaleX = displayRect.width / imageSize.width;
    const scaleY = displayRect.height / imageSize.height;

    const pointsToDraw = pickMode ? pendingCorners : (corners || []);

    if (pointsToDraw.length === 0) return;

    // Draw the polygon outline
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.setLineDash(pickMode && pointsToDraw.length < 4 ? [6, 4] : []);

    if (pointsToDraw.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(pointsToDraw[0][0] * scaleX, pointsToDraw[0][1] * scaleY);
      for (let i = 1; i < pointsToDraw.length; i++) {
        ctx.lineTo(pointsToDraw[i][0] * scaleX, pointsToDraw[i][1] * scaleY);
      }
      if (pointsToDraw.length === 4) {
        ctx.closePath();
      }
      ctx.stroke();
    }

    // Dim area outside the quadrilateral (only when we have all 4 corners and not picking)
    if (pointsToDraw.length === 4 && !pickMode) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
      ctx.beginPath();
      ctx.rect(0, 0, displayRect.width, displayRect.height);
      ctx.moveTo(pointsToDraw[0][0] * scaleX, pointsToDraw[0][1] * scaleY);
      for (let i = 1; i < 4; i++) {
        ctx.lineTo(pointsToDraw[i][0] * scaleX, pointsToDraw[i][1] * scaleY);
      }
      ctx.closePath();
      ctx.fill('evenodd');
      ctx.restore();
    }

    // Draw corner points
    for (let i = 0; i < pointsToDraw.length; i++) {
      const [px, py] = pointsToDraw[i];
      const sx = px * scaleX;
      const sy = py * scaleY;

      // Circle
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fill();

      // White center
      ctx.fillStyle = 'white';
      ctx.beginPath();
      ctx.arc(sx, sy, 3, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = 'white';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText(CORNER_LABELS[i], sx + 10, sy - 8);
    }
  }, [corners, pendingCorners, pickMode, imageSize]);

  useEffect(() => {
    drawOverlay();
  }, [drawOverlay]);

  useEffect(() => {
    if (pickMode) {
      setPendingCorners([]);
    }
  }, [pickMode]);

  const handleImageLoad = () => {
    const img = imgRef.current;
    if (img) {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!pickMode) return;
    const coords = getImageCoords(e);
    if (!coords) return;

    const updated = [...pendingCorners, coords] as [number, number][];
    if (updated.length === 4) {
      setPendingCorners(updated);
      onCornersSet(updated);
    } else {
      setPendingCorners(updated);
    }
  };

  const imageUrl = `/screenshots/${imagePath}`;
  const remaining = 4 - pendingCorners.length;

  return (
    <div className="image-viewer">
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Screenshot"
        onLoad={handleImageLoad}
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        style={{ cursor: pickMode ? 'crosshair' : 'default' }}
      />
      {pickMode && remaining > 0 && (
        <div className="draw-prompt" style={{ pointerEvents: 'none', flexDirection: 'column', gap: 4 }}>
          <div>Click the {CORNER_LABELS[4 - remaining]} corner of the patch area</div>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            {remaining} {remaining === 1 ? 'point' : 'points'} remaining — click inside the black border
          </div>
        </div>
      )}
    </div>
  );
}
