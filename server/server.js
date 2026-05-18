'use strict';
require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const { tbaGet, invalidateCache } = require('./tbaClient');
const {
  processEventMatchesWithPredictions,
  simulateMatch,
  rankTeams,
  createTeam,
} = require('./engine');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }));

// ── IN-MEMORY COMPUTED CACHE ────────────────────────────────────────────────
// Avoids re-running the Kalman sweep on every request.
// Invalidated on /refresh or after TTL.

const computedCache = new Map(); // eventKey → { teamMap, rankedTeams, enrichedMatches, ts }
const COMPUTE_TTL   = 30_000;   // 30 s before a background refresh is allowed

async function getEventData(eventKey, forceRefresh = false) {
  const now    = Date.now();
  const cached = computedCache.get(eventKey);

  if (!forceRefresh && cached && now - cached.ts < COMPUTE_TTL) return cached;

  const matches = await tbaGet(`/event/${eventKey}/matches`);
  const { teamMap, enrichedMatches } = processEventMatchesWithPredictions(matches);
  const rankedTeams = rankTeams(teamMap);

  const entry = { teamMap, rankedTeams, enrichedMatches, ts: Date.now() };
  computedCache.set(eventKey, entry);
  return entry;
}

// ── SSE LIVE UPDATES ────────────────────────────────────────────────────────
// Clients subscribe to an event stream; /refresh broadcasts a push.

const sseClients = new Map(); // eventKey → Set<res>

function broadcast(eventKey, payload) {
  const clients = sseClients.get(eventKey);
  if (!clients?.size) return;
  const msg = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) res.write(msg);
}

app.get('/api/stream/:event_key', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const key = req.params.event_key;
  if (!sseClients.has(key)) sseClients.set(key, new Set());
  sseClients.get(key).add(res);

  // Heartbeat every 25 s to keep connection alive through proxies
  const hb = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(hb);
    sseClients.get(key)?.delete(res);
  });
});

// ── ENDPOINTS ───────────────────────────────────────────────────────────────

/**
 * GET /api/events/:year
 * All events for a competition year, sorted by start date.
 */
app.get('/api/events/:year', async (req, res) => {
  try {
    const data = await tbaGet(`/events/${req.params.year}/simple`);
    const sorted = data.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
    res.json(sorted);
  } catch (err) {
    console.error('[/api/events]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/event/:event_key/teams
 * All teams at the event with their 4-score SigmaScout ranking.
 * Team names are fetched from TBA and merged into the rating objects.
 */
app.get('/api/event/:event_key/teams', async (req, res) => {
  try {
    const { rankedTeams } = await getEventData(req.params.event_key);

    // Fetch human-readable team info (best-effort — non-fatal on failure)
    let infoMap = {};
    try {
      const infos = await tbaGet(`/event/${req.params.event_key}/teams/simple`);
      for (const t of infos) infoMap[t.key] = t;
    } catch { /* serve without names */ }

    const enriched = rankedTeams.map((t) => ({
      ...t,
      name:  infoMap[t.teamKey]?.nickname  || t.teamKey.replace('frc', 'Team '),
      city:  infoMap[t.teamKey]?.city      || '',
      state: infoMap[t.teamKey]?.state_prov || '',
    }));

    res.json(enriched);
  } catch (err) {
    console.error('[/api/event/teams]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/event/:event_key/matches
 * Event schedule with per-match predictions (computed using ratings at match
 * time) and actual results for completed matches.
 */
app.get('/api/event/:event_key/matches', async (req, res) => {
  try {
    const { enrichedMatches } = await getEventData(req.params.event_key);
    res.json(enrichedMatches);
  } catch (err) {
    console.error('[/api/event/matches]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/team/:team_key
 * Basic TBA team info (name, location, rookie year, etc.).
 */
app.get('/api/team/:team_key', async (req, res) => {
  try {
    const info = await tbaGet(`/team/${req.params.team_key}/simple`);
    res.json({ info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/teams/stats?keys=frc254,frc1114,...
 * Batch team info lookup for the sandbox simulator.
 * Returns TBA info; caller should pass an eventKey via POST /api/simulate
 * to get ratings-aware simulation.
 */
app.get('/api/teams/stats', async (req, res) => {
  try {
    const keys = (req.query.keys || '').split(',').map((k) => k.trim()).filter(Boolean);
    if (!keys.length) return res.json([]);

    const results = await Promise.all(
      keys.map(async (key) => {
        try {
          const info = await tbaGet(`/team/${key}/simple`);
          return { key, info, found: true };
        } catch {
          return { key, found: false };
        }
      }),
    );
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/simulate
 * Body: { red: string[], blue: string[], eventKey?: string }
 * Runs a Monte Carlo simulation using the event's computed teamMap (if
 * eventKey is provided) or default priors (sandbox / global mode).
 */
app.post('/api/simulate', async (req, res) => {
  try {
    const { red, blue, eventKey } = req.body;
    if (!Array.isArray(red) || !Array.isArray(blue) || red.length === 0 || blue.length === 0) {
      return res.status(400).json({ error: 'Provide non-empty red and blue arrays' });
    }

    let teamMap = {};
    if (eventKey) {
      try {
        const data = await getEventData(eventKey);
        teamMap = data.teamMap;
      } catch { /* fallback to priors */ }
    }

    const result = simulateMatch(red, blue, teamMap);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/event/:event_key/refresh
 * Invalidates the TBA cache + computed cache for the event, reprocesses,
 * and broadcasts an SSE update to connected clients.
 * Call this from a webhook, a cron job, or the "Refresh" button.
 */
app.post('/api/event/:event_key/refresh', async (req, res) => {
  const key = req.params.event_key;
  invalidateCache(`/event/${key}/matches`);
  computedCache.delete(key);

  try {
    const data = await getEventData(key, true);
    broadcast(key, { type: 'refresh', ts: Date.now() });
    res.json({ ok: true, teams: data.rankedTeams.length, matches: data.enrichedMatches.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SYNC ROUTE (bulk historical ingest) ─────────────────────────────────────
/**
 * POST /api/sync/:year
 * Fetches and caches all events + their matches for a full competition year.
 * Useful for pre-warming the cache before an event starts.
 * This runs in the background; returns immediately with a job token.
 */
app.post('/api/sync/:year', async (req, res) => {
  const year = Number(req.params.year);
  if (isNaN(year) || year < 2015 || year > new Date().getFullYear() + 1 || year === 2020 || year === 2021) {
    return res.status(400).json({ error: 'Invalid year' });
  }

  // Respond immediately; do the work asynchronously
  res.json({ ok: true, message: `Syncing ${year} — check server logs for progress` });

  (async () => {
    try {
      console.log(`[sync] Starting full sync for ${year}…`);
      const events = await tbaGet(`/events/${year}/simple`);
      console.log(`[sync] ${year}: ${events.length} events found`);

      for (const ev of events) {
        try {
          await getEventData(ev.key, true);
          console.log(`[sync] ✓ ${ev.key}`);
        } catch (e) {
          console.warn(`[sync] ✗ ${ev.key}: ${e.message}`);
        }
      }
      console.log(`[sync] Finished ${year}`);
    } catch (e) {
      console.error(`[sync] Fatal: ${e.message}`);
    }
  })();
});

app.listen(PORT, () => {
  console.log(`SigmaScout backend → http://localhost:${PORT}`);
  if (!process.env.TBA_API_KEY) {
    console.warn('  ⚠  TBA_API_KEY is not set — requests will fail. Add it to server/.env');
  }
});
