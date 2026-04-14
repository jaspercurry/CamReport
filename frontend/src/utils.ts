export function scoreColor(deltaE: number): string {
  if (deltaE < 3) return '#22c55e';   // green
  if (deltaE < 6) return '#eab308';   // yellow
  if (deltaE < 10) return '#f97316';  // orange
  return '#ef4444';                    // red
}

export function scoreLabel(deltaE: number): string {
  if (deltaE < 3) return 'Excellent';
  if (deltaE < 6) return 'Good';
  if (deltaE < 10) return 'Needs work';
  return 'Poor';
}

export function rgbToCSS(rgb: number[]): string {
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}
