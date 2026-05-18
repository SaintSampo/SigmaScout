import React, { useState, useEffect, useCallback } from 'react';
import { ArrowUp, ArrowDown, Minus, TrendingUp, Shield, AlertTriangle, Zap, Skull, Loader } from 'lucide-react';

const SORT_KEYS = [
  { key: 'rank',          label: 'Rank'      },
  { key: 'epa',           label: 'Off EPA'   },
  { key: 'epaSigma',      label: 'Off σ'     },
  { key: 'defense',       label: 'Def'       },
  { key: 'defSigma',      label: 'Def σ'     },
  { key: 'composite',     label: 'Score'     },
  { key: 'matchCount',    label: 'Played'    },
  { key: 'avgTDead',      label: 'Dead%'     },
  { key: 'roleVolatility',label: 'Switch σ'  },
];

export default function TeamLeaderboard({ eventKey, eventLabel }) {
  const [teams,   setTeams]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [sortKey, setSortKey] = useState('rank');
  const [asc,     setAsc]     = useState(true);
  const [query,   setQuery]   = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/event/${eventKey}/teams`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setTeams)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [eventKey]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener('ss:refresh', load);
    return () => window.removeEventListener('ss:refresh', load);
  }, [load]);

  function handleSort(key) {
    if (sortKey === key) setAsc((a) => !a);
    else { setSortKey(key); setAsc(key === 'rank'); }
  }

  const filtered = teams.filter((t) => {
    const q = query.toLowerCase();
    return !q || t.teamKey?.toLowerCase().includes(q) || t.name?.toLowerCase().includes(q);
  });

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
    return asc ? av - bv : bv - av;
  });

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
          <p className="text-xs text-slate-500">{sorted.length} teams ranked</p>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search team…"
          className="bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-full sm:w-56 placeholder-slate-600"
        />
      </div>

      {/* Legend */}
      <div className="text-xs text-slate-600 flex flex-wrap gap-4">
        <span className="flex items-center gap-1"><TrendingUp size={11} className="text-blue-400" /> Off EPA = offensive pts contributed/match</span>
        <span className="flex items-center gap-1"><Shield size={11} className="text-green-400" /> Def = opp pts suppressed/match</span>
        <span className="flex items-center gap-1"><AlertTriangle size={11} className="text-yellow-400" /> σ = rating volatility (lower = more reliable)</span>
        <span className="flex items-center gap-1"><Skull size={11} className="text-red-400" /> Dead% = avg breakdown / suppression time</span>
        <span className="flex items-center gap-1"><Zap size={11} className="text-purple-400" /> Switch σ = role-switching frequency (Switcher if &gt;0.15)</span>
      </div>

      {/* Role-allocation guide */}
      <div className="flex items-center gap-3 text-xs text-slate-600">
        <span className="text-slate-500 font-semibold">Role bar:</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-blue-500" /> Offense</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-green-500" /> Defense</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-2 rounded-sm bg-red-800" /> Dead / Suppressed</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-800 border-b border-border text-xs text-slate-400 uppercase tracking-wider">
              {SORT_KEYS.map(({ key, label }) => (
                <th
                  key={key}
                  onClick={() => handleSort(key)}
                  className="px-3 py-2.5 text-right first:text-left cursor-pointer hover:text-slate-200 select-none whitespace-nowrap"
                >
                  <span className="inline-flex items-center gap-1 justify-end">
                    {label}
                    {sortKey === key
                      ? asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />
                      : <Minus size={11} className="text-slate-700" />}
                  </span>
                </th>
              ))}
              {/* Non-sortable columns */}
              <th className="px-3 py-2.5 text-left text-xs whitespace-nowrap">Role Profile</th>
              <th className="px-3 py-2.5 text-left text-xs whitespace-nowrap">Team</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((team, i) => (
              <TeamRow key={team.teamKey} team={team} even={i % 2 === 0} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Role allocation bar ─────────────────────────────────────────────────────
/**
 * Three-segment bar showing the team's average time allocation:
 *   Blue  = avgTOff  (offensive time)
 *   Green = avgTDef  (defensive time)
 *   Red   = avgTDead (dead / heavily-suppressed time)
 *
 * Total always equals the full bar width because tOff + tDef + tDead = 1.0.
 * If < 3 matches have been played the bar defaults to a neutral grey placeholder.
 */
function RoleBar({ team }) {
  if (!team.matchCount || team.matchCount < 1) {
    return <div className="w-20 h-2 rounded-full bg-slate-700 opacity-40" />;
  }

  const offPct  = Math.round((team.avgTOff  ?? 0) * 100);
  const defPct  = Math.round((team.avgTDef  ?? 0) * 100);
  const deadPct = Math.round((team.avgTDead ?? 0) * 100);

  return (
    <div
      className="w-20 h-2 rounded-full overflow-hidden flex"
      title={`Off ${offPct}% · Def ${defPct}% · Dead ${deadPct}%`}
    >
      {offPct  > 0 && <div className="h-full bg-blue-500"  style={{ width: `${offPct}%`  }} />}
      {defPct  > 0 && <div className="h-full bg-green-500" style={{ width: `${defPct}%`  }} />}
      {deadPct > 0 && <div className="h-full bg-red-800"   style={{ width: `${deadPct}%` }} />}
    </div>
  );
}

// ── Team table row ──────────────────────────────────────────────────────────
function TeamRow({ team, even }) {
  const bgClass = even ? 'bg-slate-900' : 'bg-surface';
  const maxEpa  = 50;

  const sigmaColor = (s) =>
    s < 5  ? 'text-green-400'
    : s < 12 ? 'text-yellow-400'
    : 'text-red-400';

  const deadColor = (d) =>
    d < 0.05  ? 'text-green-400'
    : d < 0.15 ? 'text-yellow-400'
    : 'text-red-400';

  // Teams with roleVolatility > 0.15 get a "Switcher" badge
  const isSwitcher = (team.roleVolatility ?? 0) > 0.15;

  // Dominant role hint (only meaningful after ≥ 3 matches)
  let roleHint = '';
  if (team.matchCount >= 3) {
    const { avgTOff = 0, avgTDef = 0 } = team;
    if (avgTDef > 0.35)       roleHint = 'Defender';
    else if (avgTOff > 0.85)  roleHint = 'Pure Offense';
  }

  return (
    <tr className={`${bgClass} border-b border-border/50 hover:bg-surfaceL transition-colors`}>
      {/* Rank */}
      <td className="px-3 py-2.5 text-right">
        <span className={`font-bold text-base ${team.rank <= 3 ? 'text-blue-300' : 'text-slate-300'}`}>
          #{team.rank}
        </span>
      </td>

      {/* Off EPA with mini bar */}
      <td className="px-3 py-2.5 text-right">
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-semibold text-blue-300">{team.epa}</span>
          <div className="w-16 h-1 rounded-full bg-slate-700">
            <div className="h-full rounded-full bg-blue-500"
              style={{ width: `${Math.min(100, (team.epa / maxEpa) * 100)}%` }} />
          </div>
        </div>
      </td>

      {/* Off σ */}
      <td className={`px-3 py-2.5 text-right font-mono ${sigmaColor(team.epaSigma)}`}>
        ±{team.epaSigma}
      </td>

      {/* Defense with mini bar */}
      <td className="px-3 py-2.5 text-right">
        <div className="flex flex-col items-end gap-0.5">
          <span className="font-semibold text-green-400">{team.defense}</span>
          <div className="w-16 h-1 rounded-full bg-slate-700">
            <div className="h-full rounded-full bg-green-500"
              style={{ width: `${Math.min(100, (team.defense / 20) * 100)}%` }} />
          </div>
        </div>
      </td>

      {/* Def σ */}
      <td className={`px-3 py-2.5 text-right font-mono ${sigmaColor(team.defSigma)}`}>
        ±{team.defSigma}
      </td>

      {/* Composite */}
      <td className="px-3 py-2.5 text-right">
        <span className="font-bold text-slate-100">{team.composite}</span>
      </td>

      {/* Matches played */}
      <td className="px-3 py-2.5 text-right text-slate-500">{team.matchCount}</td>

      {/* Dead% */}
      <td className={`px-3 py-2.5 text-right font-mono ${deadColor(team.avgTDead ?? 0)}`}>
        {team.matchCount >= 1
          ? `${Math.round((team.avgTDead ?? 0) * 100)}%`
          : '—'}
      </td>

      {/* Switch σ */}
      <td className="px-3 py-2.5 text-right">
        {team.matchCount >= 2 ? (
          <span className={`font-mono text-xs ${isSwitcher ? 'text-purple-400' : 'text-slate-500'}`}>
            {(team.roleVolatility ?? 0).toFixed(2)}
          </span>
        ) : '—'}
      </td>

      {/* Role profile bar + badges */}
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-1">
          <RoleBar team={team} />
          <div className="flex gap-1 flex-wrap">
            {isSwitcher && (
              <span className="badge bg-purple-900/60 text-purple-300 border border-purple-700/40">
                Switcher
              </span>
            )}
            {roleHint && (
              <span className={`badge border ${
                roleHint === 'Defender'
                  ? 'bg-green-900/60 text-green-300 border-green-700/40'
                  : 'bg-blue-900/60 text-blue-300 border-blue-700/40'
              }`}>
                {roleHint}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Team name / number */}
      <td className="px-3 py-2.5 text-left">
        <div>
          <span className="font-semibold text-slate-100">
            {team.teamKey?.replace('frc', '')}
          </span>
          {team.name && (
            <span className="block text-xs text-slate-500 leading-tight max-w-36 truncate">
              {team.name}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

function ErrorBox({ msg }) {
  return (
    <div className="rounded border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
      {msg}
    </div>
  );
}
