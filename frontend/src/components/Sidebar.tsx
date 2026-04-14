import type { CameraSession } from '../types';
import { scoreColor } from '../utils';

interface Props {
  sessions: CameraSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
}

export default function Sidebar({ sessions, activeSessionId, onSelect }: Props) {
  const getBestScore = (session: CameraSession): number | null => {
    if (session.results.length === 0) return null;
    return Math.min(...session.results.map(r => r.mean_delta_e));
  };

  return (
    <div className="sidebar-sessions">
      {sessions.length === 0 && (
        <div style={{ padding: '20px 12px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' }}>
          No cameras yet
        </div>
      )}
      {sessions.map(session => {
        const score = getBestScore(session);
        return (
          <div
            key={session.id}
            className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
            onClick={() => onSelect(session.id)}
          >
            <div className="session-info">
              <div className="session-name">{session.name}</div>
              <div className="session-meta">
                {session.results.length} {session.results.length === 1 ? 'capture' : 'captures'}
                {' · '}SpyderCheckr {session.card_type}
              </div>
            </div>
            {score !== null && (
              <div className="session-score" style={{ color: scoreColor(score) }}>
                {score.toFixed(1)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
