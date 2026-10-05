# Quick Task 261004-uyc: Live ingestion rethink - Context

**Gathered:** 2026-10-04
**Status:** Ready for planning

<domain>
## Task Boundary

Jacob watched SVS (`2026vari`, Southern Virginia Showdown, TBA event_type 99 offseason,
2026-10-03, 27 teams, 25 quals, 13 sf, 3 f) live on sigmascout.org and reported:

1. For the whole event: no ranking points, no simulation, no Sigma.
2. No playoff alliances and no playoff matches shown.
3. The banner "This event has no official TBA ranking. Teams below are ordered by SPR's rank
   instead." showed all event. "This should never really be an option."
4. Rank point prediction and display seemed broken.

He also asked for a rethink of live ingestion so it follows the competition phase, and for a
logging system that lets a finished live event be analysed afterwards: when did each piece of
data arrive at TBA, when did SigmaScout see it, how long did the site take to update.

</domain>

<findings>
## Diagnosis (orchestrator, verified against TBA and production 2026-10-04)

TBA had everything for 2026vari. `/event/2026vari/rankings` returns 21 ranked teams with a
Ranking Score sort order (first row 3.43), `/alliances` returns 8 alliances with picks and
playoff status, `/matches` returns 41 played matches all with `score_breakdown` including `rp`,
`energizedAchieved`, `superchargedAchieved`, `traversalAchieved`. Every gap is on our side.

Production artifact `v1/event/2026vari/spr@9.0.0+baseline.json` after the event:

- `standings: { source: "tick-counted", ranked: false }`, no `rpOutcomeRp`, no team `rank`/`rp`.
- `alliances: []`.
- matches: 25 qm, 13 sf, 3 f, all played. So playoff rows DID reach the artifact by the end. Whether
  they arrived late or the web hid them without alliances is unknown (no log to tell). Check what
  `ElimsTab.tsx` and the event route require before showing playoff matches.
- qm rows: `actualRedRp: 0, actualBlueRp: 4`, `actualRedBonusRp: null`, no predicted RP fields, no
  RP pmf. So no simulation inputs.
- team rows: metrics `total`, `phaseAuto`, `phaseTeleop`, `phaseEndgame` only. No Sigma entry.
- Last-Modified 22:55:19Z; TBA's last `post_result_time` was 22:53:51Z.

Root causes found in code:

- **The Worker never fetches `/event/{key}/rankings` or `/event/{key}/alliances`.** See
  `apps/worker/src/artifactMerge.ts` (~line 361) and `apps/worker/src/liveStandings.ts`. Standings
  are counted from match rows instead, and counted standings are only `ranked` when `rpOutcomeRp`
  is present and every qual row has numeric bonus RP. Alliances only ever come from the offline
  publisher (`packages/harness/publish.ts` `selectEventAlliancesForSeason`). A Worker-promoted stub
  event therefore has no alliances and no rank until someone republishes.
- **Offseason (99) is hard-excluded from ranking points.** `packages/core/rankingPoints/constants.ts`
  `EVENT_TYPE_TIERS` has no 99; `isRpEligibleEventType(99)` is false; `scheduled.ts` lines ~1533 and
  ~1586 return early. That removes RP prediction, actual bonus flags, `rpOutcomeRp`, the ranked
  standings, and with them the simulation. This was a deliberate earlier decision ("offseason is
  deliberately excluded from every RP population"). Jacob's report reverses it for display and
  prediction.
- **Live Sigma on the event row is carry-forward only.** `artifactMerge.ts` ~line 370: "Carries the
  prior row's published Sigma entry forward; a live tick computes no season-final Sigma of its own."
  An event no publish has written has no prior entry, so no Sigma all event. The tick already
  computes `sigmaAfterTick` for the per-team artifact.
- **Polling is not phase-aware.** One `/matches` poll plus a roster poll per window. Nothing reacts
  to quals finishing (alliance selection), playoffs starting, or the event ending.
- **Logging is one `console.log` JSON line per tick** (`msg: "tick"`, counts only) plus warn lines.
  Nothing records per-event, per-match arrival times or latency, and nothing is queryable after the
  Workers Logs retention window.

Not a bug in this task: `epa@14.0.0+baseline` 404s for every event because epa 14.0.0 is committed
but not yet published (epa 13.0.0 is live). Another session has `packages/harness/publish.ts` dirty
and `.planning/debug/epa-presim-pricing-slow.md` untracked. Do not touch or stage either.

</findings>

<decisions>
## Implementation Decisions

### Official TBA data first
- The tick fetches TBA's own rankings and alliances for every open live window, conditionally
  (ETag), and writes them into every live algorithm's event artifact. TBA's rank, record and
  ranking score are the published standings whenever TBA has them. Jacob's standing preference is
  the community yardstick: what TBA publishes beats an internally consistent alternative.
- Counted standings stay only as the gap filler for the minutes before TBA's first rankings
  response. The "no official TBA ranking" fallback banner must not show during or after an event
  whose rankings TBA publishes.

### Phase awareness
- The tick derives an event phase from data it already holds (schedule posted, quals in progress,
  quals complete, alliances posted, playoffs in progress, complete) and uses it to decide which
  endpoints to poll. Alliances are polled once quals are complete or any playoff match exists.
  Rankings are polled while quals are in progress and until they stop changing.
- Playoff matches and alliances must show on the event page as soon as TBA has them.

### Offseason ranking points
- Offseason events (99) get RP prediction, actual RP display and the simulation, using the base
  tier rules, whenever the event's breakdowns carry the season's RP fields.
- Whether offseason results TEACH the RP beliefs should mirror what ratings already do for
  offseason play (they fold, and the carry rule discards it before next season). The planner must
  verify the RP belief carry rule really discards offseason learning; if it does not, offseason
  matches are predicted from unchanged RP state and never folded into it.
- Live and offline must agree: the offline publisher must produce the same RP fields for offseason
  events, or a republish will erase what the tick wrote.
- Changed published numbers ship under a new algorithm version (Jacob's standing rule). The plan
  must state which versions bump. The republish, Worker deploy and D1 migration are NOT run by
  executors: they are held for the orchestrator and Jacob.

### Live Sigma
- A live event's team rows carry a Sigma entry from the tick when no published one exists, with the
  tier resolved from `tierCuts` as the team page header already does.

### Ingest log
- A durable, queryable ingest log in D1 (new migration), written by the tick: one row per
  observation worth analysing. At minimum per event per tick that saw a change: which TBA endpoint
  changed, TBA's Last-Modified, our observed-at time, and per newly seen match its TBA
  `actual_time` and `post_result_time` beside our fold time and artifact-write time. Phase
  transitions are logged as rows too.
- A CLI report (`pnpm live:report <eventKey>`) that reads the log and prints a timeline and latency
  summary (median and worst post-to-published delay, per phase, gaps and failures).
- Keep it cheap: no row for an unchanged 304 tick. Retention pruned by the tick or the report tool.

### Claude's Discretion
- Table shape, phase names, module split, and how many plans. `scheduled.ts` is 2,300 lines; new
  logic belongs in new modules beside `liveStandings.ts`, not in that file.

</decisions>

<specifics>
## Specific Ideas

- Fixture for tests: the six TBA responses for 2026vari can be recorded from the live API.
- Worker vitest runs from the repo root, not `apps/worker`. `npx vitest run`, never `timeout pnpm`.
- Typecheck root, web and e2e tsconfigs.
- No hyphen or dash characters in any user-facing copy.
- Load `sketch-findings-sigmascout` before changing any UI.
- Executors have no network. Anything that reads TBA or production is an orchestrator step.

</specifics>
