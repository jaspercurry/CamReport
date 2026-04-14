import { useState, useEffect, useCallback } from 'react';
import './App.css';
import { useWebSocket } from './hooks/useWebSocket';
import type { CameraSession, Corners } from './types';
import Sidebar from './components/Sidebar';
import ReportCard from './components/ReportCard';
import Dashboard from './components/Dashboard';
import NewImagePrompt from './components/NewImagePrompt';

type View = 'camera' | 'dashboard';

function App() {
  const [sessions, setSessions] = useState<CameraSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [view, setView] = useState<View>('camera');
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCardType, setNewCardType] = useState(24);

  const activeSession = sessions.find(s => s.id === activeSessionId) || null;

  const fetchSessions = useCallback(async () => {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    setSessions(data);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  useWebSocket((msg) => {
    if (msg.type === 'new_image' && msg.path) {
      setPendingImage(msg.path);
    }
  });

  const createSession = async () => {
    if (!newName.trim()) return;
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), card_type: newCardType }),
    });
    const session = await res.json();
    setSessions(prev => [...prev, session]);
    setActiveSessionId(session.id);
    setShowNewModal(false);
    setNewName('');
    setView('camera');
  };

  const deleteSession = async (id: string) => {
    await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      setActiveSessionId(null);
    }
  };

  const handleAnalyze = async (imagePath: string, corners?: Corners) => {
    if (!activeSession) return;
    const res = await fetch(`/api/sessions/${activeSession.id}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_path: imagePath, corners }),
    });
    if (res.ok) {
      await fetchSessions();
    }
  };

  const handleUpdateCorners = async (corners: Corners) => {
    if (!activeSession) return;
    await fetch(`/api/sessions/${activeSession.id}/corners`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ corners }),
    });
    await fetchSessions();
  };

  const handleAssignImage = () => {
    if (pendingImage && activeSession) {
      handleAnalyze(pendingImage, activeSession.corners || undefined);
    }
    setPendingImage(null);
  };

  return (
    <div className="app">
      <div className="app-sidebar">
        <div className="sidebar-header">
          <h1>CamReport</h1>
          <p>Webcam Color Calibration</p>
        </div>

        <div className="sidebar-nav">
          <button
            className={view === 'camera' ? 'active' : ''}
            onClick={() => setView('camera')}
          >
            Cameras
          </button>
          <button
            className={view === 'dashboard' ? 'active' : ''}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
        </div>

        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={(id) => { setActiveSessionId(id); setView('camera'); }}
        />

        <div className="sidebar-footer">
          <button className="btn-new-camera" onClick={() => setShowNewModal(true)}>
            + New Camera
          </button>
        </div>
      </div>

      <div className="app-main">
        {view === 'dashboard' ? (
          <Dashboard sessions={sessions} />
        ) : activeSession ? (
          <ReportCard
            session={activeSession}
            onAnalyze={handleAnalyze}
            onUpdateCorners={handleUpdateCorners}
            onDelete={() => deleteSession(activeSession.id)}
          />
        ) : (
          <div className="empty-state">
            <h2>No camera selected</h2>
            <p>
              Create a new camera session to get started. Place your SpyderCheckr card
              in frame, take a screenshot, and save it to the watched folder.
            </p>
          </div>
        )}
      </div>

      {pendingImage && activeSession && (
        <NewImagePrompt
          imageName={pendingImage}
          cameraName={activeSession.name}
          onAssign={handleAssignImage}
          onDismiss={() => setPendingImage(null)}
        />
      )}

      {showNewModal && (
        <div className="modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>New Camera Session</h2>
            <div className="form-group">
              <label>Camera Name</label>
              <input
                type="text"
                placeholder="e.g. Logitech Brio 4K"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                autoFocus
                onKeyDown={e => e.key === 'Enter' && createSession()}
              />
            </div>
            <div className="form-group">
              <label>SpyderCheckr Card</label>
              <select value={newCardType} onChange={e => setNewCardType(Number(e.target.value))}>
                <option value={24}>SpyderCheckr 24 (6x4 grid)</option>
                <option value={48}>SpyderCheckr 48 (8x6 grid)</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn-cancel" onClick={() => setShowNewModal(false)}>Cancel</button>
              <button className="btn-create" onClick={createSession}>Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
