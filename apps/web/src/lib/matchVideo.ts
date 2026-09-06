/**
 * Pure, DOM-free parsing for a TBA-published match video key (quick task
 * 260906-7eu). No React, no browser globals beyond `URL`/`URLSearchParams`
 * (both available in the Vitest/jsdom environment this file's own tests run
 * under, and in every browser this site ships to).
 *
 * `packages/ingest/normalize.ts` stores TBA's `videos[].key` verbatim,
 * including any trailing timestamp suffix — this file is where that raw
 * string is finally interpreted, tolerantly, for display.
 */

/** A YouTube video id is always exactly 11 characters from this alphabet. */
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * A generous upper bound on the raw input this function will even attempt to
 * parse — rejecting anything longer up front, before any regex or URL
 * parsing runs, is this function's first line of defence against a string
 * "long enough to be an attack payload rather than an id" (this file's own
 * `<behavior>` contract). A real TBA video key or a real YouTube URL is
 * always far shorter than this.
 */
const MAX_INPUT_LENGTH = 512;

export interface MatchVideo {
  /** A validated 11-character YouTube video id — never the raw unparsed input. */
  readonly id: string;
  /** Whole seconds into the video the player should start at, when the source carried a timestamp. */
  readonly startSeconds?: number;
}

/**
 * Parses a duration suffix into whole seconds. Accepts a bare integer
 * (seconds, e.g. `"95"`) and TBA/YouTube's compound `NhNmNs` notation (any
 * subset, e.g. `"1m35s"`, `"35s"`, `"2h"`). Returns `undefined` for anything
 * that doesn't match either shape — never a partial/best-effort number.
 */
function parseTimestamp(raw: string): number | undefined {
  if (raw.length === 0) return undefined;
  if (/^\d+$/.test(raw)) return Number(raw);

  const compound = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (compound === null) return undefined;
  const [, hours, minutes, seconds] = compound;
  if (hours === undefined && minutes === undefined && seconds === undefined) return undefined;
  return Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
}

/** Reads a `t` param out of a `?`/`&`/`#`-prefixed suffix (query-string shaped either way) and resolves it to whole seconds. */
function extractStartSeconds(suffix: string): number | undefined {
  const params = new URLSearchParams(suffix);
  const value = params.get("t");
  if (value === null) return undefined;
  return parseTimestamp(value);
}

/**
 * Attempts to interpret `input` as a full YouTube watch URL, a `youtu.be`
 * short URL, or an embed URL, returning the contained id (and any `t`/
 * `start` timestamp). Returns `undefined` for anything that is not
 * recognizably one of those three forms, INCLUDING a syntactically valid URL
 * to an unrelated host — this is a strict allowlist of known YouTube URL
 * shapes, not a general URL parser.
 */
function tryParseUrl(input: string): MatchVideo | undefined {
  const looksLikeUrl = /^https?:\/\//i.test(input) || /^(www\.)?youtu\.be\//i.test(input) || /^(www\.)?youtube\.com\//i.test(input);
  if (!looksLikeUrl) return undefined;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return undefined;
  }

  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  let id: string | undefined;
  if (host === "youtu.be") {
    id = url.pathname.slice(1).split("/")[0];
  } else if (host === "youtube.com") {
    if (url.pathname === "/watch") {
      id = url.searchParams.get("v") ?? undefined;
    } else if (url.pathname.startsWith("/embed/")) {
      id = url.pathname.slice("/embed/".length).split("/")[0];
    }
  }

  if (id === undefined || !YOUTUBE_ID_PATTERN.test(id)) return undefined;

  const timestampRaw = url.searchParams.get("t") ?? url.searchParams.get("start");
  const startSeconds = timestampRaw !== null ? parseTimestamp(timestampRaw) : undefined;
  return startSeconds === undefined ? { id } : { id, startSeconds };
}

/**
 * Resolves a raw TBA-stored video key into a validated `MatchVideo`, or
 * `undefined` when it cannot be confidently resolved.
 *
 * `undefined` is BOTH the correctness boundary and the security boundary
 * (T-7eu-01): the returned `id` is interpolated into an iframe `src` by
 * `youTubeEmbedUrl`/`MatchVideoCell`, so this function validates the id
 * against the YouTube id character set and a plausible length bound and
 * rejects everything else, rather than passing an unrecognized string
 * through and letting the browser resolve it. Handles the bare-id form, a
 * bare id with a trailing `?t=`/`&t=`/`#t=` timestamp suffix, and the three
 * URL forms (`tryParseUrl`) — TBA data is not uniformly bare ids.
 */
export function parseMatchVideoKey(raw: string | undefined): MatchVideo | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_INPUT_LENGTH) return undefined;

  const fromUrl = tryParseUrl(trimmed);
  if (fromUrl !== undefined) return fromUrl;
  // A string that looked like a URL but didn't resolve to a recognized
  // YouTube shape is rejected outright here, never falling through to be
  // reinterpreted as a bare id (a URL's scheme/host is never a valid id).
  if (/^https?:\/\//i.test(trimmed) || /^(www\.)?youtu\.be\//i.test(trimmed) || /^(www\.)?youtube\.com\//i.test(trimmed)) {
    return undefined;
  }

  const separatorIndex = trimmed.search(/[?&#]/);
  const idPart = separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex);
  if (!YOUTUBE_ID_PATTERN.test(idPart)) return undefined;
  if (separatorIndex === -1) return { id: idPart };

  const startSeconds = extractStartSeconds(trimmed.slice(separatorIndex + 1));
  return startSeconds === undefined ? { id: idPart } : { id: idPart, startSeconds };
}

/**
 * Builds the privacy-preserving `youtube-nocookie.com` embed URL for a
 * parsed video. Autoplay is always on — the reader has just clicked to open
 * a player, so playing is the expected result — and a `start` parameter is
 * included only when `video.startSeconds` was parsed. The returned string
 * contains ONLY `video.id` (already validated by `parseMatchVideoKey`) and
 * never any raw unparsed input, since this function never sees the raw
 * string at all.
 */
export function youTubeEmbedUrl(video: MatchVideo): string {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${video.id}`);
  url.searchParams.set("autoplay", "1");
  if (video.startSeconds !== undefined) {
    url.searchParams.set("start", String(video.startSeconds));
  }
  return url.toString();
}
