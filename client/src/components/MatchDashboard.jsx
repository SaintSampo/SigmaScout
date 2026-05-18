import React, { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Clock, Zap, TrendingUp, AlertTriangle, Loader, ChevronDown, ChevronUp } from 'lucide-react';
import PredictionBar from './PredictionBar.jsx';

const COMP_LEVELS = { qm: 'Quals', ef: 'Elims', qf: 'QF', sf: 'SF', f: 'Finals' };

export default function MatchDashboard({ eventKey, eventLabel }) {
  const [matches,  setMatches]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [filter,   setFilter]   = useState('all'); // 'all'|'played'|'upcoming'
  const [expanded, setExpanded] = useState(null);  // expanded match key

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/event/${eventKey}/matches`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setMatches)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [eventKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('ss:refresh', load);
    return () => window.removeEventListener('ss:refresh', load);
  }, [load]);

  const filtered = matches.filter((m) =>
    filter === 'all'      ? true
    : filter === 'played'   ? !!m.result
    : /* upcoming */         !m.result,
  );

  // Sort: played matches newest first in played tab, upcoming oldest first otherwise
  const sorted = [...filtered].sort((a, b) => {
    if (filter === 'played') return (b.time || 0) - (a.time || 0);
    return (a.time || 0) - (b.time || 0);
  });

  const playedCount   = matches.filter((m) => m.result).length;
  const upcomingCount = matches.filter((m) => !m.result).length;

  // Model accuracy: % of played matches where prediction picked the right winner
  const accuracy = (() => {
    const played = matches.filter((m) => m.result);
    if (!played.length) return null;
    const correct = played.filter((m) => {
      const predictedWinner = m.prediction.redWinProb > 0.5 ? 'red' : 'blue';
      return predictedWinner === m.result.winner;
    }).length;
    return Math.round((correct / played.length) * 100);
  })();

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader size={28} className="animate-spin text-blue-500" />
    </div>
  );
  if (error) return <ErrorBox msg={error} />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-100">{eventLabel}</h1>
          <p className="text-xs text-slate-500">
            {playedCount} played · {upcomingCount} upcoming
            {accuracy !== null && (
              <> · <span className="text-blue-400 font-semibold">{accuracy}% model accuracy</span></>
            )}
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 text-sm">
          {[['all','All'],['played','Played'],['upcoming','Upcoming']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded transition-colors ${
                filter === id
                  ? 'bg-blue-600 text-white'
                  : 'bg-surface border border-border text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Match list */}
      <div className="space-y-2">
        {sorted.length === 0 && (
          <p className="text-center py-12 text-slate-600">No matches in this view.</p>
        )}
        {sorted.map((match) => (
          <MatchCard
            key={match.key}
            match={match}
            isExpanded={expanded === match.key}
            onToggle={() => setExpanded(expanded === match.key ? null : match.key)}
            eventKey={eventKey}
          />
        ))}
      </div>
    </div>
  );
}

function MatchCard({ match, isExpanded, onToggle, eventKey }) {
  const [simulating, setSimulating] = useState(false);
  const [simResult,  setSimResult]  = useState(null);

  const { prediction: pred, result } = match;
  const label = `${COMP_LEVELS[match.comp_level] ?? match.comp_level} ${
    match.set_number > 1 ? `${match.set_number}-` : ''
  }${match.match_number}`;

  const isPlayed = !!result;

  // Check if our model called the winner correctly
  const predictedWinner = pred.redWinProb > 0.5 ? 'red' : 'blue';
  const correct = isPlayed && predictedWinner === result.winner;

  async function runSandboxSim() {
    setSimulating(true);
    setSimResult(null);
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ red: match.red_teams, blue: match.blue_teams, eventKey }),
      });
      setSimResult(await res.json());
    } finally {
      setSimulating(false);
    }
  }

  return (
    <div className={`rounded-lg border transition-colors ${
      isPlayed ? 'border-border bg-surface' : 'border-blue-900/60 bg-blue-950/10'
    }`}>
      {/* Summary row */}
      <div
        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-slate-800/50 rounded-lg"
        onClick={onToggle}
      >
        {/* Status icon */}
        {isPlayed
          ? <CheckCircle2 size={16} className={correct ? 'text-green-400' : 'text-yellow-500'} />
          : <Clock size={16} className="text-blue-500" />}

        {/* Match label */}
        <span className="font-semibold text-slate-300 text-sm w-20 shrink-0">{label}</span>

        {/* Teams */}
        <div className="flex gap-2 text-xs flex-1 min-w-0">
          <AllianceChips keys={match.red_teams} color="red" winner={result?.winner === 'red'} />
          <span className="text-slate-600 self-center">vs</span>
          <AllianceChips keys={match.blue_teams} color="blue" winner={result?.winner === 'blue'} />
        </div>

        {/* Score or probability */}
        <div className="shrink-0 text-right">
          {isPlayed ? (
            <span className="text-xs font-mono">
              <span className="text-red-400">{result.redScore}</span>
              <span className="text-slate-600"> – </span>
              <span className="text-blue-400">{result.blueScore}</span>
            </span>
          ) : (
            <span className="text-xs text-blue-400 font-semibold">{Math.round(pred.redWinProb * 100)}% R</span>
          )}
        </div>

        {isExpanded ? <ChevronUp size={14} className="text-slate-600" /> : <ChevronDown size={14} className="text-slate-600" />}
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="border-t border-border/50 px-4 pb-4 pt-3 space-y-4">
          {/* Prediction bar */}
          <div>
            <p className="text-xs text-slate-500 mb-2 uppercase tracking-wider">
              {isPlayed ? 'Pre-match prediction' : 'Win probability'}
            </p>
            <PredictionBar redProb={pred.redWinProb} blueProb={pred.blueWinProb} />
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <Stat label="Proj Red" value={pred.redProjectedScore} unit="pts" color="text-red-400" />
            <Stat label="Proj Blue" value={pred.blueProjectedScore} unit="pts" color="text-blue-400" />
            <Stat label="Margin σ" value={`±${pred.marginStdDev}`} unit="pts" color="text-slate-300" />
            <Stat label="Volatility" value={`${pred.volatilityRating}/10`} color={
              pred.volatilityRating >= 7 ? 'text-red-400'
              : pred.volatilityRating >= 4 ? 'text-yellow-400'
              : 'text-green-400'
            } />
          </div>

          {/* Actual result comparison */}
          {isPlayed && (
            <div className="rounded bg-slate-800 p-3 grid grid-cols-3 gap-2 text-xs text-center">
              <div>
                <p className="text-slate-500 mb-1">Predicted</p>
                <p className="font-semibold">
                  <span className="text-red-400">{pred.redProjectedScore}</span>
                  <span className="text-slate-600"> – </span>
                  <span className="text-blue-400">{pred.blueProjectedScore}</span>
                </p>
              </div>
              <div className="flex items-center justify-center">
                <span className={`badge ${correct ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
                  {correct ? '✓ Correct' : '✗ Wrong'}
                </span>
              </div>
              <div>
                <p className="text-slate-500 mb-1">Actual</p>
                <p className="font-semibold">
                  <span className="text-red-400">{result.redScore}</span>
                  <span className="text-slate-600"> – </span>
                  <span className="text-blue-400">{result.blueScore}</span>
                </p>
              </div>
            </div>
          )}

          {/* On-demand re-simulation */}
          {!isPlayed && (
            <div>
              <button
                onClick={runSandboxSim}
                disabled={simulating}
                className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-700 hover:bg-blue-600 text-white text-xs transition-colors disabled:opacity-50"
              >
                <Zap size={12} />
                {simulating ? 'Simulating…' : 'Re-simulate (1000 runs)'}
              </button>
              {simResult && (
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <Stat label="Red Win%" value={`${Math.round(simResult.redWinProb * 100)}%`} color="text-red-400" />
                  <Stat label="Blue Win%" value={`${Math.round(simResult.blueWinProb * 100)}%`} color="text-blue-400" />
                  <Stat label="Proj Red"  value={simResult.redProjectedScore}  unit="pts" color="text-red-300" />
                  <Stat label="Proj Blue" value={simResult.blueProjectedScore} unit="pts" color="text-blue-300" />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AllianceChips({ keys, color, winner }) {
  const base = color === 'red'
    ? 'bg-red-950 text-red-300 border border-red-800'
    : 'bg-blue-950 text-blue-300 border border-blue-800';
  const winCls = winner ? 'ring-1 ' + (color === 'red' ? 'ring-red-400' : 'ring-blue-400') : '';

  return (
    <div className={`flex gap-1 ${winner ? 'font-bold' : ''}`}>
      {keys.map((k) => (
        <span key={k} className={`${base} ${winCls} text-xs px-1.5 py-0.5 rounded font-mono`}>
          {k.replace('frc', '')}
        </span>
      ))}
    </div>
  );
}

function Stat({ label, value, unit, color = 'text-slate-200' }) {
  return (
    <div className="bg-slate-800 rounded p-2 text-center">
      <p className="text-slate-500 mb-0.5">{label}</p>
      <p className={`font-semibold ${color}`}>{value}{unit && <span className="text-slate-500 font-normal"> {unit}</span>}</p>
    </div>
  );
}

function ErrorBox({ msg }) {
  return (
    <div className="rounded border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
      {msg}
    </div>
  );
}
