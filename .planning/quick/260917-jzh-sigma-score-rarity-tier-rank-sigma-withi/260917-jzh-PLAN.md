---
quick_id: 260917-jzh
type: quick
autonomous: true
files_modified:
  - packages/harness/sigmaMetric.ts
  - packages/harness/sigmaMetric.test.ts
  - packages/harness/publish.ts
  - packages/core/algorithms/spr.ts
  - packages/spr/softCredit.test.ts
  - experiments/260917-jzh/measureTiers.ts
estimate:
  tokens: 90000
  raw_tokens: 45000
  tasks: 3
  confidence: low
must_haves:
  truths:
    - "A team's Sigma rarity tier is its Sigma's mid-rank percentile among teams of similar rating, inverted, so tier shares are roughly 50/25/20/5 at EVERY rating level (R-1)."
    - "The rating axis is the last-official-match Total, the same number the Teams page shows, with the season-final Total as the fallback for a team that played no official match (R-2)."
    - "No team loses a Sigma entry it has today, and no entry gains or loses a key: the shape stays exactly {value, percentile} (R-1)."
    - "The published Sigma VALUE is unchanged by this task. Only the percentile, and therefore the tier, moves."
    - "The top 92 and bottom 92 teams by rating hit the same rough tier shares as the interior, measured on the live 2026 pool, not just asserted (R-3)."
    - "A steep monotone Sigma trend at the top of the rating axis no longer forces the top teams to Common (R-3)."
    - "SPR publishes under a new version; no spr@4.0.0+baseline artifact is overwritten in place (R-6, ALGO-06)."
  artifacts:
    - "packages/harness/sigmaMetric.ts exports sigmaMetricByTeam, sigmaWindowRankByTeam, sigmaWindowIndices and SIGMA_WINDOW_MIN_HALF_WIDTH, and its file header documents the scheme, the axis pairing and the edge rule with the measured reasons."
    - "packages/harness/sigmaMetric.test.ts carries a per-decile tier-share uniformity test and a steep-top-trend edge test, each asserting the CONTRAST against a labelled reference implementation of the old difference-residual scheme."
    - "experiments/260917-jzh/measureTiers.ts runs the shipped sigmaMetricByTeam over the live 2026 teams artifact and prints per-decile, top-92 and bottom-92 tier shares."
    - "packages/core/algorithms/spr.ts declares SPR_VERSION = \"5.0.0+baseline\" with a new header paragraph naming this change."
  key_links:
    - "publish.ts's officialMetricsByTeam -> sigmaMetricByTeam's rating axis -> the window a team is ranked inside -> the tier the Teams page draws."
    - "sigmaWindowRankByTeam's raw percentile -> goodnessPercentile(metricDirection(SIGMA_METRIC_KEY)) -> publishedTierForPercentile's 50/75/95 cuts. Direction inversion stays in exactly one place."
    - "SPR_VERSION -> every published artifact key, the algorithms manifest, the D1 seed rows, and the equality pin in packages/spr/softCredit.test.ts."
---

# 260917-jzh: Sigma rarity tier ranks Sigma inside its rating window

## Objective

The Sigma rarity tier answers the wrong question today. It ranks the DIFFERENCE between a team's
Sigma and the median Sigma of its rating-rank neighbours. That normalizes the LEVEL of Sigma but
not its SPREAD, and Sigma's spread grows with rating, so a strong team's residual is drawn from a
wider distribution and lands in the tails far more often. Replace the difference with the team's
mid-rank percentile of Sigma WITHIN its own rating window, fix the rating axis to the Total the
site actually displays, and stop the clamped top window from forcing the strongest teams to Common.

**Purpose:** the tier says "unusually consistent for a robot of this caliber" at every caliber,
including the very top, which is the most looked-at row on the site.

**Output:** a rewritten `sigmaMetric.ts`, a uniformity test and an edge test that encode the defect
rather than only the fix, a live-data measurement, and spr@5.0.0+baseline ready for the
orchestrator to republish.

## Ground rules

- **Main checkout, no worktree, and ANOTHER SESSION is committing here concurrently** (quick task
  260917-jaf, plus an untracked `.planning/quick/260917-01e-*` directory). Before editing any file
  run `git status --porcelain -- <path>` and confirm it is clean of foreign edits. Commit with
  explicit `-- <paths>`. **Never `git add -A`.** Never touch a file outside `files_modified` plus
  this plan's own directory.
- **No network. No deploy, no push, no publish, no `pnpm ingest`.** Every step that needs the
  network is in `## Orchestrator steps` at the bottom and belongs to the main context.
- **Run tests with `npx vitest run <path>` from the repo root and judge by the printed OUTPUT, not
  the exit code.** `timeout ... pnpm <cmd>` swallows output and exits 0. No web files change here,
  so the root `tsc --noEmit` plus the harness/core typecheck is enough; do not skip it.
- **Never read `.env`** (see CLAUDE.md "Secrets handling"). Nothing in this task needs it.
- **No new dependencies.** Reuse `percentileRanks`, `goodnessPercentile`, `metricDirection` and
  `publishedTierForPercentile` rather than re-deriving a percentile or a tier cut anywhere.
- Match the surrounding comment density and idiom. Comments state the RULE and the MEASURED reason,
  briefly. Zero hyphen or dash characters in any user-facing copy (source comments may use them as
  they already do).
- Commit subjects: `feat(260917-jzh): ...`, `test(260917-jzh): ...`, `docs(260917-jzh): ...`.
  Trailer on every commit: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## Measured facts (do NOT re-measure; these are the premise)

Measured 2026-09-17 against live `data.sigmascout.org/v1/teams/2026/spr@4.0.0+baseline.json`,
n=3699 teams with both Total and Sigma, bucketed into deciles by published Total.

| Finding | Number |
|---|---|
| Published Legendary share, decile 1 to 10 | 1.9 / 1.9 / 1.1 / 1.4 / 3.0 / 5.7 / 11.4 / 10.8 / 8.4 / 5.4 percent |
| Published Common share, top decile | 76.5 percent (should be 50) |
| Clean recompute of today's scheme, Legendary share | 1.1 percent bottom decile rising to 20.8 percent top decile |
| Target `localRank` scheme, per decile | about 50 / 25 / 20 / 5 in every decile |
| Top 92 teams share ONE clamped window today | 64 of 92 (recompute) to 78 of 92 (published) read Common |
| `localRank` with the clamped window still leaves | 64 of 92 Common. frc254 (Total 400, no offseason play) reads Common |
| Rating-axis mismatch | the call site passes season-final `metricsByTeam`; the Teams page shows the last-official-match Total. 32 of 62 sampled top-decile teams played offseason, median final/official Total ratio 0.72 |

The live Worker does not re-derive the Sigma tier (`touchedTeamsRowMetrics` in
`apps/worker/src/scheduled.ts` carries the prior Sigma entry forward unchanged), so **no Worker
source change is in scope.** If the executor finds otherwise, stop and report rather than editing
the Worker.

## Locked design (the executor implements this as written)

### D-1 Scheme: within-window detrended mid-rank (R-1)

Each eligible team's raw percentile is the mid-rank percentile of its own DETRENDED Sigma among the
detrended Sigmas of the teams in its rating window, computed with `percentileRanks` (the same
`(countStrictlyBelow + 0.5 * countEqual) / n * 100` convention, the same 1-decimal rounding) and
then inverted once through `goodnessPercentile(raw, metricDirection(metricKey))`. The entry shape
stays exactly `{value, percentile}` so every consumer is untouched.

Detrend = subtract an ordinary least squares line of Sigma on rating fitted over that one window:

```
xbar = mean(rating in window); ybar = mean(sigma in window)
sxx  = sum((x - xbar)^2);      sxy  = sum((x - xbar) * (y - ybar))
slope = sxx === 0 ? 0 : sxy / sxx
residual_j = y_j - (ybar + slope * (x_j - xbar))
```

`sxx === 0` (every rating in the window identical) means slope 0, which ranks the raw Sigmas. Never
divide by it.

Ranking the residuals rather than publishing the fitted value is what makes the fit safe: a rank is
invariant to any shift common to the whole window, so a single wild outlier moves the intercept
without moving anybody's rank, and its effect on the slope over a window of dozens of teams is
small. The outlier's OWN rank moves, which is correct.

### D-2 Rating axis: official Total, season-final fallback (R-2)

`sigmaMetricByTeam` takes TWO metric records and the axis is
`officialMetricsByTeam[team][TOTAL_METRIC_KEY].value ?? seasonFinalMetricsByTeam[team][TOTAL_METRIC_KEY].value`.

- **Why official first:** it is the number the Teams page prints beside the tier. Ranking a team
  against neighbours chosen by a Total nobody can see is the bug named in the table above.
- **Why a fallback rather than exclusion:** a team with no official match has no official Total and
  would lose its Sigma entry entirely, which is a published regression beyond the tier scheme. The
  team-season artifact already makes exactly this substitution for exactly this population, and
  documents it: `seasonStatsMetricsForTeam` in `publish.ts` ranks an offseason-only team's
  season-final values against the official pool. Reuse that precedent, do not invent a second rule.
- **Pairing asymmetry, recorded not hidden:** the published Sigma VALUE stays season-final
  (`layerForAlgo.sigmaScoreByTeam()`), so an offseason-playing team's Sigma reflects matches its
  axis Total does not. The file header must say so in one sentence and name the follow-up: an
  official-scoped Sigma would need a last-official Sigma snapshot taken during the layer walk.
  **Do not build that here.** If the executor finds the asymmetry produces a visibly worse result
  than today (for instance the offseason-heavy top decile is the only block that misses its target
  shares), report that number in the SUMMARY as the argument for the follow-up. Do not expand scope.

### D-3 Edge rule: symmetric shrinking window, detrend handles the last few (R-3)

Window half-width for the team at sorted index `i` of `n`:

```
halfWidth = min(halfWindow, i, n - 1 - i)          // halfWindow = floor(windowSize / 2), windowSize = min(n, max(25, round(n / 20)))
```

A symmetric window means a linear trend cancels around the team, which is the whole reason the
clamped window was biased: 92 teams sharing one window are ranked against a trend, not against each
other.

Below the floor `SIGMA_WINDOW_MIN_HALF_WIDTH = 5` a symmetric window is impossible, so take the
floor-sized window (`min(n, 2 * 5 + 1)` = 11 teams) and clip it inward, one-sidedly. **The chosen
answer for those teams is the detrend** (option B of the two offered), applied uniformly to EVERY
window rather than only to clipped ones, so there is one formula and no discontinuity at the
boundary. In a one-sided window of 11 the detrend removes the trend that would otherwise put the
single highest-rated team at the worst rank; that is what lets frc254 reach a tier other than
Common.

The floor of 5 is arithmetic, not a second scheme: a window of 11 is the smallest whose best member
can clear the Legendary cut (`0.5 / 11 * 100 = 4.5`, inverted to 95.5, above 95). A window of 9
tops out at 94.4 and could never publish Legendary. Export the constant and pin it with its reason.

**Residual artifact, to be stated in the header and measured, not glossed:** the top 5 and bottom 5
teams by rating still sit in a window that is not centred on them. Detrending removes the trend bias
but not the asymmetry of which neighbours they are compared against. That is 10 of about 3,699 teams
against today's 184.

### D-4 Version: SPR_VERSION 4.0.0 -> 5.0.0+baseline (R-6)

Published tiers change, so under ALGO-06 and D-13 this ships under a new version and never
overwrites `spr@4.0.0+baseline` in place. MAJOR, following all four prior bumps in that header's own
precedent: one artifact key may not stand for two structurally different outputs. `paramSetName`
stays `baseline` (no tuned parameter file is involved). `predict()` is untouched, so the header
paragraph must say explicitly that this is a published-display change and NOT an accuracy claim.

## Context

@.claude/CLAUDE.md
@packages/harness/sigmaMetric.ts
@packages/harness/sigmaMetric.test.ts
@packages/harness/metricDirection.ts
@packages/harness/percentiles.ts

<tasks>

<task type="tracer">
  <name>T1: within-window detrended rank, end to end (sigmaMetric.ts -> publish.ts call site)</name>
  <files>packages/harness/sigmaMetric.ts, packages/harness/sigmaMetric.test.ts, packages/harness/publish.ts</files>
  <read_first>packages/harness/sigmaMetric.ts (whole file), packages/harness/percentiles.ts (`percentileRanks`, lines 63-100), packages/harness/metricDirection.ts (`metricDirection`, `goodnessPercentile`), packages/harness/publish.ts lines 236-270 (`lastOfficialMetricsByTeam`, `seasonStatsMetricsForTeam`) and lines 1986-2090 (the one call site)</read_first>
  <action>
Rewrite `packages/harness/sigmaMetric.ts` to D-1, D-2 and D-3.

Exports, all four:

- `SIGMA_WINDOW_MIN_HALF_WIDTH = 5`, with the arithmetic reason from D-3 in its doc comment.
- `sigmaWindowIndices(n, i, halfWindow)` returning `{ start, end }` with `end` exclusive, implementing
  D-3's half-width and the inward clip. Exported so the edge rule is directly testable without a pool.
- `sigmaWindowRankByTeam(valueByTeam, ratingByTeam, teamKeys)` returning `Map<string, number>` of
  RAW, direction-unaware within-window mid-rank percentiles. This replaces `expectedSigmaByTeam`,
  which is removed along with the local `median` helper it existed to serve.
- `sigmaMetricByTeam(params)` with the new parameter set:
  `{ valueByTeam, officialMetricsByTeam, seasonFinalMetricsByTeam, teamKeys, metricKey }`.
  The `SigmaMetricEntry` interface and its `{value, percentile}` shape are unchanged.

`sigmaWindowRankByTeam` internals:

1. `eligible` = the `teamKeys` present in BOTH maps, preserving today's eligibility rule exactly.
2. Sort by rating ascending with a `teamKey` `localeCompare` tie break. The tie break is required,
   not cosmetic: window membership at equal ratings decides percentiles, and a publish run must be
   reproducible byte for byte.
3. `windowSize = min(n, max(25, round(n / 20)))` and `halfWindow = floor(windowSize / 2)`, both kept
   from today so the interior window width does not change.
4. Per team, take the window from `sigmaWindowIndices`, fit and subtract the OLS line exactly as
   written in D-1, call `percentileRanks` on the window's residual array, and read off the entry at
   the team's own offset within the window.

State the cost in a comment: one sort of the window's residuals per team, about `n * w log w`, which
is roughly 5 million comparisons at the real 3,699 by 185 and is paid once per (algorithm, season).
Do not micro optimize it into a shared sorted structure; clarity and exact reuse of `percentileRanks`
matter more here.

`sigmaMetricByTeam` internals: build the axis per D-2 (official value, else season-final value, else
no entry), call `sigmaWindowRankByTeam`, then invert once with
`goodnessPercentile(raw, metricDirection(metricKey))`. Keep the existing strict-accessor comment
about why an unknown metric key crashes. Round nothing: `buildTeamsArtifact` and
`buildTeamSeasonArtifact` still own the rounding boundary.

Rewrite the file header. It must carry, briefly: the scheme in one sentence; that the difference
residual was replaced because it normalized level and not spread, with the measured numbers
(published Legendary 1.9 percent in the bottom decile against 11.4 in decile 7, top decile 76.5
percent Common; a clean recompute of that scheme runs 1.1 to 20.8 percent Legendary across the
deciles); the axis rule and the one-sentence pairing asymmetry plus the named follow-up from D-2;
and the edge rule with its measured reason (the clamped window had the top 92 teams sharing one
window, 64 to 78 of them reading Common) and its stated residual artifact (the top and bottom 5).

Then update the single call site in `publish.ts` (near line 2029) to pass
`officialMetricsByTeam: officialMetricsByTeam` and `seasonFinalMetricsByTeam: metricsByTeam`.

Four comments in `publish.ts` become false and must be corrected in the same commit, not left to
rot: line 1344 (the shared-object note), lines 1992-1993 ("the rating axis for `sigmaMetricByTeam`"),
lines 2025-2028 ("The rating axis is season-final `metricsByTeam`, matching the season-final Sigma
Scores so both sides of the residual cover the same window"), and lines 2076-2077 ("It is
season-final, unlike the official-scoped values beside it", which is now true of the value only and
not of the axis).

Finally, adapt the EXISTING tests in `sigmaMetric.test.ts` to the new signature and the new exports,
with no loss of coverage:

- The headline test, the two eligibility tests, the pool-scoping test and the entry-shape test all
  keep their assertions. Feed `officialMetricsByTeam: toMetricsByTeam(ratingByTeam)` and
  `seasonFinalMetricsByTeam: {}` so they exercise the primary axis.
- Add one eligibility test for D-2's fallback: a team absent from the official record but present in
  the season-final record still receives an entry, and a team absent from both does not.
- The first `expectedSigmaByTeam` test goes away with the export; its intent ("strong robots are not
  automatically inconsistent") is carried by T2's uniformity test.
- The outlier test is rewritten against the new scheme: with one team's figure set to 10x its
  neighbours' trend, a neighbour's percentile moves by less than a stated tolerance AND its tier
  (via `publishedTierForPercentile`) is unchanged. Measure the real shift first, then pin the
  tolerance with headroom and record the measured number in a comment.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/sigmaMetric.test.ts packages/harness/publish.test.ts packages/harness/percentiles.test.ts 2>&1 | tail -30</automated>
    <automated>npx tsc --noEmit 2>&1 | tail -20</automated>
  </verify>
  <done>
All three test files pass with the counts printed. `tsc --noEmit` is clean.
`grep -c "sigmaWindowRankByTeam\|sigmaWindowIndices\|SIGMA_WINDOW_MIN_HALF_WIDTH" packages/harness/sigmaMetric.ts`
is at least 6. `grep -n "officialMetricsByTeam" packages/harness/publish.ts` shows the new argument
at the `sigmaMetricByTeam` call. One commit, staged by explicit path.
  </done>
</task>

<task type="auto" tdd="true">
  <name>T2: uniformity and edge tests, then the live-pool measurement</name>
  <files>packages/harness/sigmaMetric.test.ts, experiments/260917-jzh/measureTiers.ts</files>
  <read_first>packages/harness/pageArtifacts.ts line 241 (`publishedTierForPercentile`) and lines 1040-1080 (`encodeTeamMetricEntry` and its exact inverse `decodeTeamMetricEntry`, which is what the measurement should use to decode the artifact), .planning/quick/260917-jzh-sigma-score-rarity-tier-rank-sigma-withi/260917-jzh-measure-tiers.cjs (the orchestrator's script: its decile loop is the starting point)</read_first>
  <precondition>`experiments/260917-jzh/teams2026.json` exists and is the live `v1/teams/2026/spr@4.0.0+baseline.json` body. The orchestrator fetches it (see Orchestrator step 0); this task has no network and must halt with that message if the file is absent.</precondition>
  <behavior>
Write both tests first, watch them fail against T1's code only where they should, then finish.

Both tests assert a CONTRAST against a small, clearly labelled reference implementation of the OLD
difference-residual scheme living in the test file (about 10 lines: the clamped window, the window
median, `sigma - median`, `percentileRanks`, invert). That reference is what makes these permanent
regression guards instead of one-shot checks: they encode the defect, so a future change that
reintroduces it fails here. Label it unmistakably as the superseded scheme kept only as the
contrast, so nobody mistakes it for live code.

Tier shares are derived through `publishedTierForPercentile`, never from hardcoded 50/75/95 cuts.
Common is the tier that helper returns `undefined` for.

**Test 1, per-decile uniformity on a heteroscedastic pool.** Build a pool of n=2000 where
`sigma = base + slope * rating + noise * (1 + rating / ratingMax)` so the noise SPREAD grows with
rating, which is the real data's shape and the exact property the difference residual fails on. Use
a deterministic seeded generator (a small named LCG in the helper), never `Math.random`. Bucket by
rating into 10 deciles of 200 and compute each tier's share per decile. Assert:

- New scheme: every decile's Common share is within [44, 56] and every decile's Legendary share is
  within [2, 9].
- Old reference scheme on the SAME pool: its Legendary share in the top decile is at least 3x its
  Legendary share in the bottom decile. That is the defect, stated as a number.

Measure the real values first, then pin the tolerances with the measured numbers recorded in a
comment. If the new scheme cannot meet the band on this pool, STOP and report the measured shares
rather than widening the band to fit.

**Test 2, steep monotone trend at the top.** Build a pool where Sigma rises steeply and monotonically
with rating across the whole range, plus small deterministic noise so ranks are not degenerately
tied. Take the top `halfWindow` teams as the block. Assert:

- Old reference scheme: at least 90 percent of that block reads Common. That is the clamped-window
  bug.
- New scheme: at most 60 percent of that block reads Common, and at least one team in it reaches
  Legendary (proving the floor of 11 keeps that cut reachable).

**Test 3, the window rule directly.** Equality pins on `sigmaWindowIndices` and the constant:
`SIGMA_WINDOW_MIN_HALF_WIDTH` is exactly 5; an interior index returns a window symmetric about `i`;
`i = n - 1` returns a window of exactly `min(n, 11)` ending at `n`; `i = 0` returns a window of
exactly `min(n, 11)` starting at 0. Pin the values, do not iterate a list of indices and assert a
property for each. A test that iterates a hardcoded list silently skips the case somebody adds later.
  </behavior>
  <action>
Add the three tests above to `packages/harness/sigmaMetric.test.ts` and update its file header to
describe the new scheme (it currently points at "the median-window rationale").

Then write `experiments/260917-jzh/measureTiers.ts` (the `experiments/` tree is gitignored and is
where scratch measurement scripts for quick tasks belong, so this file is NEVER committed). It must
import and call the SHIPPED `sigmaMetricByTeam` rather than reimplementing the scheme, because the
point of the measurement is to prove the code that will publish produces the target shares:

1. Read `experiments/260917-jzh/teams2026.json` and decode the compact teams artifact with
   `decodeTeamMetricEntry` itself (`pageArtifacts.ts`, the exact inverse of the encoder) rather than
   indexing the positional arrays by hand, then keep every team that has both a Total and a Sigma.
2. Build `valueByTeam` from the published Sigma value and `officialMetricsByTeam` from the published
   Total. The published Teams row Total IS the last-official-match Total, so this feeds the real
   function the exact pairing D-2 specifies. Pass `seasonFinalMetricsByTeam: {}`; the live artifact
   carries no season-final Total, so the fallback is covered by unit test only, and the script must
   print how many teams it dropped for a missing Total so that population is visible rather than
   silent. Note in a comment that published values are rounded to display precision, so the
   measurement runs on rounded inputs.
3. Map each returned percentile through `publishedTierForPercentile` and print, as a table: the four
   tier shares per rating decile, then the same four shares for the top 92 and the bottom 92 teams,
   then the published tier column's own shares beside them for comparison, then the individual tiers
   of the top 5 teams by Total (the stated residual artifact from D-3), naming frc254's row.
4. Run it: `npx tsx experiments/260917-jzh/measureTiers.ts`.

**Stop condition.** If the top-92 block or the bottom-92 block misses Common in [38, 62] or
Legendary in [1, 11], or any decile misses Common in [44, 56], do NOT proceed to T3. Stop, and
report the full printed table plus which block missed. A tier scheme that is only uniform in the
interior is the bug this task exists to fix, and the republish downstream is a human decision that
needs that number.
  </action>
  <verify>
    <automated>npx vitest run packages/harness/sigmaMetric.test.ts 2>&1 | tail -30</automated>
    <automated>npx tsx experiments/260917-jzh/measureTiers.ts 2>&1 | tail -40</automated>
  </verify>
  <done>
Every test in `sigmaMetric.test.ts` passes with the count printed. The measurement prints per-decile,
top-92 and bottom-92 tables, and each block is inside the stop-condition band. The full table is
captured verbatim for the SUMMARY. One commit for the test file, staged by explicit path;
`experiments/` is not committed and must not appear in `git status` as staged.
  </done>
</task>

<task type="auto">
  <name>T3: spr@5.0.0+baseline, every pin, and the copy check</name>
  <files>packages/core/algorithms/spr.ts, packages/spr/softCredit.test.ts</files>
  <read_first>packages/core/algorithms/spr.ts lines 196-250 (the version header and its four prior bump paragraphs), packages/spr/softCredit.test.ts lines 95-110 (the equality pin and its comment)</read_first>
  <action>
Bump `SPR_VERSION` to `"5.0.0+baseline"` per D-4 and add a fifth paragraph to that header in the
voice of the existing four. It must say: what changed (the published Sigma rarity tier is now the
within-window detrended rank of Sigma on the last-official-match Total axis, replacing the
difference against a rating-neighbour median); why MAJOR (every SPR teams and team-season artifact's
Sigma tier moves, and one artifact key may not stand for two structurally different outputs); the
measured reason in one line (top decile 76.5 percent Common against a target 50, Legendary 1.9
percent in the bottom decile against 11.4 in decile 7); and, explicitly, that `predict()`,
`pRedWin`, `variance` and the match band are all untouched, so this is a published-display
correction and NOT an accuracy claim. Name this quick task id.

Then find and update every equality pin that names the version:

1. `packages/spr/softCredit.test.ts:103` — update the pin to `"5.0.0+baseline"` and extend its
   comment (lines 101-102) with this bump's reason, matching how it already records the 4.0.0 one.
2. `grep -rn "4\.0\.0+baseline" --include=*.ts --include=*.tsx --include=*.toml . | grep -v node_modules | grep -v __fixtures__`
   and judge each remaining site individually. Expect to find: `packages/harness/publish.test.ts`
   (six version-agnostic fixture strings passed to artifact builders, four of them `opr`),
   `scripts/localPricingFixture.test.ts` (four sites, one of which feeds a refusal check that
   compares against `SPR_VERSION`), `scripts/priceFrozenEventRow.test.ts:374`, and
   `apps/web/src/components/ribbon/AlgorithmSelect.tsx:25` (an illustrative doc comment; the ribbon
   label itself is manifest-derived, so leave the label alone but the example may be refreshed).
   A literal that is merely a fixture stays; a literal that must EQUAL `SPR_VERSION` moves. Prove
   the judgement by running each affected test file and reading its output.
3. `grep -rn "SPR 4\.0\|spr@4\|spr 4\.0" --include=*.ts --include=*.tsx apps/web packages scripts | grep -v node_modules`
   to confirm no UI or e2e spec pins the old label. It came back empty at plan time; confirm at HEAD.
4. Leave historical records alone: `docs/models/rp-bonus-gap-attribution.md`,
   `reports/republish-*.md` and prior SUMMARYs are dated evidence and must keep their numbers.
   `docs/publish-budget.md` is rewritten by the orchestrator's `--write-budget` run, not by hand.

**Methodology copy check (R-5).** Run
`grep -rn -i -E "similar rating|for its rating|of its caliber|comparably rated|rarity|tier" apps/web/src/components/methodology/*Content.ts`
and `grep -rn -i "Sigma" apps/web/src/components/methodology/sprContent.ts`. At plan time no
published copy describes how the Sigma tier is derived (`sprContent.ts` describes Sigma itself and
the match band, neither of which changes), so the expected outcome is NO edit. Record the grep
result in the SUMMARY either way. If a hit does describe the old scheme, rewrite only that sentence
in Jacob's voice: flat third person, Statbotics tone, no how or why sentences, and ZERO hyphen or
dash characters.

Finish with the full gate: the whole suite from the repo ROOT (not from `apps/web`, which sees only
a fraction of the files), plus both typechecks.
  </action>
  <verify>
    <automated>npx vitest run 2>&1 | tail -25</automated>
    <automated>npx tsc --noEmit 2>&1 | tail -10</automated>
    <automated>grep -c "5\.0\.0+baseline" packages/core/algorithms/spr.ts packages/spr/softCredit.test.ts</automated>
  </verify>
  <done>
`SPR_VERSION` reads `"5.0.0+baseline"` with its fifth header paragraph. Every pin that must equal it
does. The full root suite passes with its count printed (the prior baseline was about 5,431 tests;
report the new count). Both typechecks clean. The methodology grep result is recorded. Commits are
staged by explicit path only.
  </done>
</task>

</tasks>

## Verification

1. `npx vitest run` from the repo ROOT passes, count reported. Root, not `apps/web`: an 8-day red CI
   once hid in that gap.
2. `npx tsc --noEmit` clean.
3. The live-pool measurement table is inside T2's stop-condition band on the interior deciles AND on
   both 92-team edge blocks.
4. `git log --oneline` shows only `260917-jzh` commits from this task, and `git status` shows no
   foreign file staged. The concurrent session's files are untouched.
5. `experiments/` is not committed.

## Success criteria

- Sigma tier shares are roughly 50/25/20/5 at every rating level, edges included, measured on live
  2026 data through the shipped function.
- The published Sigma value is unchanged; only the percentile moves.
- No team loses an entry, and the entry shape is still exactly `{value, percentile}`.
- spr@5.0.0+baseline is declared, pinned, and ready to publish. Nothing is overwritten in place.

## Orchestrator steps (main context, NOT the executor)

Executor subagents' sandbox denies all network Bash, so every step here belongs to the main context
and runs only after Jacob confirms.

**Step 0 runs BEFORE the executor is spawned** (T2's precondition depends on it):

```
mkdir -p experiments/260917-jzh
curl -fsSL https://data.sigmascout.org/v1/teams/2026/spr@4.0.0+baseline.json \
  -o experiments/260917-jzh/teams2026.json
```

After the executor lands and Jacob approves the measured table:

1. **Optional ingest.** `pnpm ingest --year 2026` if fresh matches are wanted in the republish. Not
   required by this change.
2. **Publish, from a clean tree at the verified SHA.** `pnpm publish:seasons` already carries
   `--seasons 2016-2020,2022-2026 --include-offseason --presim-from-season 2026 --write-budget`.
   This is a long network run: `Bash(run_in_background)` has killed one silently at about 6.5
   minutes with exit 127. Launch it with PowerShell `Start-Process`, keep a PID and a log file, and
   poll the log. Expect roughly 20 to 30 minutes and about 109k objects.
3. **Commit the budget block.** `--write-budget` rewrites the fenced block in
   `docs/publish-budget.md` and enforces the ceilings before upload; commit that doc after the run
   and confirm the `payloadBudget` / `publishBudget` tests pass.
4. **Content check against `data.sigmascout.org`.** The algorithms manifest names spr 5.0.0. Pull
   `v1/teams/2026/spr@5.0.0+baseline.json` and re-run the executor's measurement script against it,
   confirming the live deciles and both 92-team blocks match what was measured offline. Spot-check
   frc254's Sigma tier specifically.
5. **D1 seed. SEED FIRST, DEPLOY SECOND.** One `--file` invocation per algorithm; `--file` needs
   `.env`'s token, `--command` needs its absence. Watch the 100k row-write daily cap (about 66k rows
   for three algorithms, so one pass is fine, four are not).
6. **Worker.** No Worker source changed, and the Worker resolves the algorithm version from the
   published manifest via `liveWindows.ts` (KV primary, R2 fallback), so **no redeploy is required.**
   Confirm one scheduled tick returns `ok` via `wrangler tail`, stop the tail by PID. If a deploy
   does turn out to be needed, `pnpm --filter worker deploy` hits pnpm's own builtin and deploys
   nothing: use `npx wrangler deploy` on a clean tree.
7. **`pnpm verify:subset`.** Expect generation uniformity 1 and 0 failures.
8. **Old-generation cleanup, only with Jacob's explicit go-ahead.** `pnpm cleanup:r2-generations
   --execute` to remove `spr@4.0.0+baseline` plus any stale spr presim sidecars. List-driven, never
   sampled: the sampled census has lied four times.
9. **Push.** Jacob pushes. Check `git log origin/main..main` first, because a push here deploys other
   sessions' commits too.
10. **e2e and asset check after any deploy.** `npx playwright test` against sigmascout.org from the
    main context (the specs are live-only and do not run in CI), plus `pnpm check:deployed-assets`
    if Pages redeploys, because a deploy race has cached `index.html` under an asset URL before.

## Output

Write `.planning/quick/260917-jzh-sigma-score-rarity-tier-rank-sigma-withi/260917-jzh-SUMMARY.md`
when done. Note: `Write` is blocked for subagents on SUMMARY files. The executor returns the SUMMARY
text in its final message and the orchestrator writes it. Do not route around the block with a
heredoc: long markdown prose breaks Git Bash heredocs on this machine.

The SUMMARY must carry the full measurement table verbatim, the tolerance numbers actually measured
for each pinned test, the methodology-copy grep result, and the list of version pins moved against
those deliberately left as historical record.
