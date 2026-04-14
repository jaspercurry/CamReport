import type { AnalysisResult } from '../types';
import { scoreColor } from '../utils';

interface Props {
  results: AnalysisResult[];
}

export default function IterationHistory({ results }: Props) {
  if (results.length === 0) return null;

  const maxDe = Math.max(...results.map(r => r.mean_delta_e), 15);

  return (
    <div>
      <div className="section-title">Iteration History</div>
      <div className="iteration-chart">
        {results.map((r, i) => {
          const height = (r.mean_delta_e / maxDe) * 100;
          const color = scoreColor(r.mean_delta_e);
          return (
            <div key={i} className="iteration-bar">
              <div className="bar-value" style={{ color }}>
                {r.mean_delta_e.toFixed(1)}
              </div>
              <div
                className="bar"
                style={{
                  height: `${Math.max(height, 8)}%`,
                  backgroundColor: color,
                }}
              />
              <div className="bar-label">#{i + 1}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
