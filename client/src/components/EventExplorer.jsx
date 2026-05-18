import React, { useState, useEffect } from 'react';
import { Calendar, Search, MapPin, ChevronRight, Loader } from 'lucide-react';

const CURRENT_YEAR = new Date().getFullYear();
const MIN_YEAR = 2015;
const EXCLUDED_YEARS = new Set([2020, 2021]);
const YEARS = Array.from({ length: CURRENT_YEAR - MIN_YEAR + 1 }, (_, i) => CURRENT_YEAR - i)
  .filter((y) => !EXCLUDED_YEARS.has(y));

const EVENT_TYPE_LABELS = {
  0: 'Regional', 1: 'District', 2: 'District Championship',
  3: 'Championship Division', 4: 'Championship Finals',
  5: 'District Championship Division', 6: 'Festival of Champions',
  99: 'Offseason', 100: 'Preseason',
};

export default function EventExplorer({ onSelectEvent }) {
  const [year,    setYear]    = useState(CURRENT_YEAR);
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [query,   setQuery]   = useState('');

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/events/${year}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(setEvents)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [year]);

  const filtered = events.filter((ev) => {
    const q = query.toLowerCase();
    return !q
      || ev.name?.toLowerCase().includes(q)
      || ev.key?.toLowerCase().includes(q)
      || ev.city?.toLowerCase().includes(q)
      || ev.state_prov?.toLowerCase().includes(q);
  });

  // Group by event type for cleaner display
  const grouped = filtered.reduce((acc, ev) => {
    const label = EVENT_TYPE_LABELS[ev.event_type] ?? 'Other';
    (acc[label] ??= []).push(ev);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-blue-400 shrink-0" />
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {YEARS.map((y) => <option key={y} value={y}>{y} Season</option>)}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-md">
          <Search size={14} className="text-slate-500 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, location, key…"
            className="flex-1 bg-surface border border-border rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-slate-600"
          />
        </div>
      </div>

      {/* Stats bar */}
      <div className="text-xs text-slate-500">
        {loading ? 'Loading…' : `${filtered.length} events in ${year}`}
      </div>

      {error && (
        <div className="rounded border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-40">
          <Loader size={24} className="text-blue-500 animate-spin" />
        </div>
      )}

      {/* Event groups */}
      {!loading && Object.entries(grouped).map(([groupName, evs]) => (
        <section key={groupName}>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500 mb-2">
            {groupName} ({evs.length})
          </h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {evs.map((ev) => (
              <EventCard key={ev.key} event={ev} onSelect={onSelectEvent} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function EventCard({ event, onSelect }) {
  const start = event.start_date ? new Date(event.start_date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  }) : '—';
  const end = event.end_date ? new Date(event.end_date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  }) : '—';

  return (
    <button
      onClick={() => onSelect(event.key, event.name)}
      className="text-left group rounded-lg border border-border bg-surface hover:border-blue-600 hover:bg-surfaceL transition-colors p-4 flex flex-col gap-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-semibold text-slate-100 group-hover:text-blue-300 leading-snug">
          {event.name}
        </span>
        <ChevronRight size={14} className="text-slate-600 group-hover:text-blue-400 shrink-0 mt-0.5" />
      </div>

      <div className="flex items-center gap-1 text-xs text-slate-500">
        <MapPin size={11} />
        <span>{[event.city, event.state_prov, event.country].filter(Boolean).join(', ') || 'TBD'}</span>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">{start} – {end}</span>
        <span className="font-mono text-slate-600">{event.key}</span>
      </div>
    </button>
  );
}
