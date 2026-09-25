# Phase 10: District points ledger - Context

**Gathered:** 2026-09-25, from Jacob's sketch 021 session (quick task 260925-16z) and a four-question checkpoint
**Status:** Ready for planning. Every decision below is LOCKED unless marked discretion.

<domain>
## Phase Boundary

Build sketch 021 variant A on the real site: the District Locks tab on `/districts` becomes the
Road to District Champs ledger. In scope: the core simulation math (district points per category,
alliance selection, playoff bracket), the award base-rate tables, the district artifact additions,
the live Worker's district refresh, the tab UI with its Web Worker simulation and slider, tests,
methodology copy, republish and deploy. Out of scope: the Champ Locks tab (unchanged), an
advancement chance number (needs the line's own distribution, a later phase), Impact and Rookie
All Star ordering tables (later), a per-team page for district points.

The sketch and its README are the design contract:
`.planning/sketches/021-district-points-ledger/` (artifact
https://claude.ai/artifact/9yjeRCMN13tD8XbmQBMKzZ, version 5). Sketch 020 is superseded by it.
</domain>

<decisions>
## Implementation Decisions

### Freshness (Jacob, 2026-09-25): live, like the rest of the site
- The live Worker tick fetches TBA `/district/{key}/rankings` for every district with a live
  window and republishes `v1/district/{key}.json` when the rankings changed (ETag conditional
  request like every other TBA poll). One request per live district per tick.
- The district artifact gains, per team per event, the state the page needs to decide grey vs
  blue: qualification matches played and total, whether alliances are picked, whether playoffs
  are done, whether awards are posted. The Worker knows all four at fold time; the offline
  publisher derives them from the corpus.
- The browser polls the district artifact on the same 60 s floor as event artifacts while any
  of the district's events is current (`liveEvent.ts` rules).

### What the page computes where
- **Pipeline (publish time):** per season, the award base-rate tables; per team per unstarted
  event, baked pmfs for the four categories and the event total (about 60 numbers per
  team-event, on the district artifact or a sidecar next to it, planner's call by byte budget);
  for finished events, actual points only.
- **Browser (Web Worker):** every event in progress and every slider move. One joint run:
  the existing rank simulation (`simulateRanks` over the event artifact's remaining matches and
  their RP pmfs) produces a ranking; the top eight are captains; picks are greedy by SPR among
  non-captains; the double elimination bracket is priced from SPR alliance means and variances
  using the same win-probability form the rank simulation uses; each run yields (qual,
  selection, playoff) per team. Histograms are marginals of the same runs. The event total is
  the per-run sum. The grand total is the convolution of the two event totals plus rookie bonus
  and adjustments.
- **Cloudflare Worker:** never simulates. Its only new job is the district rankings refresh
  above.

### Awards (Jacob): base rates by decoration bucket
- A walk-forward table per season: for buckets of prior judged awards (none, one or two, three
  or more) crossed with rookie status, the chance of any award points at a district event and
  the distribution over point values (0, 5, 8, 10, 13, 15+). Measured from the corpus using only
  seasons before the scored season, pinned by a test, stated on the methodology awards page in
  its voice (flat third person, no dash characters, see `feedback_methodology_copy_voice`).
- Impact and Rookie All Star ordering tables are NOT in this phase.
- No award prediction ever feeds the `locks.ts` guarantee. A Locked verdict stays a guarantee.

### Status: Jacob's five definitions (chips, with the definition as tooltip and in a legend row)
- **Prequalified**: prequalified by FIRST. Purple chip.
- **Locked**: mathematically qualified no matter what, on district points or an award
  (`locks.ts`; an Impact winner consumes a slot only when it would not qualify on points).
  Green chip, "Locked · award" when an award is the reason.
- **In range**: if every team earned the median of its own predicted grand total, this team
  would qualify. Outlined chip.
- **Out of range**: under that same median projection, this team would not qualify. Muted
  outlined chip.
- **Locked out**: cannot earn enough district points to qualify (the `locks.ts` elimination
  case). RED chip, Jacob's explicit choice; the data status `eliminated` is never printed.
- Chips double as filters with live counts.

### What a blue cell prints (round four)
- Qualification, event total, grand total: the median in bold, "likely a to b" beneath, where
  likely is the 10th to 90th percentile with continuous edges (sketch 005).
- Alliance selection, playoffs, awards: the chance of any points in bold ("80% picked",
  "66% play", "44% award") and the typical amount when it happens beneath ("~12 if picked", a
  conditional median). Above a 99.5% chance the cell falls back to the median form.
- Never a ± on any of these. The drawer under the team shows the histogram with the exact
  percentiles, beside the grand total histogram with today's line (the 50th team's earned
  points, labelled as a floor).
- A grey cell is a single earned number. Grey and blue never rely on hue alone.

### Table shape (variant A, after rounds two and three)
- Two rows per team, one per district event, in week order. Columns: Team (number, nickname,
  position, earned, median when open), Status, Event (name, week, stage word), Qualification,
  Alliance selection, Playoffs, Awards, Event total, Grand total (spans both rows).
- Rows sorted by the median of each team's predicted grand total; a finished team sorts by its
  actual total. The position number is that order.
- Hairline separators only. Jacob tried heavy rules between team blocks and dropped them.
- Sticky first column, horizontal scroll inside the card at phone width (the shipped table
  pattern with its scroll arbitration).
- Team number search, status filter chips, a stat line (today's line, open cells).
- The tab label is "Road to District Champs". The old District Locks table is removed.

### The slider
- Label "Rewind to". Steps by match across the district's interleaved timeline (sort by
  `sortTime`), with alliance selection, playoffs and awards as stages after each event's last
  qual match. Jump chips for season start, after each week, and now.
- Rewinding into a finished event reopens its later categories (the rank simulation already
  rewinds into played matches because played rows carry `redRpPmf`/`blueRpPmf`), and statuses
  recompute at every position.

### Alliance selection and captains (from the sketch discussion)
- Once quals are done the top eight hold a captain floor of 17 minus their alliance number;
  the cell must read as a near-certain number then, not a chance. Once alliances are announced
  the cell is grey.
- Points, VERIFIED against the corpus 2026-09-25 (research plus a direct check on 2026wabon):
  captain and first pick earn 17 minus the alliance number; the second pick earns the alliance
  number itself (alliance 1's second pick gets 1, alliance 8's gets 8); a fourth robot earns 0.
  The "9 minus alliance number" form in the first draft of this file scored 0 of 969 rows and is
  wrong. Ceilings 22 / 16 / 30 / 15 from `packages/core/districts/pointModel.ts`. Playoff points
  per double elimination exit 0 / 0 / 7 / 13 / 20 / 30 by round, verified in the research.
  Qualification points from the manual's inverse error function formula on rank and field size,
  exact on 20,389 corpus rows.
- The selection model's agreement with actual pick order is measured on `event_alliances` in
  the corpus before it ships and stated on the methodology page.
- Only the 2023+ eight alliance double elimination bracket is simulated; earlier seasons have
  no open categories and need no bracket. An event whose bracket is not eight alliances (the
  corpus has a few) gets a fallback playoff pmf: the corpus's empirical distribution of playoff
  points by alliance number for 2023+, a small published table. Never a fabricated bracket.

### Corrections from research (2026-09-25), binding on the plans
- **The browser prices nothing today.** The embedded state block that priced upcoming matches
  in the browser was deleted 2026-09-23 (quick task 260923-3w6); the sketch README's claim that
  the browser already prices any alliance is stale. The bracket needs a new browser-side
  win-probability function built from the event artifact's per-team published SPR numbers
  (`EventTeamSchema.metrics` total mean and Sigma Score), using the same win/tie/loss spread
  form the rank simulation uses (uncorrected `Σ Sigma²`, never the display band). Its
  accuracy is unmeasured, so a plan must measure it: compute the formula's P(red wins) for every
  played match on a set of published event artifacts and compare with the artifact's own
  `pRedWin` (mean absolute gap and Brier on outcomes); state the gap on the methodology page.
- **`simulateRanks` discards the per-draw ranking.** Add an optional per-draw callback (the
  research names the exact line) so one run can hand its ranking to the selection and bracket
  steps without a second simulation and without changing the existing callers.
- **District liveness for the Worker.** A district is live when any of its member events has a
  live window. The offline publisher extends `v1/manifest/live-windows.json` with each window's
  `districtKey` (null for non-district events); the Worker refreshes every distinct live
  district's rankings each tick with an ETag request and merges them into the artifact it reads
  back from R2, recomputing the `locks.ts` verdicts. It cannot call the offline
  `buildDistrictArtifact` (no corpus in the Worker).
- **The four state facts, sourced.** Qual matches played and total come from the event
  artifact's matches; alliances picked from the event artifact's `alliances`; playoffs done from
  the elimination matches having no upcoming rows and a finals winner; awards posted from a
  Worker fetch of `/event/{key}/awards` once playoffs are done (one ETag request per live event
  per tick, returning at least one award). The award cell stays blue until then.

### Process rules that apply (from memory, binding)
- Deploy the Worker BEFORE the republish. `npx wrangler deploy` from a clean tree; Jacob grants
  the deploy in-message. Publishes, live-origin checks and pushes run from the main context;
  executor subagents have no network.
- Run vitest from the repo root, and check both tsconfigs. After the push, watch `gh run list`.
- Additive artifact fields do not bump `PAGE_ARTIFACT_SCHEMA_VERSION`; changed published numbers
  ship under a new version. Zod schemas are the executable spec of every new field.
- Every colour is a token; no literals in component code. Run the dataviz palette validator
  before any new palette entry (the red Locked out chip is a status colour, not a series).
- Never render a partial variance; never print a ± for a percentile range.
- A `|` in a STATE.md quick-task description breaks the helper; keep pipes out of descriptions.

### Claude's Discretion
- Whether baked pmfs live on the district artifact or a sidecar (decide by measured bytes
  against the page's budget).
- The exact selection model details beyond greedy-by-SPR (a small decline rate is fine if
  measured), the bracket seeding table, and the RNG seeding for determinism.
- Web Worker protocol shape for the district run, and how the district page loads only the
  event artifacts it needs.
- Copy for the drawer and the definitions row, within the methodology voice rules.
</decisions>

<specifics>
## Specific Ideas

- The sketch's HTML is a working reference for the table, the drawer, the slider mechanics and
  the status rule at each position, including the award-slot subtlety that made its counts match
  the artifact (50 locked, 76 locked out at "Now" on 2026pnw).
- `apps/web/src/components/event/RankDistributionTable.tsx` and `rankRows.ts` carry the
  continuous quantile and band drawing to reuse.
- `apps/web/src/workers/simulation.worker.ts` and `useSimulationRun.ts` are the Web Worker
  pattern to extend, not duplicate.
</specifics>

<canonical_refs>
## Canonical References

- `.planning/sketches/021-district-points-ledger/README.md` (design contract, feasibility,
  placement)
- `.claude/skills/sketch-findings-sigmascout/` (palette, uncertainty, chart craft, simulation
  rules)
- `packages/core/districts/{locks,pointModel,qualification}.ts` (the shipped district math)
- `packages/core/algorithms/simulation/rankSimulation.ts`, `packages/harness/preSchedule.ts`
- `apps/web/src/components/methodology/awardsContent.ts` (award findings and voice)
- `docs/worker-operations.md` (Worker deploy and tail procedure)
</canonical_refs>
