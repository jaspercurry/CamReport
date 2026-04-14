import { useState, useEffect } from 'react';
import type { CameraSession, Rectangle } from '../types';
import ScoreBadge from './ScoreBadge';
import PatchGrid from './PatchGrid';
import IterationHistory from './IterationHistory';
import ImageViewer from './ImageViewer';

interface Props {
  session: CameraSession;
  onAnalyze: (imagePath: string, rectangle?: Rectangle) => void;
  onUpdateRectangle: (rect: Rectangle) => void;
  onDelete: () => void;
}

export default function ReportCard({ session, onAnalyze, onUpdateRectangle, onDelete }: Props) {
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [drawMode, setDrawMode] = useState(false);
  const [availableImages, setAvailableImages] = useState<string[]>([]);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/images').then(r => r.json()).then(setAvailableImages);
  }, [session.results.length]);

  const currentIndex = viewIndex ?? (session.results.length - 1);
  const result = session.results[currentIndex] ?? null;
  const hasResults = session.results.length > 0;
  // Detect portrait from rectangle aspect ratio
  const isPortrait = session.rectangle ? session.rectangle.height > session.rectangle.width : false;
  const gridRows = session.card_type === 48 ? (isPortrait ? 6 : 8) : (isPortrait ? 6 : 4);
  const gridCols = session.card_type === 48 ? (isPortrait ? 8 : 6) : (isPortrait ? 4 : 6);

  const handleRectangleDrawn = (rect: Rectangle) => {
    setDrawMode(false);
    onUpdateRectangle(rect);

    // If we have a current image, re-analyze with the new rectangle
    if (result) {
      onAnalyze(result.image_path, rect);
    }
  };

  return (
    <div style={{ maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600 }}>{session.name}</h2>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
            SpyderCheckr {session.card_type}
            {hasResults && ` · ${session.results.length} ${session.results.length === 1 ? 'capture' : 'captures'}`}
          </div>
        </div>
        {result && <ScoreBadge deltaE={result.mean_delta_e} size="large" />}
      </div>

      {/* Benchmark legend */}
      <div className="benchmark-legend" style={{ marginBottom: 20 }}>
        <div className="benchmark-item">
          <div className="benchmark-dot" style={{ background: 'var(--green)' }} />
          &lt;3 Excellent
        </div>
        <div className="benchmark-item">
          <div className="benchmark-dot" style={{ background: 'var(--yellow)' }} />
          3-6 Good
        </div>
        <div className="benchmark-item">
          <div className="benchmark-dot" style={{ background: 'var(--orange)' }} />
          6-10 Needs work
        </div>
        <div className="benchmark-item">
          <div className="benchmark-dot" style={{ background: 'var(--red)' }} />
          &gt;10 Poor
        </div>
      </div>

      {!hasResults && !selectedImage ? (
        <div className="report-card">
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: 16, marginBottom: 12 }}>No captures yet</p>
            <p style={{ fontSize: 14, marginBottom: 20 }}>
              Save a screenshot to ~/Desktop/webcam-cal/ or select an existing image below.
            </p>
            {availableImages.length > 0 ? (
              <div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Images in watched folder
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 500, margin: '0 auto' }}>
                  {availableImages.map(img => (
                    <button
                      key={img}
                      onClick={() => { setSelectedImage(img); setDrawMode(true); }}
                      style={{
                        padding: '10px 16px',
                        background: 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                        textAlign: 'left',
                        fontSize: 14,
                        cursor: 'pointer',
                      }}
                    >
                      {img}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 13 }}>No images found in ~/Desktop/webcam-cal/</p>
            )}
          </div>
        </div>
      ) : !hasResults && selectedImage ? (
        <div className="report-card">
          <div className="report-body">
            <div style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Draw a rectangle around the SpyderCheckr card, then the analysis will run automatically.
            </div>
            <ImageViewer
              imagePath={selectedImage}
              rectangle={null}
              onRectangleDrawn={(rect) => {
                setDrawMode(false);
                onUpdateRectangle(rect);
                onAnalyze(selectedImage, rect);
                setSelectedImage(null);
              }}
              drawMode={true}
            />
            <button
              className="btn-redraw"
              onClick={() => { setSelectedImage(null); setDrawMode(false); }}
              style={{ alignSelf: 'flex-start' }}
            >
              Back to image list
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Iteration navigation + add image */}
          <div className="iteration-nav" style={{ marginBottom: 16 }}>
            {session.results.length > 1 && (
              <>
                <button
                  onClick={() => setViewIndex(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex <= 0}
                >
                  Prev
                </button>
                <span>Capture {currentIndex + 1} of {session.results.length}</span>
                <button
                  onClick={() => setViewIndex(Math.min(session.results.length - 1, currentIndex + 1))}
                  disabled={currentIndex >= session.results.length - 1}
                >
                  Next
                </button>
                <button onClick={() => setViewIndex(null)}>Latest</button>
              </>
            )}
            <div style={{ flex: 1 }} />
            <div style={{ position: 'relative' }}>
              <button
                className="btn-redraw"
                onClick={() => { setShowImagePicker(!showImagePicker); fetch('/api/images').then(r => r.json()).then(setAvailableImages); }}
              >
                + Add Image
              </button>
              {showImagePicker && availableImages.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: 4,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: 8, zIndex: 20, minWidth: 300, maxHeight: 300, overflowY: 'auto',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                }}>
                  {availableImages.map(img => (
                    <button
                      key={img}
                      onClick={() => {
                        setShowImagePicker(false);
                        onAnalyze(img, session.rectangle || undefined);
                      }}
                      style={{
                        display: 'block', width: '100%', padding: '8px 12px',
                        background: 'transparent', color: 'var(--text-primary)',
                        borderRadius: 6, textAlign: 'left', fontSize: 13,
                        cursor: 'pointer', border: 'none',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-tertiary)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {img}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="report-card">
            <div className="report-body">
              {/* Recommendations */}
              {result && (
                <div>
                  <div className="section-title">Adjustment Recommendations</div>
                  <div className="recommendations">
                    <div className="rec-item">
                      <div className="rec-label">White Balance</div>
                      {result.recommendations.white_balance}
                    </div>
                    <div className="rec-item">
                      <div className="rec-label">Tint</div>
                      {result.recommendations.tint}
                    </div>
                    <div className="rec-item">
                      <div className="rec-label">Saturation</div>
                      {result.recommendations.saturation}
                    </div>
                    <div className="rec-item">
                      <div className="rec-label">Exposure</div>
                      {result.recommendations.exposure}
                    </div>
                    <div className="rec-item" style={{ gridColumn: 'span 2' }}>
                      <div className="rec-label">Contrast</div>
                      {result.recommendations.contrast}
                    </div>
                  </div>
                </div>
              )}

              {/* Patch grid */}
              {result && (
                <div>
                  <div className="section-title">
                    Color Patches (left = reference, right = captured)
                  </div>
                  <PatchGrid patches={result.patches} rows={gridRows} cols={gridCols} />
                </div>
              )}

              {/* Iteration history */}
              {session.results.length > 1 && (
                <IterationHistory results={session.results} />
              )}

              {/* Image with rectangle */}
              {result && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div className="section-title" style={{ margin: 0 }}>Analyzed Image</div>
                    <button className="btn-redraw" onClick={() => setDrawMode(!drawMode)}>
                      {drawMode ? 'Cancel' : 'Redraw Rectangle'}
                    </button>
                  </div>
                  <ImageViewer
                    imagePath={result.image_path}
                    rectangle={session.rectangle}
                    onRectangleDrawn={handleRectangleDrawn}
                    drawMode={drawMode}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Delete */}
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <button className="btn-delete" onClick={onDelete}>
              Delete Camera Session
            </button>
          </div>
        </>
      )}
    </div>
  );
}
