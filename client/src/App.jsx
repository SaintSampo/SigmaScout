import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, BarChart2, Layers, Zap, RefreshCw, AlertCircle } from 'lucide-react';
import EventExplorer  from './components/EventExplorer.jsx';
import TeamLeaderboard from './components/TeamLeaderboard.jsx';
import MatchDashboard  from './components/MatchDashboard.jsx';
import Sandbox         from './components/Sandbox.jsx';

const TABS = [
  { id: 'explorer',    label: 'Event Explorer',     Icon: Layers  },
  { id: 'leaderboard', label: 'Team Rankings',      Icon: BarChart2 },
  { id: 'matches',     label: 'Match Predictions',  Icon: Activity },
  { id: 'sandbox',     label: 'Sandbox Simulator',  Icon: Zap      },
];

export default function App() {
  const [tab,        setTab]        = useState('explorer');
  const [eventKey,   setEventKey]   = useState(null);
  const [eventLabel, setEventLabel] = useState('');
  const [liveStatus, setLiveStatus] = useState('disconnected'); // 'connected'|'disconnected'
  const sseRef = useRef(null);

  // ── SSE live connection ─────────────────────────────────────────────────
  const connectSSE = useCallback((key) => {
    if (sseRef.current) sseRef.current.close();
    if (!key) return;
    const es = new EventSource(`/api/stream/${key}`);
    es.onopen    = ()  => setLiveStatus('connected');
    es.onerror   = ()  => setLiveStatus('disconnected');
    es.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'refresh') window.dispatchEvent(new CustomEvent('ss:refresh'));
      } catch { /* ignore ping/text frames */ }
    };
    sseRef.current = es;
    setLiveStatus('connected');
  }, []);

  useEffect(() => {
    if (eventKey) connectSSE(eventKey);
    return () => sseRef.current?.close();
  }, [eventKey, connectSSE]);

  // ── select event and jump to leaderboard ───────────────────────────────
  function handleSelectEvent(key, label) {
    setEventKey(key);
    setEventLabel(label);
    setTab('leaderboard');
  }

  async function handleRefresh() {
    if (!eventKey) return;
    await fetch(`/api/event/${eventKey}/refresh`, { method: 'POST' });
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-slate-100">
      {/* ── Navbar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-slate-700 bg-slate-900/80 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-blue-400 font-bold text-lg tracking-tight">Σ Scout</span>
            <span className="hidden sm:block text-slate-500 text-xs">FRC Analytics</span>
          </div>

          {/* Tabs */}
          <nav className="flex gap-1 overflow-x-auto flex-1 justify-center">
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm whitespace-nowrap transition-colors
                  ${tab === id
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}
              >
                <Icon size={13} />
                <span className="hidden md:inline">{label}</span>
              </button>
            ))}
          </nav>

          {/* Right controls */}
          <div className="flex items-center gap-2 shrink-0">
            {eventKey && (
              <>
                <span className="hidden lg:block text-xs text-slate-500 truncate max-w-36">
                  {eventLabel}
                </span>
                <div className={`w-2 h-2 rounded-full ${liveStatus === 'connected' ? 'bg-green-400' : 'bg-slate-600'}`}
                  title={liveStatus === 'connected' ? 'Live' : 'Disconnected'} />
                <button
                  onClick={handleRefresh}
                  title="Force refresh from TBA"
                  className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <RefreshCw size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* ── Main content ───────────────────────────────────────────────── */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        {tab === 'explorer'    && <EventExplorer onSelectEvent={handleSelectEvent} />}
        {tab === 'leaderboard' && (
          eventKey
            ? <TeamLeaderboard eventKey={eventKey} eventLabel={eventLabel} />
            : <NeedEvent onGo={() => setTab('explorer')} />
        )}
        {tab === 'matches' && (
          eventKey
            ? <MatchDashboard eventKey={eventKey} eventLabel={eventLabel} />
            : <NeedEvent onGo={() => setTab('explorer')} />
        )}
        {tab === 'sandbox' && <Sandbox eventKey={eventKey} />}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-800 py-3 text-center text-xs text-slate-600">
        Data provided by{' '}
        <a
          href="https://www.thebluealliance.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline"
        >
          The Blue Alliance
        </a>
        {' '}· SigmaScout is not affiliated with or endorsed by FIRST or The Blue Alliance
      </footer>
    </div>
  );
}

function NeedEvent({ onGo }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4 text-slate-500">
      <AlertCircle size={40} className="text-slate-700" />
      <p>No event selected.</p>
      <button
        onClick={onGo}
        className="px-4 py-2 rounded bg-blue-600 text-white text-sm hover:bg-blue-500 transition-colors"
      >
        Choose an Event
      </button>
    </div>
  );
}
