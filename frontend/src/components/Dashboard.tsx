import type { CameraSession } from '../types';
import ScoreBadge from './ScoreBadge';
import PatchGrid from './PatchGrid';
import IterationHistory from './IterationHistory';

interface Props {
  sessions: CameraSession[];
}

export default function Dashboard({ sessions }: Props) {
  const sessionsWithResults = sessions.filter(s => s.results.length > 0);

  return (
    <div>
      <div className="dashboard-header">
        <h2>Camera Comparison Dashboard</h2>
        <p>
          {sessionsWithResults.length} camera{sessionsWithResults.length !== 1 ? 's' : ''} with results
          {sessions.length > sessionsWithResults.length &&
            ` · ${sessions.length - sessionsWithResults.length} pending`}
        </p>
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

      {sessionsWithResults.length === 0 ? (
        <div className="empty-state" style={{ minHeight: 300 }}>
          <h2>No results yet</h2>
          <p>Analyze some camera screenshots to see the comparison dashboard.</p>
        </div>
      ) : (
        <div className="dashboard">
          {sessionsWithResults.map(session => {
            const bestResult = session.results.reduce((best, r) =>
              r.mean_delta_e < best.mean_delta_e ? r : best
            );
            let isPortrait = false;
            if (session.corners && session.corners.length >= 4) {
              const [tl, tr, , bl] = session.corners;
              const w = Math.sqrt((tr[0] - tl[0]) ** 2 + (tr[1] - tl[1]) ** 2);
              const h = Math.sqrt((bl[0] - tl[0]) ** 2 + (bl[1] - tl[1]) ** 2);
              isPortrait = h > w;
            }
            const gridRows = session.card_type === 48 ? (isPortrait ? 6 : 8) : (isPortrait ? 6 : 4);
            const gridCols = session.card_type === 48 ? (isPortrait ? 8 : 6) : (isPortrait ? 4 : 6);

            return (
              <div key={session.id} className="report-card">
                <div className="report-header">
                  <div style={{ flex: 1 }}>
                    <div className="camera-name">{session.name}</div>
                    <div className="iteration-label">
                      Best of {session.results.length} capture{session.results.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <ScoreBadge deltaE={bestResult.mean_delta_e} />
                </div>
                <div className="report-body">
                  {/* Key metrics */}
                  <div className="recommendations" style={{ gridTemplateColumns: '1fr' }}>
                    <div className="rec-item">
                      <div className="rec-label">White Balance</div>
                      {bestResult.recommendations.white_balance}
                    </div>
                    <div className="rec-item">
                      <div className="rec-label">Saturation</div>
                      {bestResult.recommendations.saturation}
                    </div>
                    <div className="rec-item">
                      <div className="rec-label">Exposure</div>
                      {bestResult.recommendations.exposure}
                    </div>
                  </div>

                  {/* Compact patch grid */}
                  <PatchGrid patches={bestResult.patches} rows={gridRows} cols={gridCols} compact />

                  {/* Iteration history */}
                  {session.results.length > 1 && (
                    <IterationHistory results={session.results} />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
