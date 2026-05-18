'use strict';
/**
 * tbaClient.js — TBA API v3 HTTP wrapper with ETag-based disk caching.
 *
 * On every request we send If-None-Match with the stored ETag.
 * TBA returns 304 → we serve the cached JSON with zero bandwidth cost.
 * TBA returns 200 → we update the cache file and the stored ETag.
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const crypto = require('crypto');

const TBA_BASE  = 'https://www.thebluealliance.com/api/v3';
const CACHE_DIR = path.join(__dirname, 'cache');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// Deterministic filename for an API path
function cachePath(endpoint) {
  const hash = crypto.createHash('sha256').update(endpoint).digest('hex');
  return path.join(CACHE_DIR, `${hash}.json`);
}

function loadCache(endpoint) {
  const p = cachePath(endpoint);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function saveCache(endpoint, etag, data) {
  fs.writeFileSync(cachePath(endpoint), JSON.stringify({ etag, data, saved: Date.now() }), 'utf8');
}

/**
 * tbaGet(endpoint) — fetch from TBA with automatic ETag caching.
 * Throws on non-304/non-2xx errors (caller should handle).
 */
async function tbaGet(endpoint) {
  const apiKey = process.env.TBA_API_KEY;
  if (!apiKey) throw new Error('TBA_API_KEY environment variable is not set');

  const cached = loadCache(endpoint);
  const headers = { 'X-TBA-Auth-Key': apiKey };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;

  try {
    const res = await axios.get(`${TBA_BASE}${endpoint}`, {
      headers,
      // axios throws on 4xx/5xx; 304 is handled via the catch below
      validateStatus: (s) => s < 400 || s === 304,
    });

    if (res.status === 304 && cached) return cached.data; // Not Modified

    const etag = res.headers['etag'] ?? null;
    saveCache(endpoint, etag, res.data);
    return res.data;
  } catch (err) {
    // Fallback: serve stale cache rather than hard-fail
    if (cached) {
      console.warn(`[TBA] ${endpoint} fetch failed (${err.message}), serving stale cache`);
      return cached.data;
    }
    throw err;
  }
}

/**
 * invalidateCache(endpoint) — force the next request to refetch from TBA.
 */
function invalidateCache(endpoint) {
  const p = cachePath(endpoint);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

module.exports = { tbaGet, invalidateCache };
