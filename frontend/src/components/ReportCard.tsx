import { useState, useEffect } from 'react';
import type { CameraSession, Corners } from '../types';
import ScoreBadge from './ScoreBadge';
import PatchGrid from './PatchGrid';
import IterationHistory from './IterationHistory';
import ImageViewer from './ImageViewer';

interface Props {
  session: CameraSession;
  onAnalyze: (imagePath: string, corners?: Corners) => void;
  onUpdateCorners: (corners: Corners) => void;
  onDelete: () => void;
}

export default function ReportCard({ session, onAnalyze, onUpdateCorners, onDelete }: Props) {
  const [viewIndex, setViewIndex] = useState<number | null>(null);
  const [pickMode, setPickMode] = useState(false);
  const [availableImages, setAvailableImages] = useState<string[]>([]);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugKey, setDebugKey] = useState(0);

  useEffect(() => {
    fetch('/api/images').then(r => r.json()).then(setAvailableImages);
  }, [session.results.length]);

  const currentIndex = viewIndex ?? (session.results.length - 1);
  const result = session.results[currentIndex] ?? null;
  const hasResults = session.results.length > 0;

  // Detect portrait from corners geometry
  const getGridDims = () => {
    if (!session.corners || session.corners.length < 4) {
      return session.card_type === 48 ? { rows: 8, cols: 6 } : { rows: 6, cols: 4 };
    }
    const [tl, tr, , bl] = session.corners;
    const w = Math.sqrt((tr[0] - tl[0]) ** 2 + (tr[1] - tl[1]) ** 2);
    const h = Math.sqrt((bl[0] - tl[0]) ** 2 + (bl[1] - tl[1]) ** 2);
    const isPortrait = h > w;
    if (session.card_type === 48) {
      return isPortrait ? { rows: 6, cols: 8 } : { rows: 8, cols: 6 };
    }
    return isPortrait ? { rows: 6, cols: 4 } : { rows: 4, cols: 6 };
  };
  const { rows: gridRows, cols: gridCols } = getGridDims();

  const handleCornersSet = (corners: Corners) => {
    setPickMode(false);
    onUpdateCorners(corners);
    setDebugKey(k => k + 1);

    // If we have a current image, re-analyze with the new corners
    if (result) {
      onAnalyze(result.image_path, corners);
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
                      onClick={() => { setSelectedImage(img); setPickMode(true); }}
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
              Click the 4 corners of the patch area (inside the black border), starting from the top-left.
            </div>
            <ImageViewer
              imagePath={selectedImage}
              corners={null}
              onCornersSet={(corners) => {
                setPickMode(false);
                onUpdateCorners(corners);
                onAnalyze(selectedImage, corners);
                setSelectedImage(null);
              }}
              pickMode={true}
            />
            <button
              className="btn-redraw"
              onClick={() => { setSelectedImage(null); setPickMode(false); }}
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
                        onAnalyze(img, session.corners || undefined);
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

              {/* Debug: warped card with sampling regions */}
              {result && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div className="section-title" style={{ margin: 0 }}>Sampling Debug View</div>
                    <button className="btn-redraw" onClick={() => { setShowDebug(!showDebug); setDebugKey(k => k + 1); }}>
                      {showDebug ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  {showDebug && (
                    <div style={{ borderRadius: 8, overflow: 'hidden', background: 'var(--bg-tertiary)' }}>
                      <img
                        key={debugKey}
                        src={`/api/sessions/${session.id}/debug-image?t=${debugKey}`}
                        alt="Debug: warped card with sampling regions"
                        style={{ width: '100%', display: 'block' }}
                      />
                      <div style={{ padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)' }}>
                        White lines = grid cell boundaries. Green rectangles = center 40% sampling area for each patch.
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Iteration history */}
              {session.results.length > 1 && (
                <IterationHistory results={session.results} />
              )}

              {/* Image with corners */}
              {result && (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <div className="section-title" style={{ margin: 0 }}>Analyzed Image</div>
                    <button className="btn-redraw" onClick={() => setPickMode(!pickMode)}>
                      {pickMode ? 'Cancel' : 'Pick New Corners'}
                    </button>
                  </div>
                  <ImageViewer
                    imagePath={result.image_path}
                    corners={session.corners}
                    onCornersSet={handleCornersSet}
                    pickMode={pickMode}
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
