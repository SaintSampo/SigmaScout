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
| `cdphotothread` | INTEGRATE | Chief Delphi photo thread; carries a robot photo. `direct_url` is optional per the spec and the variant also carries `details.image_partial` — the picker requires a non-empty `direct_url` and skips the entry otherwise rather than reconstructing a URL from `image_partial` (RESEARCH A4 was not resolved against a live response; skipping is the conservative branch and degrades to the next candidate, never to a broken `<img src>`) |
| `instagram-image` | INTEGRATE | a still image with a `direct_url` |
| `preferred` flag honoured as the ranking key | INTEGRATE | D-03's stated selection rule: preferred-where-flagged, else first (measured: 14/20 sampled teams carry a `preferred` flag) |
| `avatar` | **OPT-OUT** | not a robot photo — a 40×40 team logo whose variant carries `details.base64Image` inline instead of a `direct_url`. Rendering it as the robot image would misrepresent the page's own claim, and rendering a base64 blob into an `<img src>` attribute is the data-shape risk `06-RESEARCH.md`'s Security Domain names (threat T-06-04) |
| `youtube`, `youtube-channel` | OPT-OUT | video, not a still robot photo |
| `facebook-profile`, `twitter-profile`, `github-profile`, `instagram-profile`, `periscope-profile`, `gitlab-profile` | OPT-OUT | social profile links — no image URL at all |
| `grabcad`, `onshape` | OPT-OUT | CAD models, not photos |
| `external-link`, `cd-thread` | OPT-OUT | plain links — no image URL |
| `view_url` (the media's *page* URL, on any type) | OPT-OUT | the team page needs a direct image URL for `<img src>`; `direct_url` is the field that provides it, and a page URL rendered as an image source is a guaranteed broken image |
| `team_keys` (multi-team media) | OPT-OUT | the fetch is already scoped to one team key; a media item's other team associations are not displayed anywhere this phase |

## The recurring cost this integration commits to

`packages/ingest/tbaClient.ts`'s `THROTTLE_INTERVAL_MS = 100` applies per request unconditionally,
including on cache-hit 304 responses. The distinct (team, year) pair count across 2022–2026 is
**17,231** (51,693 published `team/{teamKey}/{year}` objects ÷ 3 algorithms — media is not
algorithm-scoped). That is **≈28.7 minutes added to every full ingest run**, not only the first —
ETag caching saves bandwidth, not request count or throttle wait. This is stated here rather than
assumed negligible.
