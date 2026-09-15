---
id: live-merge-drops-event-identity-fields
created: 2026-09-15
source: quick task 260915-isq (browser pricing step 2), found by the executor and confirmed by the orchestrator against scheduled.ts
priority: high
resolved: 2026-09-15
resolved_by: quick task 260915-p0a
---

# A live tick rebuilds the event artifact without its identity fields

`mergeEventArtifact` (`apps/worker/src/scheduled.ts`, the return object after the `teams` rebuild)
builds its output from scratch instead of spreading `existing`. As a result, the first live tick at an
event drops these fields from the event artifact:

- `name`, `startDate`, `location`, `week`
- `alliances`

For every touched team, the standings row is rebuilt with only `teamKey`, `teamNumber`, `nickname` and
`metrics`. Any published `rank`, `record` or `rp` on that row is lost.

This predates the browser-pricing work. `eventType` and `state` are now carried forward deliberately
(260915-isq). The other fields are not.

**Impact:** none today, because the pre-season gate keeps every live window closed. Once a window opens,
the event page loses its title, dates, location, alliance selections and standings columns on the
first tick.

**Fix direction:**
- Start the merge from `existing` and overwrite only what the tick owns: `matches`, `upcoming`, the
  touched `teams` rows' metrics, `rpOutcomeRp`, `state` and the stamps.
- For touched teams, spread the prior row, then replace its metrics.
- Pin it with a test: an artifact carrying every optional field keeps each one through a tick.
  Precedent: the live/offline row-shape parity gap in the v1.0 audit's integration section.

Belongs with the DATA-04 row-parity items that must land before the pre-season gate lifts. Related:
[[rp-fold-exceeds-worker-cpu-budget]], [[live-merges-drop-percentiles]].

## Resolution

Resolved 2026-09-15 by quick task 260915-p0a. See
`.planning/quick/260915-p0a-live-merge-keeps-event-identity-fields-a/260915-p0a-SUMMARY.md`.

**Event merge: spread, then override.** `mergeEventArtifact` now starts from `existing` (which has
been through `LiveEventArtifactSchema.parse`, so it carries exactly the schema-known keys) and
overrides only the keys the tick owns: the stamps, `algorithmId`/`algorithmVersion`/`eventKey`/
`season`, `matches`, `upcoming`, `teams`, `eventType` when the detail fetch returned one,
`rpOutcomeRp` when this tick derived one, and `state`. A key the publisher adds later survives a tick
with no edit here — an allow-list is exactly how this bug happened. `state` is destructured OUT of
`existing` before the spread, because the tick may deliberately omit it (non-SPR artifact, or no
upcoming match left); that also re-appends it last, where the schema wants the large block.

**Standings rows are replaced IN PLACE and keep TBA's own values.** A touched row is the prior row
spread with its `metrics` replaced; `rank`, `record` and `rp` are TBA's official standings, which
this Worker never fetches and never recomputes, so they are preserved as last published and are
STALE UNTIL THE NEXT REPUBLISH — the same carry-forward the Sigma entry and the teams-row `record`
already use. Stale-but-true TBA values beat a standings table whose columns vanish mid-event. Row
order no longer moves: a touched team stays where the publisher put it, and a touched team with no
published row is appended in the existing bootstrap shape.

**`seasonStats` spreads too, and the tick writes an honest `metricsBasis`.** The team-season merge
spreads `existing.seasonStats` and then writes `record`, `metrics` and `metricsBasis`. The tick owns
`metrics`, so it owns the label describing them: `"last-official-match"` when every match folded this
tick is official (per `isOfficialEventType`, where the `-1` detail-fetch-failed sentinel counts as
official, the same gate `incrementRecord` uses) and `"season-final"` otherwise. Carrying a published
`"last-official-match"` through an offseason tick would mislabel the value. The missing percentiles
and the unscoped offseason write remain OPEN in [[live-merges-drop-percentiles]] and are not claimed
here. The team-season new-event bootstrap entry (eventName = the event key, startDate = the tick's
date, no rank/totalTeams) is unchanged.

**Live played rows now carry what the offline publisher carries.** Both builders moved into the
browser-safe `packages/harness/publishedRows.ts` (`eventPlayedRow`, `teamSeasonPlayedRow`), so the
publisher and the Worker build a row through the same code; the offline artifacts hash identically
before and after the move. A live played row now carries `actualRedRp`/`actualBlueRp` (through the
same `toIntegerRpOrNull` policy), `actualRedBonusRp`/`actualBlueBonusRp`, `redScoreVarianceOwn`/
`blueScoreVarianceOwn`, `video`, `sortTime`, and — on team-season rows — `setNumber`, `matchNumber`
and the predicted `redBonusRp`/`blueBonusRp` marginals. The actual bonus flags reuse the score
breakdown Phase A's RP fold ALREADY parsed, passed through to Phase B, so the common path pays no
second parse against the tick's CPU budget; only a live tier with no RP-publishing algorithm parses
in Phase B. Phase A's folds, its D1 writes and the subrequest estimate are unchanged.

**`coldStart` is the one tested exception.** Offline it comes from `corpusColdStartIndex`, a
corpus-global first-appearance index; the Worker has no corpus, and a D1 team-row presence check is
an unproven proxy. Publishing it under a name that asserts corpus-global provenance would be a false
attribution, so live rows carry no `coldStart` key at all, pinned by
`apps/worker/test/scheduled.rowParity.test.ts`.

**No reported time, no invented one.** When TBA reports no actual/predicted/scheduled time, the row
takes the `sortTime` already published for that match (its own played row, else its upcoming row),
and otherwise carries no `sortTime` key — never the tick's window-start approximation (260915-isq).

**A failed event-detail fetch** leaves the event RP-ineligible (`-1`), so the actual bonus flags
publish `null`, meaning "not derivable" rather than "no bonuses earned". That heals at the next
republish.

The v1.0 audit's "Worker -> R2 row shape (live/offline parity)" integration note is NOT edited, because
audits are historical. Its played-row gap (`actualRedRp`/`actualBlueRp`, the actual bonus-RP flags,
`sortTime`, the `ScoreVarianceOwn` pair and `video`) is closed by 260915-p0a with `coldStart` as the
one tested exception, and upcoming rows remain schedule-only by design (260915-isq).
