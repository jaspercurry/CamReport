import { useRef, useState, useEffect, useCallback } from 'react';
import type { Rectangle } from '../types';

interface Props {
  imagePath: string;
  rectangle: Rectangle | null;
  onRectangleDrawn: (rect: Rectangle) => void;
  drawMode: boolean;
}

export default function ImageViewer({ imagePath, rectangle, onRectangleDrawn, drawMode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [currentPos, setCurrentPos] = useState<{ x: number; y: number } | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  const getScaledCoords = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageSize) return null;

    const rect = canvas.getBoundingClientRect();
    const scaleX = imageSize.width / rect.width;
    const scaleY = imageSize.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }, [imageSize]);

  const drawRect = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imageSize) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const displayRect = canvas.getBoundingClientRect();
    canvas.width = displayRect.width * 2;
    canvas.height = displayRect.height * 2;
    ctx.scale(2, 2);

    ctx.clearRect(0, 0, displayRect.width, displayRect.height);

    const scaleX = displayRect.width / imageSize.width;
    const scaleY = displayRect.height / imageSize.height;

    // Draw existing rectangle
    const rectToDraw = drawing && startPos && currentPos
      ? {
          x: Math.min(startPos.x, currentPos.x),
          y: Math.min(startPos.y, currentPos.y),
          width: Math.abs(currentPos.x - startPos.x),
          height: Math.abs(currentPos.y - startPos.y),
        }
      : rectangle;

    if (rectToDraw) {
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.setLineDash(drawing ? [6, 4] : []);
      ctx.strokeRect(
        rectToDraw.x * scaleX,
        rectToDraw.y * scaleY,
        rectToDraw.width * scaleX,
        rectToDraw.height * scaleY,
      );

      // Dim area outside rectangle
      if (!drawing) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        // Top
        ctx.fillRect(0, 0, displayRect.width, rectToDraw.y * scaleY);
        // Bottom
        const bottomY = (rectToDraw.y + rectToDraw.height) * scaleY;
        ctx.fillRect(0, bottomY, displayRect.width, displayRect.height - bottomY);
        // Left
        ctx.fillRect(0, rectToDraw.y * scaleY, rectToDraw.x * scaleX, rectToDraw.height * scaleY);
        // Right
        const rightX = (rectToDraw.x + rectToDraw.width) * scaleX;
        ctx.fillRect(rightX, rectToDraw.y * scaleY, displayRect.width - rightX, rectToDraw.height * scaleY);
      }
    }
  }, [rectangle, drawing, startPos, currentPos, imageSize]);

  useEffect(() => {
    drawRect();
  }, [drawRect]);

  const handleImageLoad = () => {
    const img = imgRef.current;
    if (img) {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!drawMode) return;
    const coords = getScaledCoords(e);
    if (coords) {
      setDrawing(true);
      setStartPos(coords);
      setCurrentPos(coords);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return;
    const coords = getScaledCoords(e);
    if (coords) {
      setCurrentPos(coords);
    }
  };

  const handleMouseUp = () => {
    if (!drawing || !startPos || !currentPos) return;
    setDrawing(false);

    const rect: Rectangle = {
      x: Math.min(startPos.x, currentPos.x),
      y: Math.min(startPos.y, currentPos.y),
      width: Math.abs(currentPos.x - startPos.x),
      height: Math.abs(currentPos.y - startPos.y),
    };

    if (rect.width > 10 && rect.height > 10) {
      onRectangleDrawn(rect);
    }

    setStartPos(null);
    setCurrentPos(null);
  };

  const imageUrl = `/screenshots/${imagePath}`;

  return (
    <div className="image-viewer" ref={containerRef}>
      <img
        ref={imgRef}
        src={imageUrl}
        alt="Screenshot"
        onLoad={handleImageLoad}
        draggable={false}
      />
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: drawMode ? 'crosshair' : 'default' }}
      />
      {drawMode && !rectangle && (
        <div className="draw-prompt">
          Click and drag to select the SpyderCheckr card
        </div>
      )}
    </div>
  );
}
