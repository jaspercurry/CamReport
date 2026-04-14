import { scoreColor, scoreLabel } from '../utils';

interface Props {
  deltaE: number;
  size?: 'normal' | 'large';
}

export default function ScoreBadge({ deltaE, size = 'normal' }: Props) {
  const color = scoreColor(deltaE);
  const label = scoreLabel(deltaE);

  return (
    <div
      className="score-badge"
      style={{
        backgroundColor: `${color}15`,
        border: `1px solid ${color}40`,
      }}
    >
      <div
        className="score-value"
        style={{
          color,
          fontSize: size === 'large' ? '36px' : '28px',
        }}
      >
        {deltaE.toFixed(1)}
      </div>
      <div className="score-label" style={{ color }}>
        {label}
      </div>
    </div>
  );
}
