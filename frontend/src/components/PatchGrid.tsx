import type { PatchResult } from '../types';
import { rgbToCSS } from '../utils';

interface Props {
  patches: PatchResult[];
  rows: number;
  cols: number;
  compact?: boolean;
}

export default function PatchGrid({ patches, rows, cols, compact = false }: Props) {
  // Build a 2D grid
  const grid: (PatchResult | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null)
  );

  for (const p of patches) {
    if (p.row < rows && p.col < cols) {
      grid[p.row][p.col] = p;
    }
  }

  return (
    <div
      className="patch-grid"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {grid.flat().map((patch, i) => {
        if (!patch) {
          return <div key={i} className="patch-cell" style={{ background: 'var(--bg-tertiary)' }} />;
        }

        const highError = patch.delta_e > 10;

        return (
          <div
            key={i}
            className={`patch-cell ${highError ? 'high-error' : ''}`}
          >
            <div className="patch-ref" style={{ backgroundColor: rgbToCSS(patch.ref_rgb) }} />
            <div className="patch-captured" style={{ backgroundColor: rgbToCSS(patch.captured_rgb) }} />
            {!compact && (
              <div className="patch-delta">
                {patch.delta_e.toFixed(1)}
              </div>
            )}
            <div className="patch-name-tooltip">{patch.name}</div>
          </div>
        );
      })}
    </div>
  );
}
