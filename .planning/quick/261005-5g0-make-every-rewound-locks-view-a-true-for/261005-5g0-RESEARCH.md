# 261005-5g0 research: rewound Locks views as true as-of forecasts

Base: `locks-rewind-asof` at 58f1f80f (worktree `../SigmaScout-rewind-asof`). Live versions read
2026-10-05 from `v1/manifest/algorithms.json`: opr 6.0.0, epa 13.0.0, spr 9.0.0 (generation
b2bfe488). The combined release (epa 14, spr 10) is local only.

Measurements live in `261005-5g0-SPIKE.md`. This file holds the design and the input audit.

## 1. Design (orchestrator's, constrained by Jacob's four rules)

### What is captured, and where
At every match fold (offline `publishSeasons` layer pass, live Worker Phase A loop) one shared
pure function reads the post-fold state of the teams in that match plus the league row:

- Team tuple `T = [spr|null, sigma|null, rp|null]`
  - spr `[muL, pL, muS, pS]` (demo keys read the pseudo team)
  - sigma `[meanWeight, mean, varWeight, sumSquares, talent]`
  - rp one `[weight, weightSquares, mean, m2] | null` per threshold variable, rule-module order
- League tuple `L = [logTau, scale, sigPopSumSquares, sigPopTalentSquares, sigPopCount,
  (n, mean, m2) x V, (count, sum) x V]`

Team state moves only when the team plays (verified in `spr.ts` `foldRatings`,
`SigmaScoreAccumulator.fold`, `RpMomentsAccumulator.fold`); the league row moves on every fold.
No time-dependent term exists in `predict`. So a team's state at any instant is the tuple
after its last match before that instant, and the league row at the instant is the one captured
at the last fold before it.

### Published objects (per event, per algorithm, SPR only for now)
- INDEX (small): per team `{ f, l, p: [prevEventKey, prevSortTime] | null, s: T before its first
  match here, x: T after its last match here }`, plus `lq` (league after the last qualification
  match) and `le` (league after the last match), `first`, `last`, `vars`.
- LOG: one row per folded match `{ k, t, L, tm: [[teamKey, T] x 6] }`.
- Per season: `start` (`L0`, the league row before the first fold) and `tails`
  (`teamKey -> last event played`).

### Order
One order everywhere: `(sort_time, eventKey, row index within the event)`, which is the season
stream's own order (`selectMatchesChronological`). A position's cut is its own match row. The
browser decides "remaining" rows by the same key, not by the timeline's separate comparison.

### Lookup (browser)
For team X at cut c, start from X's earliest known event that begins after c (else `tails[X]`):
- first match here at or before c: last match here at or before c -> `x`; else last LOG row <= c
- first match after c: `p` null or `p` time <= c -> `s`; else hop to `p[0]`
League at c: the cut row's `L` (or `lq`/`le` for a stage stop, or `L0` for Season start).

Trap 1 (frc27 via 2026ohcl) is the hop case; trap 2 (no match yet) is `s` with `p === null`.

### Pricing (browser, in the Web Worker)
Rebuild `SprState`, `SigmaScoreAccumulator.fromBeliefs`, `RpMomentsAccumulator.fromBeliefs`,
`RpMeanShiftAccumulator.fromState` from the tuples, then mirror the oracle's closures
(`buildDistrictPricingState` `ratingsFor`/`predictFor`: rookie rule, all-or-nothing roster gate,
`makeRankingPointFiller`). Ratings for the draft and playoffs come from the same rebuilt state.

### Live Worker
Phase A's loop already holds state, sigma, rp and the mean shift after each fold
(`apps/worker/src/scheduled.ts` 1637-1671). Capture there, then read-modify-write the event's
INDEX and LOG in R2 (and `tails` when a team starts a new event). No D1 change, so
`STATE_SNAPSHOT_SHAPE_VERSION` stays 18. Within one event the tick folds in order (cursor); across
concurrent events the tick's order can differ from sort-time order by minutes, which only moves
the league row; a rebaseline rewrites the files from the offline replay.

### Timeline change this forces
All four stage steps of an event share its LAST QUALIFICATION instant
(`districtTimeline.ts` 196-208). So at `E:awards` a concurrent event's later matches still count
as remaining while E's playoff and award points are already final, and a week boundary stop has
no real instant. Playoffs and awards steps must sit at the event's last played playoff match so
every stop has one cut.

## 2. Input audit (rewound position P), from a read of HEAD 58f1f80f

| Input | Value at a rewound position | Class |
|---|---|---|
| Match odds, RP pmfs (stored per-row predictions) | made right before each match | later knowledge (this task) |
| Team ratings for draft and playoffs (`teams[].metrics`) | end of event | later knowledge (this task) |
| Real qualification schedule of a not yet scheduled event | the real one | later knowledge (decision A) |
| Other events' playoff/award finality | final once P passes that event's last QUAL instant | mixed: arrives hours early for same-weekend events |
| Baked sidecar of an event unstarted even now | priced at the publish clock | later knowledge when P is before the publish |
| Event roster, `fieldSize` | teams that actually played | later knowledge (minor): only registrations existed |
| `awardOnlyTeams` | from the posted schedule | later knowledge (minor) |
| `knownAlliances` | used only once the stage is final at P | known then; a 4th backup robot added during playoffs can ride along |
| Divisioned DCMP parent playoff pmf (`bracket.ts` 311-333) | pooled over 2023 to 2026 | later knowledge (narrow: 2 or 4 alliance parent only) |
| Pooled lock pools, award ceiling (`pointPool.ts`) | all-season maxima incl. shown season | mixed: only moves Locked guarantees |
| Which events each team has a row for | current rows; unplayed registrations dropped | later knowledge (minor) |
| Reserved Impact slots "never happening" | reads current state by design | mixed |
| Baseline RP before P (`actualRedRp`) | facts per match | known then |
| Known elim/award points for stages final at P | facts | known then (subject to the timeline row above) |
| Award profiles (prior judged awards, rookie) | seasons strictly before | known then |
| Award base rates, ordering tables | fit on seasons before the shown one | known then |
| Point formulas, draft rules, `allianceWinProbability` | constants, nothing fitted | known then |
| `dcmpSlots`, `cmpSlots` | TBA counts at last ingest | known then (not verified TBA never revises) |
| Champ cutoff tuning, DCMP estimate history | seasons strictly before | known then |
| `rookieBonus`, `adjustments`, prequalified lists | preseason facts | known then |

Answers the audit confirmed: the browser runs 1000 draws per event (`SIMULATION_DRAWS`); the
rank draw uses the outcome decomposition when a row carries it; a rewind fetches every
district-tier event whose current state reads started.

Not fixable from the corpus: registration lists as they stood at P (TBA keeps no history).
