# Quick Task 260909-tiq: Match page — Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Task Boundary

Add a match page. Every match row on an event page and on a team page becomes a
link to that match's own page. The match page shows, for one match: the six
robots with their photos, each robot's metrics as they stood just before this
match was played, the match prediction, the actual result, and the TBA match
video.

**Out of scope for this task** (deferred, see Deferred below): raw TBA
`score_breakdown` stats. They are not published to R2 and adding them needs an
ingest/publish/schema change plus a multi-hour republish.
</domain>

<decisions>
## Implementation Decisions

### Scope — ship on already-published data (LOCKED)
Build the page strictly from artifacts already live in R2. No pipeline change,
no schema change, no republish. The page must be fully functional against the
current published artifact set the moment it ships.

### Robot photos — reuse the team page's existing mechanism (LOCKED)
Jacob: "every team page can already pull the image of a robot. Use whatever the
team page uses."

That mechanism is `TeamSeasonArtifact.robotImageUrl`
(`packages/harness/pageArtifacts.ts:1296`, optional, `z.string().url()`),
rendered through the Radix `Avatar`/`AvatarImage`/`AvatarFallback` trio exactly
as `apps/web/src/components/team/SeasonHeader.tsx:190-199` does. Reuse that
component pattern — including its error-triggered fallback branch, where
`AvatarImage` is rendered only when the URL is present and swaps to
`AvatarFallback` on any load failure.

Do NOT add TBA media ingestion. Do NOT call TBA from the browser.

**Known data reality, must be handled not hidden:** `robotImageUrl` is
optional and ~25% of real teams have no eligible photo at all (that measurement
is recorded in the field's own doc comment). A missing photo renders the
fallback tile, never a broken image and never a placeholder that implies the
photo exists.

### Breakdown stats — granularity, for the deferred follow-up (LOCKED)
When raw TBA score breakdowns do get published, they render as an
alliance-level breakdown table per side, with the genuinely per-robot fields
(endgame position, auto leave/mobility — which ones exist varies by season)
broken out into the three robot columns for the seasons that have them. Do not
present alliance-level data as if it were per-robot.

### Claude's Discretion
- Route path and param spelling (`/match/$matchKey` is the obvious fit with the
  existing `event.$eventKey` / `team.$teamNumber` file-route convention).
- Page layout, section order, and component decomposition.
- Whether the six team-season artifacts are fetched eagerly or lazily, and how
  the page behaves while they are in flight — the match row itself comes from
  the event artifact and should paint without waiting on them.
- Loading / error / not-found states, following existing route conventions.
</decisions>

<specifics>
## Specific Ideas

### Data sources — all already published, verified against the schema

**The event artifact** (`v1/event/{eventKey}/{algorithmId}@{version}.json`)
carries everything about the match itself. `EventMatchSchema`
(`packages/harness/pageArtifacts.ts:337`) has `matchKey`, `compLevel`,
`matchNumber`, `sortTime`, the alliance rosters, the prediction fields, the
match band, `redRpPmf`/`blueRpPmf`, the actual-score and actual-RP pairs, and
the match video key. The same artifact's per-team rows also carry each team's
`record`, `rank`, and `metrics` (line 687), so the event artifact alone covers
the match row plus current-season per-team metrics.

The event page already fetches this artifact, so navigating event -> match can
reuse a warm TanStack Query cache.

**The team-season artifact** (`v1/team/{teamKey}/{year}/{algorithmId}@{version}.json`)
is what supplies the two things the event artifact does not:
`robotImageUrl`, and the per-match rating movement needed for "metrics as they
stood just before this match" rather than end-of-season metrics.
`TeamSeasonMatchSchema` (line 704) is keyed by `matchKey`, so the row for this
match is a direct lookup.

**The video** needs no new parsing. `apps/web/src/lib/matchVideo.ts` already
exists (quick task 260906-7eu) and exports `parseMatchVideoKey` and
`youTubeEmbedUrl`. It validates the YouTube id against an 11-char allowlist
before it ever reaches an iframe `src` — that `undefined` return is both the
correctness and the security boundary (T-7eu-01). Use it; never interpolate a
raw stored video key into an iframe.

### Pre-match metrics — the load-bearing correctness point

"Metrics at the time just before the match" means exactly that: the ratings as
of immediately before this match was played, never the team's end-of-season or
current values. This is the same predict-before-update sequencing the project's
methodology constraint already mandates. Read it from the team-season
artifact's per-match row for this `matchKey`. If a row cannot be resolved for a
team, show absence honestly — do not silently substitute current-season metrics,
which would make a stale number look like a pre-match number.

### Vocabulary — three distinct terms, do not interchange
Swing Score, Match Band, and spread are three different things. The
algorithm's own internal spread must NEVER render to a user. Read
`.claude/skills/sketch-findings-sigmascout` before writing UI.
</specifics>

<canonical_refs>
## Canonical References

- `.claude/skills/sketch-findings-sigmascout/SKILL.md` — MANDATORY before any UI
  work on this repo. Carries the rarity-tier palette and its accessibility
  constraints, the uncertainty/interval display rules (`X ± Y`, 1 SD), and the
  chart-craft rules. Also note the Pine redesign: dark green ribbon + white
  surfaces, green is ink not paint.
- `packages/harness/pageArtifacts.ts` — the Zod schemas that ARE the artifact
  spec. `EventMatchSchema` (337), `TeamSeasonMatchSchema` (704),
  `robotImageUrl` (1296).
- `apps/web/src/components/team/SeasonHeader.tsx:161-199` — the robot-image
  Avatar pattern to reuse verbatim.
- `apps/web/src/lib/matchVideo.ts` — existing video key parsing + embed URL.
- `apps/web/src/routes/event.$eventKey.tsx`, `team.$teamNumber.tsx` — the route
  conventions (file-route naming, loading/error states, search-param typing) a
  new `match.$matchKey` route should follow.
</canonical_refs>

<deferred>
## Deferred to a follow-up task

Raw TBA `score_breakdown` stats on the match page. The data exists in the
corpus (`matches.score_breakdown_raw`, stored verbatim by
`packages/ingest/normalize.ts`) but is never published to R2. Shipping it needs
a new or widened published artifact, a schema change, and a full republish.
Granularity is already decided — see the Breakdown decision above.

Note for whoever picks this up: `redComponents`/`blueComponents` were
deliberately REMOVED from `EventMatchSchema` by quick task 260902-pbc after a
repo-wide grep found zero readers. Do not resurrect those fields assuming they
are the breakdown answer; they were modeled per-alliance component predictions,
not TBA's reported breakdown.
</deferred>
