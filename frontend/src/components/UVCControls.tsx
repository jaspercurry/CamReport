import { useState, useEffect } from 'react';
import type { UVCControl } from '../types';

interface Props {
  deviceId: string;
}

const FRIENDLY_NAMES: Record<string, string> = {
  white_balance_temperature: 'White Balance (K)',
  brightness: 'Brightness',
  contrast: 'Contrast',
  saturation: 'Saturation',
  sharpness: 'Sharpness',
  gain: 'Gain',
  exposure_time: 'Exposure Time',
  auto_exposure: 'Auto Exposure',
  auto_white_balance: 'Auto White Balance',
  gamma: 'Gamma',
  hue: 'Hue',
};

export default function UVCControls({ deviceId }: Props) {
  const [controls, setControls] = useState<UVCControl[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/cameras/${deviceId}/controls`)
      .then(r => r.json())
      .then(setControls)
      .catch(() => setControls([]))
      .finally(() => setLoading(false));
  }, [deviceId]);

  const handleChange = async (name: string, value: number) => {
    // Optimistic update
    setControls(prev => prev.map(c => c.name === name ? { ...c, current: value } : c));

    await fetch(`/api/cameras/${deviceId}/controls/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
  };

  const handleReset = async (name: string, defaultVal: number) => {
    await handleChange(name, defaultVal);
  };

  const handleResetAll = async () => {
    await fetch(`/api/cameras/${deviceId}/controls/reset`, { method: 'POST' });
    // Refresh controls
    const res = await fetch(`/api/cameras/${deviceId}/controls`);
    setControls(await res.json());
  };

  if (loading) return <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading controls...</div>;
  if (controls.length === 0) return <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>No UVC controls available</div>;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div className="section-title" style={{ margin: 0, fontSize: 14 }}>Camera Controls</div>
        <button className="btn-redraw" onClick={() => setCollapsed(!collapsed)} style={{ fontSize: 12 }}>
          {collapsed ? 'Show' : 'Hide'}
        </button>
        {!collapsed && (
          <button className="btn-redraw" onClick={handleResetAll} style={{ fontSize: 12 }}>
            Reset All
          </button>
        )}
      </div>

      {!collapsed && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '8px 16px',
          background: 'var(--bg-tertiary)',
          padding: 12,
          borderRadius: 8,
        }}>
          {controls.map(c => (
            <div key={c.name} style={{ opacity: c.available ? 1 : 0.4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {FRIENDLY_NAMES[c.name] || c.name}
                </span>
                <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  {c.current}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="range"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={c.current}
                  disabled={!c.available}
                  onChange={e => handleChange(c.name, parseInt(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--blue)' }}
                />
                <button
                  onClick={() => handleReset(c.name, c.default)}
                  disabled={!c.available}
                  title="Reset to default"
                  style={{
                    background: 'none', border: 'none', color: 'var(--text-secondary)',
                    cursor: 'pointer', fontSize: 11, padding: '2px 4px',
                  }}
                >
                  Reset
                </button>
              </div>
              {!c.available && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>Unavailable</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
