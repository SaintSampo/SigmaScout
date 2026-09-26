---
quick_id: 260925-uf8
date: 2026-09-25
description: >-
  Playoff and award readability: a playoff headline that advances with the
  bracket, outcome lists instead of histograms for playoffs and awards, never a
  stacked award, the grand total drawer without the duplicate plot, and the
  missing chance lines
status: complete
---

# Playoff and award readability — summary

Jacob, 2026-09-25: "Can we have it update as playoffs go on? top four > finalist >
winner. two awards should not be a predicted possibility ever. dont touch quals or
alliance selection. Im just trying to clean up playoff and awards readability."

All six items ship. The Qualification and Alliance selection cells, their drawers, the
status rule, the lock math, the reservation and the pooled lock are untouched:
`measure:ledger-tenets` reports **4,022 positions, 921,658 team-positions, 130,718
Locked displays, 190,854 Locked out, both tenets 0** — identical to 260925-pl6.

## 1. The playoff headline advances with the bracket

The Playoffs cell used to print `~66% play`, which was never the chance of playing a
playoff match: an alliance out in the first two rounds earns nothing, so the number was
always the chance of finishing in the **top four**. It now says so, and advances:

| the bracket says | bold | small |
|---|---|---|
| before playoffs, or alive short of a top four finish | `top 4 ~66%` | `~13 if top 4` |
| it can no longer finish worse than fourth | `finalist ~40%` | `~20 if finalist` |
| it is in the final | `winner ~55%` | `~30 if winner` |
| the placement is settled | `~7` | `4th place` |

Live on the local preview, against a real 2026 PNW event with its bracket cut off after
sf7: `finalist ~93% / ~30 if finalist`, `top 4 ~99% / ~20 if top 4`, `top 4 ~0%` (no
fabricated conditional amount), `~0 / 7th place`, `~0 / 8th place`.

**`bracket.ts`** gained `routePlayedBracket`, which walks the ONE `BRACKET_SETS`
topology and determines only what the played matches decide, plus `bracketSetIdFor` /
`bracketDecisionsFromPlayedMatches` (TBA's own `compLevel`/`setNumber`/`matchNumber`)
and `allianceBracketMilestones`. The top-four rule is derived from the topology's own
shape and stated in full: the winner of sf7 or sf8 reaches sf11, whose loser drops to
sf13 and finishes third; the winner of sf9 or sf10 reaches sf12, whose loser finishes
fourth.

**Proven on a real event.** `2026orwil`'s fifteen real elimination rows route to a
complete placement permutation and reproduce `district-2026pnw.json`'s own earned
`elim` points for all eight alliances. The rows are committed as a literal (the
fixtures under `data/` are gitignored). The same check over all eight 2026 PNW events
routes 8/8 complete permutations; `2026orwil`, `2026wabon` and `2026wayak` reproduce
every team value exactly (74 values), and the five mismatching alliances at the other
five events are all the backup-robot proration this repo's own `bracket.ts` header
already records. The top-four claim is re-derived by routing 400 random completions of
every prefix rather than taken on trust.

**`ledgerSimulation.ts`** takes `playedElimMatches` as a PARTIAL stage input: a decided
set takes its real result and consumes **no** randomness, every open set is priced as
before, and `playoffMilestones` reports per team how far its alliance has got. That map
is empty when the draft is simulated, because a team sits on a different alliance every
draw. A mis-mapped match raises `InvalidBracketDecisionError` before any draw, so the
protocol renders the event unavailable rather than a table of confident wrong numbers.

**Conditioning is live-position only.** The rewind rail's playoff step is all-or-nothing
by construction (a position at an event's `alliance` step is before its bracket, one at
its `playoffs` step is after it), so only "now" can sit part way through one.
`playedBracketMatchesFor` is the single place a match colour becomes an alliance number;
it tolerates a backup robot and discloses a side it cannot resolve. The played rows join
the run signature, so a match being played re-fires the run — without that the cell
would keep asking about the top four for an alliance that had already won its semifinal.

## 2. Never a stacked award

`foldStackedAwardPoints` / `foldStackedAwardPmf` move the two stacked support bins onto
the highest single award of each stack: **13 onto Rookie All Star's 8, 15 and above onto
Impact's 10**, table first so 13 can never be promoted into an Impact prediction. The
base-rate path draws from the FOLDED pmf, looked up once per team; the ordering path now
takes `singleAwardPoints`, the highest single award of the draw, and
`composeOrderedAwardPoints` went with the sum it computed.

The stacks are not denied, only un-predicted. The price is stated and pinned: at most
**0.022 of a point** of expected award points on any 2026 rate.

Tests: no drawn award pmf carries mass at 13 or 15 (exactly zero, not "close to"); the
folded 10 bin is exactly the raw 10 plus 15 bins; the fold is idempotent, sums to one,
and never returns a value above 10 over every support value and every composed sum.

## 3. Outcome lists instead of histograms

Clicking Playoffs or Awards now lists the **named** outcomes. Both categories are lumpy:
a district playoff pays exactly one of 30, 20, 13, 7 or 0 and a district award one of
10, 8, 5 or 0, so a histogram over a 0-to-30 axis drew four bars and twenty-six gaps and
asked the reader to read a placement off an x position.

One row per outcome, ordered by points descending, chance read as the mass at that exact
point value off the **same** distribution the cell's own figure comes from, so the list
and the headline cannot disagree. A thin proportional mark per row; labels in text ink;
the only colours are shipped custom properties, `--sim-hist-bar` being the very one the
histogram's bars use. The track and its fill share one width source.

Ruled-out rows are omitted: a secured top four drops "Out before the top four", a place
in the final drops third and fourth too, a decided placement leaves one row, and a
veteran's Rookie All Star row is omitted because a veteran cannot win it. A zero-chance
row that is NOT ruled out stays, so the list's length does not move with the draws.

`districtOutcomeUnaccountedMass` is the diagnostic that keeps this honest: it is exactly
zero for every distribution these two categories can produce, so a stacked award that
escaped the fold would show up there rather than silently vanishing from the list.

Qualification, Alliance selection and the event total keep the shipped histogram, byte
for byte.

## 4. The grand total drawer

Clicking the grand total drew its histogram twice — once as the clicked cell and again
as the grand total beside it. It now draws once, beside a per-event contribution list:
one row per district event with its **earned so far** and, for an open event, the
**predicted total** as a median with its likely range. The line and the floor caption
stay. The caption says which of the two numbers an open event contributes, so nobody
adds them.

## 5. The missing chance lines — the root cause

Reproduced locally at `?year=2026&district=2026pnw&tab=road-to-district-champs&at=2026wasam:awards`
against the real `data/fixtures/phase10` artifacts, by running the browser's own pipeline
(timeline → stage → input assembly → the real Worker dispatcher → rows → statuses →
`buildAdvancementChanceRun`) offline.

**The cause is a pending republish, not a bug in the chance feature.** Production's
`v1/district/2026pnw.json` is generation **2026-09-14** and predates phase 10's `state`,
`awardProfile` and `bakedEvents` fields — exactly the window 10-07's own summary flagged.
With no `state` blocks no event reads as started, so a rewind fetches **no** event
artifact; with no `bakedEvents` no sidecar is fetched either. The tab therefore holds no
distribution for any event at that position, **90 of 126 grand totals are `unavailable`**,
and `buildAdvancementChanceRun` refused on the first one — silencing every chance line
under 66 rendered chips.

**The over-broad refusal is narrowed** as asked: an unavailable grand total now excludes
that team and is reported in `excludedTeams`, with two bounds that keep the remaining
number honest. An excluded rival can only INFLATE every other chance, by at most one
slot each, so the run still refuses when the excluded set alone could fill the capacity,
and when nothing open survives the exclusion. The excluded set joins the signature so a
repaired team re-runs the ranking.

Two component tests reproduce the failure first: both go red with the shipped refusal
restored and green with the narrowing (verified by temporarily restoring it).

**Be clear about what this does and does not fix.** 90 excluded against 50 slots still
refuses, which is the correct answer for a hole that big — a 90-team hole is a different
district, not a slightly worse one. **The 2026pnw case at that position needs the
republish.** What the narrowing fixes is the case Jacob named: one team's row refusing
no longer silences a hundred and twenty-five others.

My repro counted 28 In range and 55 Out of range at that position against the 22 and 44
reported from the live site. The artifact is the same generation, so the difference is
most likely the deployed bundle predating 260925-ms7 / pl6 / rpj; it does not bear on
the refusal, which fires identically either way.

## 6. Methodology

Three additions to `/methodology/district-points`, flat third person, no dash
characters, at most three sentences each: the milestone the Playoffs cell asks about and
that a played elimination match is taken as played rather than priced again; that two
awards at one event are never a predicted outcome and what that costs; and the outcome
lists. The 0.022 figure is added to the page's own `REQUIRED_FIGURES` with its source
named, and pinned by a new case in `awardOrderingTables.test.ts` that walks every 2026
rate. The voice gate passes.

## Two defects the screenshot pass found

Both invisible to every test, which is why the pass is required.

1. **Every drawer caption has run off the right edge of the card since 10-07.** They
   live inside a `TableCell`, whose shipped class list carries `whitespace-nowrap` for
   the numeric columns it was written for. A capped, wrapping caption also lets the two
   panes sit on one row instead of stacking. `display: block` was load-bearing too:
   `max-width` does nothing at all on a non-replaced inline element, so the first cap I
   wrote silently did nothing.
2. **The award list was printing the playoff caption**, telling a reader about a bracket
   it does not have. Each list now has its own.

## Screenshots, 1440, local preview against a fixture origin

`C:/Users/Jacob/AppData/Local/Temp/claude/c--Users-Jacob-Documents-GitHub-SigmaScout/04f3ffd4-5db9-4a50-8e61-363d6723b0e6/scratchpad/shots/`

| file | what it shows |
|---|---|
| `playoff-drawer-finalist.png` / `-drawer.png` | the table with `finalist ~93%` in the Playoffs column, and the playoff outcome list with "Out before the top four" correctly omitted |
| `playoff-drawer-top4.png` / `-drawer.png` | `top 4 ~99%` beside `~0 / 7th place` and `~0 / 8th place`, and the five-row list for an alliance with nothing ruled out |
| `award-drawer.png` / `-drawer.png` | Impact 10, One judged award 5, No award 0; Rookie All Star omitted for a veteran; nothing above 10 |
| `grand-total-drawer.png` / `-drawer.png` | one plot, the per-event contribution list, the line and the floor caption |
| `ledger-table.png` | the whole tab at the live position |

Recipe: the real fixtures with `state` blocks and `awardProfile` injected and
`2026orwil`'s bracket cut off after sf7, served by a throwaway localhost origin (verified
by CONTENT, killed by PID), `vite build` with `VITE_ARTIFACT_ORIGIN` pointed at it, `vite
preview` (verified by content, killed by PID), Chromium through Playwright at 1440x1100
at 2x. **Zero page errors and zero console errors** on every shot.

## Verification

- `npx vitest run` from the repo root: **293 files, 6,675 passed, 1 skipped**.
- `npx tsc --noEmit` at the root and for `apps/web`, `apps/worker` and
  `apps/web/tsconfig.e2e.json`: **all four clean**.
- `npx tsx scripts/measureLedgerTenets.ts`: both tenets **0**, totals identical to
  260925-pl6 (4,022 positions, 921,658 team-positions, 130,718 Locked, 190,854 Locked
  out, 26,604 slots held back, 213 pooled-only locks).
- New coverage: 20 bracket tests, 8 ledger-simulation tests, 6 fold tests, 7
  threshold-summary tests, 16 outcome tests, 13 row tests, 9 copy tests, 12 component
  tests, 4 chance tests, 2 import-scanner tests.
- No `±` anywhere in either new list; colours are tokens only; every existing
  `data-testid` kept and four added (`district-ledger-drawer-outcomes`,
  `district-ledger-outcome-row`, `district-ledger-outcome-bar`,
  `district-ledger-drawer-contributions`, `district-ledger-contribution-row`);
  `package.json` untouched; no network beyond localhost, no publish, no deploy; `.env`
  never read.

**One flake, not reproduced.** The first of three full root runs reported one failing
test and did not name it before the summary line; two subsequent full runs were green at
293/293. A concurrent session was writing `apps/worker/test/*` during that run, which is
the likeliest cause.

## A fix outside the task, kept

`packages/harness/browserSafeSchemas.test.ts`'s import scanner matched imports **per
line** and required `from "spec"` on the same line as the keyword, on the stated basis
that "this repo's convention keeps every such statement on one line". That convention is
not enforced and this repo does not follow it: every multi-line import was invisible to
the scan, including a `node:` one. The hole surfaced when `ledgerSimulation.ts`'s
`./bracket.js` import grew a sixth name and the scan's own not-vacuous assertion went
red — which is exactly why that assertion exists. The regex now spans a statement, and
two tests pin it.

## Notes for a deploy

1. **A REPUBLISH IS OWED, and it is what actually lights up 2026pnw.** Production's
   district artifacts predate `state`, `awardProfile` and `bakedEvents`. Until they are
   republished, the Road to District Champs tab renders every category as
   open-and-unavailable at a rewound position and the advancement chance refuses for the
   whole district — which is what Jacob was looking at. Nothing in this task can fix
   that from the browser side.
2. **No artifact shape changed and nothing new is published.** Every number here is
   computed in the visitor's browser from fields already on the wire.
3. **The playoff milestone needs `alliances` and played elimination rows on the event
   artifact**, both of which the current event artifacts already carry.
4. **A live event's Worker run now consumes fewer random draws** once its bracket starts,
   by one per played match. That is by design and pinned by test; it means a seeded
   playoff distribution changes the moment a match is played, which is the point.
5. **The concurrent `260925-uy5` session** was editing `apps/worker/src/scheduled.ts`,
   `artifactMerge.ts` and eight worker test files throughout this task. None of my eight
   commits touches anything under `apps/worker` or `packages/ingest`. The worker
   typecheck was red mid-task on that session's in-flight `algorithmContext` and
   `TickResult` work and was clean again by the final sweep. Check `origin/main..main`
   before pushing: this branch carries two `260925-uy5` commits that are not mine.
