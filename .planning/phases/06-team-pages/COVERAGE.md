# API Coverage — The Blue Alliance API v3, `/team/{team_key}/media/{year}`

> Full coverage by default. Opt-outs are explicit, reasoned decisions.

## Why this file exists despite a `detected: false` detector result

`gsd-tools`' api-coverage detector was run twice over this phase's scope (the ROADMAP section,
then again with `06-CONTEXT.md` in scope) and returned `detected: false` both times. The detector
is deterministic, not infallible, and it under-reported here: **D-03 genuinely adds one new
third-party endpoint** — TBA's `/team/{team_key}/media/{year}` — to `packages/ingest/tbaClient.ts`.
Writing the matrix now is cheap and prevents a seal-time re-detection surprise.

Scope note: TBA's API as a whole was integrated in Phase 1. This matrix decides the capability
surface of **the media endpoint and its response types only** — the one genuinely new surface this
phase opens. Every other TBA endpoint's coverage decision belongs to Phase 1, not to this phase.

## Request-level capabilities

| capability | decision | reason |
|---|---|---|
| `GET /team/{team_key}/media/{year}` | INTEGRATE | |
| `If-None-Match` / ETag conditional request (304) | INTEGRATE | |
| `Cache-Control` respect | OPT-OUT | the corpus's generic `http_cache` ETag table is the caching mechanism this pipeline already uses for every TBA endpoint; a second, header-driven TTL layer would be a parallel cache with its own drift |
| `GET /team/{team_key}/media/tag/{media_tag}/{year}` | OPT-OUT | not needed — the untagged year endpoint returns the same robot-photo set; a tag filter adds a second request shape for no additional data |
| `GET /team/{team_key}/social_media` | OPT-OUT | out of scope — the team page shows no social links (TEAM-02 asks for name, robot image, TBA link only) |
| `GET /team/{team_key}/robots` | OPT-OUT | returns robot *names* per year, not images; not requested by TEAM-02 and not part of any locked decision |

## Response-type capabilities (`Media.type` enum, verified against TBA's own OpenAPI spec)

The endpoint returns a heterogeneous, `type`-discriminated array. Each member type is a separate
capability decision because each has a different (or absent) usable-image contract.

| capability | decision | reason |
|---|---|---|
| `imgur` | INTEGRATE | carries a `direct_url` to a robot photo — the primary case (measured: 15/20 sampled 2024 teams have a robot photo at an opaque imgur/instagram key) |
| `cdphotothread` | INTEGRATE | Chief Delphi photo thread; carries a robot photo. The picker requires a non-empty `direct_url` and skips the entry otherwise — see note [1] |
| `instagram-image` | INTEGRATE | a still image with a `direct_url` |
| `preferred` flag honoured as the ranking key | INTEGRATE | D-03's stated selection rule: preferred-where-flagged, else first (measured: 14/20 sampled teams carry a `preferred` flag) |
| `avatar` | **OPT-OUT** | not a robot photo — a small team logo whose variant carries `details.base64Image` inline instead of a `direct_url` — see note [2] |
| `youtube`, `youtube-channel` | OPT-OUT | video, not a still robot photo |
| `facebook-profile`, `twitter-profile`, `github-profile` | OPT-OUT | social profile links — no image URL at all |
| `instagram-profile`, `periscope-profile`, `gitlab-profile` | OPT-OUT | social profile links — no image URL at all |
| `grabcad`, `onshape` | OPT-OUT | CAD models, not photos |
| `external-link`, `cd-thread` | OPT-OUT | plain links — no image URL |
| `view_url` (the media's *page* URL, on any type) | OPT-OUT | the team page needs a direct image URL for `<img src>`; `direct_url` is the field that provides it, and a page URL rendered as an image source is a guaranteed broken image |
| `team_keys` (multi-team media) | OPT-OUT | the fetch is already scoped to one team key; a media item's other team associations are not displayed anywhere this phase |

### Notes on the two condensed rows above

**[1] `cdphotothread`.** `direct_url` is optional per the spec and the variant also carries
`details.image_partial`. The picker requires a non-empty `direct_url` and skips the entry rather
than reconstructing a URL from `image_partial` — RESEARCH A4 was not resolved against a live
response, so skipping is the conservative branch: it degrades to the next candidate, never to a
broken `<img src>`.

**[2] `avatar`.** The avatar is a 40×40 team logo, not a robot photo. Rendering it as the robot
image would misrepresent the page's own claim, and rendering a base64 blob into an `<img src>`
attribute is the data-shape risk `06-RESEARCH.md`'s Security Domain names (threat T-06-04).

## The recurring cost this integration commits to

`packages/ingest/tbaClient.ts`'s `THROTTLE_INTERVAL_MS = 100` applies per request unconditionally,
including on cache-hit 304 responses. The distinct (team, year) pair count across 2022–2026,
**measured from a real full 2022–2026 run (plan 06-03 Task 3, 2026-08-25): 17,231** (matches the
51,693 ÷ 3 projection to within 2 — two requests hit a genuinely non-existent placeholder team key,
`frc0`, on a single 2024 event with an unresolved playoff bracket match; both 404 and are skipped,
never stored). ETag caching saves bandwidth, not request count or throttle wait — a second
immediate run over 2022 and 2026 measured 0 fresh / 100% cache hits, confirming this.

**The ≈28.7-minute projection assumed the 100ms throttle floor with zero added network latency.**
Real per-season measurements show that assumption understates the true cost: observed per-request
time ranged from ~118ms to ~217ms (18–117% above the 100ms floor) depending on live network/API
conditions at run time — e.g. season 2025 (3,691 requests) measured 7.2 minutes (~117ms/request)
while season 2026 (3,710 requests) measured 13.4 minutes (~217ms/request) in the same run. Summed
across a real 5-season first-pass run (including retry overhead from a Rule-1 bug found and fixed
mid-run — see `06-03-SUMMARY.md`), total wall clock was **~44 minutes**, roughly 1.5× the original
projection. Budget **30–60 minutes** for a full `pnpm ingest:media --years 2022-2026` run, not a
fixed 28.7 minutes.
