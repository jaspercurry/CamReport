import { useState, useEffect, useRef } from 'react';
import type { CalibrationStepMsg } from '../types';
import { scoreColor } from '../utils';

interface Props {
  sessionId: string;
  deviceId: string;
  onComplete: () => void;
}

const PHASE_LABELS: Record<string, string> = {
  disable_auto: 'Disable Auto',
  white_balance_temperature: 'White Balance',
  brightness: 'Brightness',
  saturation: 'Saturation',
  contrast: 'Contrast',
  fine_tune_wb: 'Fine-tune WB',
  fine_tune_brightness: 'Fine-tune Brightness',
  final_capture: 'Final Capture',
};

const PHASE_ORDER = [
  'white_balance_temperature',
  'brightness',
  'saturation',
  'contrast',
  'fine_tune_wb',
  'fine_tune_brightness',
];

type Status = 'idle' | 'running' | 'complete' | 'error' | 'stopped';

export default function CalibrationProgress({ sessionId, deviceId, onComplete }: Props) {
  const [status, setStatus] = useState<Status>('idle');
  const [currentPhase, setCurrentPhase] = useState<string>('');
  const [steps, setSteps] = useState<CalibrationStepMsg[]>([]);
  const [deltaEHistory, setDeltaEHistory] = useState<number[]>([]);
  const [initialDeltaE, setInitialDeltaE] = useState<number | null>(null);
  const [finalDeltaE, setFinalDeltaE] = useState<number | null>(null);
  const [finalControls, setFinalControls] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Listen for WebSocket calibration messages
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onmessage = (event) => {
      try {
        const msg: CalibrationStepMsg = JSON.parse(event.data);

        switch (msg.type) {
          case 'calibration_started':
            setStatus('running');
            setInitialDeltaE(msg.initial_delta_e ?? null);
            if (msg.initial_delta_e) setDeltaEHistory([msg.initial_delta_e]);
            break;

          case 'phase_started':
            setCurrentPhase(msg.phase || '');
            break;

          case 'calibration_step':
            setSteps(prev => [...prev, msg]);
            if (msg.mean_delta_e) {
              setDeltaEHistory(prev => [...prev, msg.mean_delta_e!]);
            }
            break;

          case 'phase_complete':
            break;

          case 'control_unavailable':
            if (msg.control) setUnavailable(prev => [...prev, msg.control!]);
            break;

          case 'calibration_complete':
            setStatus('complete');
            setFinalDeltaE(msg.final_delta_e ?? null);
            setFinalControls(msg.controls ?? null);
            onComplete();
            break;

          case 'calibration_error':
            setStatus('error');
            setError(String(msg.error || 'Unknown error'));
            break;

          case 'calibration_stopped':
            setStatus('stopped');
            break;
        }
      } catch {}
    };

    return () => ws.close();
  }, [onComplete]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [steps]);

  const startCalibration = async () => {
    setStatus('running');
    setSteps([]);
    setDeltaEHistory([]);
    setFinalDeltaE(null);
    setFinalControls(null);
    setError(null);
    setUnavailable([]);

    const res = await fetch(`/api/sessions/${sessionId}/calibrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: deviceId }),
    });
    if (!res.ok) {
      setStatus('error');
      setError('Failed to start calibration');
    }
  };

  const stopCalibration = async () => {
    await fetch(`/api/sessions/${sessionId}/calibrate/stop`, { method: 'POST' });
    setStatus('stopped');
  };

  // Mini delta-E trend chart
  const renderTrend = () => {
    if (deltaEHistory.length < 2) return null;
    const max = Math.max(...deltaEHistory, 1);
    const w = 300;
    const h = 60;
    const points = deltaEHistory.map((v, i) => {
      const x = (i / (deltaEHistory.length - 1)) * w;
      const y = h - (v / max) * h;
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width={w} height={h + 20} style={{ display: 'block', marginBottom: 8 }}>
        <polyline
          points={points}
          fill="none"
          stroke="var(--blue)"
          strokeWidth="2"
        />
        {deltaEHistory.map((v, i) => {
          const x = (i / (deltaEHistory.length - 1)) * w;
          const y = h - (v / max) * h;
          return <circle key={i} cx={x} cy={y} r={2} fill="var(--blue)" />;
        })}
        <text x={0} y={h + 14} fontSize={10} fill="var(--text-secondary)">
          Delta-E: {deltaEHistory[0]?.toFixed(1)} → {deltaEHistory[deltaEHistory.length - 1]?.toFixed(1)}
        </text>
      </svg>
    );
  };

  return (
    <div style={{
      background: 'var(--bg-tertiary)',
      borderRadius: 8,
      padding: 16,
      marginBottom: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div className="section-title" style={{ margin: 0 }}>Auto-Calibration</div>
        {status === 'idle' && (
          <button className="btn-create" onClick={startCalibration}>
            Start Calibration
          </button>
        )}
        {status === 'running' && (
          <button className="btn-delete" onClick={stopCalibration} style={{ fontSize: 12 }}>
            Stop
          </button>
        )}
        {(status === 'complete' || status === 'error' || status === 'stopped') && (
          <button className="btn-redraw" onClick={startCalibration}>
            Restart
          </button>
        )}
      </div>

      {/* Phase progress bar */}
      {status === 'running' && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {PHASE_ORDER.map(phase => {
            const isCurrent = currentPhase === phase || currentPhase === `fine_tune_${phase.split('_').pop()}`;
            const phaseSteps = steps.filter(s => s.phase === phase);
            const isDone = phaseSteps.length > 0 && currentPhase !== phase;
            const isSkipped = unavailable.includes(phase.replace('fine_tune_', ''));

            return (
              <div
                key={phase}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  background: isSkipped
                    ? 'var(--text-muted)'
                    : isDone
                    ? 'var(--green)'
                    : isCurrent
                    ? 'var(--blue)'
                    : 'var(--border)',
                  transition: 'background 0.3s',
                }}
                title={PHASE_LABELS[phase] || phase}
              />
            );
          })}
        </div>
      )}

      {/* Current phase label */}
      {status === 'running' && currentPhase && (
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
          Phase: <strong style={{ color: 'var(--text-primary)' }}>
            {PHASE_LABELS[currentPhase] || currentPhase}
          </strong>
          {steps.length > 0 && ` (step ${steps.filter(s => s.phase === currentPhase).length})`}
        </div>
      )}

      {/* Delta-E trend */}
      {renderTrend()}

      {/* Step log */}
      {steps.length > 0 && (
        <div
          ref={logRef}
          style={{
            maxHeight: 150,
            overflowY: 'auto',
            fontSize: 11,
            fontFamily: 'monospace',
            color: 'var(--text-secondary)',
            background: 'var(--bg-secondary)',
            borderRadius: 6,
            padding: 8,
            marginBottom: 8,
          }}
        >
          {steps.map((s, i) => (
            <div key={i}>
              [{PHASE_LABELS[s.phase || ''] || s.phase}] step {s.step}: value={s.value} range=[{s.range?.join(',')}] error={s.error?.toFixed(3)} dE={s.mean_delta_e?.toFixed(2)}
            </div>
          ))}
        </div>
      )}

      {/* Unavailable controls */}
      {unavailable.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--orange)', marginBottom: 8 }}>
          Skipped (unavailable): {unavailable.join(', ')}
        </div>
      )}

      {/* Results */}
      {status === 'complete' && (
        <div style={{ fontSize: 14 }}>
          <div style={{ display: 'flex', gap: 24, marginBottom: 8 }}>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>Before: </span>
              <span style={{ color: scoreColor(initialDeltaE || 0), fontWeight: 600 }}>
                {initialDeltaE?.toFixed(2)}
              </span>
            </div>
            <div>
              <span style={{ color: 'var(--text-secondary)' }}>After: </span>
              <span style={{ color: scoreColor(finalDeltaE || 0), fontWeight: 600 }}>
                {finalDeltaE?.toFixed(2)}
              </span>
            </div>
          </div>
          {finalControls && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              Final settings: {Object.entries(finalControls).map(([k, v]) => `${k}=${v}`).join(', ')}
            </div>
          )}
        </div>
      )}

      {status === 'error' && (
        <div style={{ fontSize: 13, color: 'var(--red)' }}>Error: {error}</div>
      )}

      {status === 'stopped' && (
        <div style={{ fontSize: 13, color: 'var(--yellow)' }}>Calibration stopped by user</div>
      )}
    </div>
  );
}
