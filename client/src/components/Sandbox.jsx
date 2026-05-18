import React, { useState } from 'react';
import { Zap, RefreshCw, AlertCircle, CheckCircle2, Loader } from 'lucide-react';
import PredictionBar from './PredictionBar.jsx';

const EMPTY_SLOT = '';
const DEFAULT_RED  = ['frc254', 'frc1114', 'frc2056'];
const DEFAULT_BLUE = ['frc1678', 'frc118',  'frc973'];

export default function Sandbox({ eventKey }) {
  const [red,     setRed]     = useState(DEFAULT_RED);
  const [blue,    setBlue]    = useState(DEFAULT_BLUE);
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [teamInfo, setTeamInfo] = useState({}); // key → { name, city }

  function updateSlot(alliance, idx, val) {
    const arr = alliance === 'red' ? [...red] : [...blue];
    arr[idx] = val.trim().toLowerCase().startsWith('frc') ? val.trim().toLowerCase() : `frc${val.trim()}`;
    alliance === 'red' ? setRed(arr) : setBlue(arr);
    setResult(null);
  }

  async function lookupTeams() {
    const keys = [...red, ...blue].filter(Boolean);
    if (!keys.length) return;
    try {
      const res  = await fetch(`/api/teams/stats?keys=${keys.join(',')}`);
      const data = await res.json();
      const map  = {};
      for (const item of data) {
        if (item.found) {
          map[item.key] = {
            name: item.info?.nickname || '',
            city: item.info?.city || '',
          };
        }
      }
      setTeamInfo(map);
    } catch { /* non-fatal */ }
  }

  async function simulate() {
    setLoading(true);
    setError(null);
    setResult(null);

    const validRed  = red.filter(Boolean);
    const validBlue = blue.filter(Boolean);

    if (validRed.length === 0 || validBlue.length === 0) {
      setError('Enter at least one team per alliance.');
      setLoading(false);
      return;
    }

    try {
      await lookupTeams();
      const res = await fetch('/api/simulate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ red: validRed, blue: validBlue, eventKey }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
    } catch (e) {
      setError(e.message || 'Simulation failed');
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setRed(DEFAULT_RED);
    setBlue(DEFAULT_BLUE);
    setResult(null);
    setError(null);
    setTeamInfo({});
  }

  const volatilityLabel = (v) =>
    v >= 7 ? { text: 'High', color: 'text-red-400' }
    : v >= 4 ? { text: 'Medium', color: 'text-yellow-400' }
    : { text: 'Low', color: 'text-green-400' };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-bold text-slate-100 flex items-center gap-2">
          <Zap size={18} className="text-blue-400" />
          Sandbox Simulator
        </h1>
        <p className="text-xs text-slate-500 mt-1">
          Type any 6 FRC team numbers, look them up, and run 1,000-trial Monte Carlo simulation.
          {eventKey && <span className="text-blue-400"> Uses ratings from selected event.</span>}
        </p>
      </div>

      {/* Alliance inputs */}
      <div className="grid sm:grid-cols-2 gap-4">
        <AllianceInput
          color="red"
          teams={red}
          teamInfo={teamInfo}
          onChange={(i, v) => updateSlot('red', i, v)}
        />
        <AllianceInput
          color="blue"
          teams={blue}
          teamInfo={teamInfo}
          onChange={(i, v) => updateSlot('blue', i, v)}
        />
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          onClick={simulate}
          disabled={loading}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors disabled:opacity-60"
        >
          {loading ? <Loader size={15} className="animate-spin" /> : <Zap size={15} />}
          {loading ? 'Simulating 1000 runs…' : 'Simulate Match'}
        </button>
        <button
          onClick={reset}
          className="px-4 py-2.5 rounded-lg border border-border bg-surface hover:bg-surfaceL text-slate-400 hover:text-slate-200 text-sm transition-colors"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="rounded-xl border border-border bg-surface p-5 space-y-5">
          <h2 className="font-bold text-slate-100 text-base flex items-center gap-2">
            <CheckCircle2 size={16} className="text-green-400" />
            Simulation Results
          </h2>

          <PredictionBar redProb={result.redWinProb} blueProb={result.blueWinProb} />

          {/* Score projections */}
          <div className="grid grid-cols-2 gap-4">
            <ScoreCard
              label="Red Alliance"
              teams={red.filter(Boolean)}
              score={result.redProjectedScore}
              prob={result.redWinProb}
              color="red"
              teamInfo={teamInfo}
            />
            <ScoreCard
              label="Blue Alliance"
              teams={blue.filter(Boolean)}
              score={result.blueProjectedScore}
              prob={result.blueWinProb}
              color="blue"
              teamInfo={teamInfo}
            />
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-3 gap-3 text-xs text-center">
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-slate-500 mb-1">Margin σ</p>
              <p className="text-xl font-bold text-slate-200">±{result.marginStdDev}</p>
              <p className="text-slate-600">pts</p>
            </div>
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-slate-500 mb-1">Tie Prob</p>
              <p className="text-xl font-bold text-slate-200">{(result.tieProb * 100).toFixed(1)}%</p>
            </div>
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-slate-500 mb-1">Volatility</p>
              <p className={`text-xl font-bold ${volatilityLabel(result.volatilityRating).color}`}>
                {result.volatilityRating}/10
              </p>
              <p className={`text-xs ${volatilityLabel(result.volatilityRating).color}`}>
                {volatilityLabel(result.volatilityRating).text}
              </p>
            </div>
          </div>

          <p className="text-xs text-slate-600 text-center">
            Based on 1,000 Monte Carlo trials drawing from each robot's (EPA, σ) distribution
          </p>
        </div>
      )}
    </div>
  );
}

function AllianceInput({ color, teams, teamInfo, onChange }) {
  const isRed = color === 'red';
  const borderCls = isRed
    ? 'border-red-900 focus-within:border-red-600'
    : 'border-blue-900 focus-within:border-blue-600';
  const labelCls  = isRed ? 'text-red-400' : 'text-blue-400';

  return (
    <div className={`rounded-lg border ${borderCls} bg-surface p-4 space-y-3 transition-colors`}>
      <h3 className={`text-sm font-bold uppercase tracking-wider ${labelCls}`}>
        {isRed ? '🔴 Red Alliance' : '🔵 Blue Alliance'}
      </h3>
      {teams.map((val, i) => {
        const info = teamInfo[val];
        return (
          <div key={i} className="space-y-0.5">
            <input
              value={val}
              onChange={(e) => onChange(i, e.target.value)}
              placeholder={`Team ${i + 1} (e.g. 254)`}
              className="w-full bg-slate-900 border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-700 font-mono"
            />
            {info && (
              <p className="text-xs text-slate-500 pl-1 truncate">
                {info.name}{info.city ? ` · ${info.city}` : ''}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScoreCard({ label, teams, score, prob, color, teamInfo }) {
  const isRed = color === 'red';
  const probPct = Math.round(prob * 100);
  const scoreCls = isRed ? 'text-red-400' : 'text-blue-400';

  return (
    <div className={`rounded-lg p-4 ${isRed ? 'gradient-red' : 'gradient-blue'}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-white/70 mb-2">{label}</p>
      <p className={`text-3xl font-bold ${scoreCls} text-white`}>{score}</p>
      <p className="text-xs text-white/60">projected pts</p>
      <p className="text-lg font-bold text-white mt-2">{probPct}%</p>
      <p className="text-xs text-white/60">win probability</p>
      <div className="mt-3 flex flex-wrap gap-1">
        {teams.map((k) => (
          <span key={k} className="text-xs bg-black/30 rounded px-1.5 py-0.5 text-white/80 font-mono">
            {k.replace('frc', '')}
            {teamInfo[k]?.name ? ` ${teamInfo[k].name}` : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
