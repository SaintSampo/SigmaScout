# Publish budget

## What this document is

This is the measured cost of publishing SigmaScout's data and keeping it fresh: how big each
published page is, how much of Cloudflare's free tier one full publish spends, and what it takes
to keep live state correct given publishing runs on one local machine (D-23). Every figure below
names the run that produced it — the exact command, the date, and the artifact count — so a number
here can be checked against a real run, not merely believed (D-23's own requirement). The Payload
budget table's `budgetMaxBytes` column is read directly by
`packages/harness/payloadBudget.test.ts`, via the machine-readable block at the bottom of this
file — there is exactly one source for these numbers, not two files that could quietly drift apart.

## Payload budget (D-05)

Measured from a real full publish of all five seasons (2022-2026) across all three shipped
algorithms (opr, epa, sigma1):

```
pnpm publish:seasons
```
(equivalently `tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026`, invoked
directly to bypass this machine's known `pnpm install`/`better-sqlite3` node-gyp pre-check failure)

**Latest run — 2026-09-04, quick task 260904-586's Teams-list official-play-scoping republish
(`tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --include-offseason`),
generation `4ba99e89-b196-4f88-90c7-3bc1ffae3de9`.** 56,774 page objects plus 2 manifests (56,776
total `PUT`s) — object count IDENTICAL to the run below, confirming this run changed what values
existing rows carry, never which artifacts get built. 2,258,714,595 bytes of page-object payload,
18 min 20 sec wall clock (`08:07:20.010Z`-`08:25:39.576Z`, 2026-09-04), backgrounded from the first
invocation (`run_in_background: true`, never a foreground call and never a retry). Zero concurrent
publish processes: an untruncated command-line-filtered `Get-CimInstance` query returned zero real
`publish.ts` processes both immediately before and immediately after the run (only the query's own
command line self-matched the filter string, excluded by an additional
`-notlike '*Get-CimInstance*'` clause). A pre-publish baseline generation was recorded on one
`teams/{year}` key (`79a0a71a-c2a7-4c00-84c2-2585a0141042`, `computedAt`
`2026-09-04T06:22:35.411Z`) before starting — every post-run read returned the NEW generation
(`4ba99e89-...`), never the baseline, so nothing below is a stale read. Exactly ONE distinct
`generation` value (`4ba99e89-b196-4f88-90c7-3bc1ffae3de9`) was observed across every key
`pnpm verify:subset` sampled (35 entries, 0 failing) — the concurrent-writer detector — and it
equals the run's own summary line.

**Execution note, recorded honestly.** This run's background process was killed partway through
(after replaying season 2025, before season 2026's replay had logged) by an interruption outside
this plan's own logic — not a code defect, not a second invocation, not a retry. Rather than
restarting from scratch or attempting to patch only the missing season (which would have
incorrectly cold-started 2025's carried algorithm state, since `publishSeasons` bridges
season-to-season state only within one call), the SAME already-running process was left alone and
observed directly: process-list and live-artifact-generation checks (`Get-CimInstance`, and reading
`teams/{year}` generations for 2022-2026 directly from the public origin) confirmed it was still
executing and had NOT been killed after all — the interruption affected only this executor's own
tracking of the background task, not the underlying `node`/`tsx` process tree, which ran to genuine
completion on its own. The run's `computedAt`/`generation` pair is identical across every one of the
five seasons and every page kind sampled, confirming it is one single, complete, internally
consistent publish — not a partial or resumed one.

**What changed in this run:** the Teams-list metric snapshot (`teams/{year}`'s `metrics` field,
`packages/harness/publish.ts`'s new `lastOfficialMetricsByTeam`) now reflects each team's state as
of its LAST OFFICIAL match, not its season-final state — an offseason or preseason Week-0 result can
no longer move a team's position on the season leaderboard. Verified directly against the shipped
bytes: `frc5002`/2024 (last event `2024aroz`, offseason) publishes a teams-row `total` of `17.04` —
its metric-history value as of its last OFFICIAL event (`2024cur`) — not `6.45`, its season-final
value (as of `2024aroz`). The team artifact (`team/frc5002/2024/vpr@...json`) still lists all four
of the team's 2024 events including `2024aroz`, proving team pages were not scoped by this change.
An offseason-only team keeps its `teams/{year}` row (name/record/counts) with an empty `metrics`
object rather than being dropped — verified structurally via `TeamsArtifactSchema`'s decode.

**Every page kind moved some amount this run, not just `teams/{year}` — and the causes are
separable, stated honestly rather than conflated.** The comparison baseline below is this
document's own LAST WRITTEN entry (2026-09-03, `vpr@5.0.0+tuned-2026-08`) — several undocumented
`vpr` promotions landed between that entry and the generation live immediately before this run
(`79a0a71a-...`, already `vpr@7.0.0+rolling-2026-09` before this run started; `opr`/`epa` versions
are unchanged, `4.0.0+baseline`/`2.0.0+baseline`, matching the 2026-09-03 entry). This run's own
code diff touches ONLY `teams/{year}`'s `metrics` field (see `git diff` for this quick task); the
`events`/`event`/`team`/`compare` movement below is attributable to those undocumented intervening
`vpr` promotions, not to this run's own change — not further isolated, since doing so would require
an out-of-scope intermediate run this quick task does not authorize (matching this document's own
established precedent for an unisolated multi-cause delta, e.g. the 2026-08-27 entry's "Team-page
delta" section).

| Page kind | Count | Median bytes | p95 bytes | Max bytes | Largest object's key | Change vs. 2026-09-03 (last documented) run |
|---|---:|---:|---:|---:|---|---|
| `teams/{year}` | 15 | 957,582 | 1,483,414 | 1,483,414 | `v1/teams/2026/vpr@7.0.0+rolling-2026-09.json` | -7,646 median (-0.79%), +48,043 p95/max (+3.35%), **largest-holding season moved from 2024 to 2026** — this run's own change (empty `metrics` for offseason-only teams shrinks some rows, consistent with the small median drop); the p95/max growth and season-of-max shift are attributed to the undocumented `vpr` version bumps noted above, not measured further |
| `team/{teamKey}/{year}` | 52,596 | 31,467 | 93,648 | 380,020 | `v1/team/frc3538/2024/vpr@7.0.0+rolling-2026-09.json` | +218 median (+0.70%), +2,154 p95 (+2.35%), +13,710 max (+3.74%), same largest key — untouched by this run's own code change (team pages are deliberately unscoped); attributed to the intervening `vpr` promotions |
| `events/{year}` | 15 | 75,225 | 84,115 | 84,115 | `v1/events/2025/vpr@7.0.0+rolling-2026-09.json` | +2 bytes p95/max (noise), median unchanged |
| `event/{eventKey}` | 4,143 | 47,997 | 97,910 | 164,876 | `v1/event/2024gal/vpr@7.0.0+rolling-2026-09.json` | +262 median (+0.55%), +2,430 p95 (+2.55%), +4,805 max (+3.00%), same largest key |
| `compare/{year}` | 5 | 13,926 | 14,025 | 14,025 | `v1/compare/2026.json` | -203 median (-1.44%), -200 p95/max (-1.41%), same largest key |

**One committed ceiling is newly crossed, measured and reported rather than absorbed.**
`teams/{year}`'s new max (1,483,414) stays well under its committed `budgetMaxBytes` (3,500,000).
`team/{teamKey}/{year}`'s new max (**380,020**) now exceeds its committed `budgetMaxBytes`
(375,000) by **5,020 bytes (1.34%)** — a small, genuinely new, un-actioned finding — while staying
comfortably under the separate absolute structural ceiling (`TEAM_PAGE_ABSOLUTE_MAX_BYTES`,
600,000: 220,000 bytes / 36.7% of headroom remains, so the artifact is not structurally dangerous,
only over its committed budget). `event/{eventKey}`'s new max (164,876) stays well under both its
committed `budgetMaxBytes` (350,000) and `EVENT_PAGE_ABSOLUTE_MAX_BYTES`. Against this run's own
machine-readable block below, `payloadBudget.test.ts` is **10/11** — every test passes except the
internal-consistency assertion's `team` iteration (`maxBytes (380020) should be <= budgetMaxBytes
(375000)`), which is exactly this overage, measured directly rather than asserted. The committed
`budgetMaxBytes` figures were left unchanged at publish time per this document's own standing
prohibition against raising a budget to fit a measurement — recorded as a finding for a deliberate
decision (shrink the artifact, or raise the ceiling with its own review), not something the quick
task was authorized to resolve. **Resolved same day (2026-09-04):** the user explicitly authorized
raising the `team/{teamKey}/{year}` ceiling 375,000 → 400,000 — the sanctioned deliberate-raise
path — recorded in the machine-readable block below; `payloadBudget.test.ts` returns to 11/11. The
`TEAM_PAGE_ABSOLUTE_MAX_BYTES` structural ceiling (600,000) in the test is untouched.

**Post-run health check.** `pnpm verify:subset` (equivalently `tsx scripts/verifySubsetPublish.ts`):
35 entries checked, 0 failing, generation uniformity 1 distinct value
(`4ba99e89-b196-4f88-90c7-3bc1ffae3de9`) across every non-retired-prefix entry sampled.

**Latest run — 2026-08-31, plan 08-05's D-03/D-12 republish
(`tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --include-offseason`),
generation `e2d220d9-e97b-480a-bcf1-82d3e2076b42`.** 56,774 page objects plus 2 manifests (56,776
total `PUT`s) — object count IDENTICAL to the prior run below, confirming this run changed what
four optional fields on existing rows CONTAIN, never which artifacts get built. 3,325,231,704 bytes
of page-object payload, 23 min 20 sec wall clock (`19:15:53Z`-`19:39:13Z`, 2026-08-31), backgrounded
from the first invocation (`run_in_background: true`, never a foreground call and never a retry).
Zero concurrent publish processes: an untruncated command-line-filtered `Get-CimInstance` query
returned zero real `publish.ts` processes both immediately before and immediately after the run
(only the query's own command line self-matched the filter string, excluded by an additional
`-notlike '*Get-CimInstance*'` clause). Exactly ONE distinct `generation` value
(`e2d220d9-e97b-480a-bcf1-82d3e2076b42`) was observed across every key `pnpm verify:subset`
sampled — the concurrent-writer detector — and it equals the run's own summary line.

**What changed in this run:** D-03's `redRpPmf`/`blueRpPmf` (each alliance's predicted
distribution over its total qualification-match ranking points) and D-12's
`actualRedRp`/`actualBlueRp` (the earned ranking points actually scored) now populate every played
row of every `event/{eventKey}` artifact for the first time — four optional/nullable fields on
existing `vpr@`/`opr@`/`epa@` keys, nothing added, nothing deleted, nothing renamed.

| Page kind | Count | Median bytes | p95 bytes | Max bytes | Largest object's key | Change vs. 2026-08-30 run |
|---|---:|---:|---:|---:|---|---|
| `teams/{year}` | 15 | 1,757,866 | 3,704,776 | 3,704,776 | `v1/teams/2024/vpr@2.1.0+tuned-2026-08.json` | unchanged — D-03/D-12 land on `event` matches only |
| `team/{teamKey}/{year}` | 52,596 | 42,217 | 147,853 | 675,956 | `v1/team/frc3538/2024/vpr@2.1.0+tuned-2026-08.json` | unchanged, same key |
| `events/{year}` | 15 | 75,225 | 84,113 | 84,113 | `v1/events/2025/vpr@2.1.0+tuned-2026-08.json` | unchanged |
| `event/{eventKey}` | 4,143 | 78,127 | 197,483 | **342,405** | `v1/event/2024gal/vpr@2.1.0+tuned-2026-08.json` | +2,438 median (+3.2%), +7,913 p95 (+4.2%), **+15,233 max (+4.66%)**, same largest key |
| `compare/{year}` | 5 | 14,029 | — | 14,144 | `v1/compare/2026.json` | unchanged |

**The `event` page kind's post-republish maximum (342,405 bytes, still `2024gal`) clears the
350,000-byte `budgetMaxBytes`/`EVENT_PAGE_ABSOLUTE_MAX_BYTES` ceiling with 7,595 bytes (2.17%) of
margin remaining.** `2024gal` held the maximum both before (327,172) and after this run — the
widened pre-flight probe (18 events across the five 2024 Championship-Division-family events
clustered within ~1,200 bytes of `2024gal`, plus District Championships, offseason controls, and
prior-season peers) found no candidate that overtook it; see this plan's own SUMMARY
(`08-05-SUMMARY.md`) for the full probed-candidate table. `teams/{year}` and `team/{teamKey}/{year}`
are entirely unaffected — neither field lands on those page kinds — so ledger #11's and #15's
open, accepted overages move by zero bytes in this run.

**Post-run health check.** `pnpm verify:subset` (35 entries, the committed event subset): 0
failing. Every RP-eligible `vpr` entry (one each from 2022, 2023, 2024, 2025 and 2026 — `2022ilpe`,
`2023cur`/`2023nhgrs`, `2024casf`/`2024new`, `2025flta`, `2026vache`) reports
`playedQmBothPmfCount` exactly equal to its own `playedQmRowCount`. Every offseason `vpr` entry and
both the `opr@3.1.0+baseline`/`epa@1.1.0+baseline` arms at `2024casf` report ZERO rows carrying
either pmf field, while still reporting `actualRedRp`/`actualBlueRp` present on every played row —
the negative half that makes the positive half non-vacuous. `2024auwarp` reports 47 played `qm`
rows, `actualRedRp`/`actualBlueRp` present (key-count 47) on all of them, zero null values, and
zero teams carrying `rp` — the real published object D-12's summed-fallback precedence path is
falsifiable against.

**A measured pmf-array-length finding, corrected from this plan's own pre-run text — and corrected
a second time from this document's own first correction.** The plan's `<behavior>` section stated
"D-03 records the measured shape as always length 7"; that is not universal. The real published
bytes show the length is **season-dependent**, tracking each season's own RP-bonus count (2 for a
win plus up to N ranking-point bonuses, giving a range of `2N+3` integer totals): length **5** for
2022-2024 (`2022ilpe`, `2023cur`, `2023nhgrs`, `2024casf`, `2024new` — all N=2, two RP bonuses) and
length **7** for 2025-2026 (`2025flta`, `2026vache` — N=3, three RP bonuses, matching this
document's own earlier note that "2025/2026 both carry three ranking-point bonuses (2024 carries
two)"). Every RP-eligible entry ALSO carries a **degenerate length-1** pmf on every
non-qualification (playoff) row, regardless of season — sigma1 predicts a certain, single-outcome
distribution for playoff matches rather than omitting the field, since pmf production is gated on
event type, not competition level (`publish.ts`'s `matches` row builder comment: "Not gated on the
competition level, deliberately"). Confirmed directly from `pmfLengthHistogram`: `2024casf/vpr`
`{"1":30,"5":144}` (30 = 15 non-qm played rows × 2 alliances, 144 = 72 played qm rows × 2 alliances,
length 5) versus `2025flta/vpr` `{"1":30,"7":168}` (30 = 15 non-qm played rows × 2 alliances, 168 =
84 played+upcoming qm rows × 2 alliances, length 7). This degenerate playoff-row pmf is also why the
republish's measured `event` max (342,405, at `2024gal`, a 2024/N=2/length-5 event) exceeded the
pre-flight dry-run probe's measurement for the same key (341,949, Task 1) by 456 bytes — the
probe's projection used qm-row counts only and did not account for `2024gal`'s own playoff rows.

**A materially non-zero `actualRedRp`/`actualBlueRp` null rate, found on three offseason entries —
routed to 08-11.** `2023cnsh` (58/58 played qm rows null), `2024vabrb` (16/16 null), and
`2025isios` (43/43 null) report a **100%** null rate for both fields — every other subset entry
reports zero nulls. `MatchResult.redRpEarned`/`blueRpEarned` was never derivable for these three
offseason events (`toIntegerRpOrNull`'s honest `null`, D-12 rule: never coerced to `0`), most
likely because their TBA score-breakdown data lacks the fields the RP-earned calculation reads.
08-11's known-incomplete-baseline branch needs this: a per-season null rate is not uniformly low,
and these three entries are real published objects it can test against.

**The offseason pmf gap, confirmed on real published bytes (PD-06) — routed to 08-09 and 08-11.**
Seven offseason `vpr` subset entries (`2022mirr`, `2023cnsh`, `2024vabrb`, `2024wvrox`, `2025bc`,
`2025isios`, `2026wvrox`) publish `actualRedRp`/`actualBlueRp` on every played row and ZERO
`redRpPmf`/`blueRpPmf` on any row, because `isRpEligibleEventType` excludes event type 99 from
Sigma1's `predict()` pmf production. STATE.md's Phase 06.1 ingest record puts 368 offseason events
in the full corpus. A Simulation-tab empty state gated on zero `qm` rows will not catch this case
— "qm rows exist, no pmf" is a distinct state this republish makes directly observable for the
first time.

**Neither pre-existing ceiling is affected by this run, and neither is touched.** `teams/{year}`
(ledger #11, `budgetMaxBytes` 3,500,000, measured 3,704,776) and `team/{teamKey}/{year}` (ledger
#15, `budgetMaxBytes` 375,000 / absolute 600,000, measured 675,956) are unchanged from the
2026-08-30 run — D-03 and D-12 land only on `event/{eventKey}` matches. Both ledger entries remain
OPEN, both ceilings remain unraised, per this plan's own prohibition.

**Latest run — 2026-08-30,
`.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md`'s post-fix full republish
(`tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --include-offseason`),
generation `1c11cdd8-720d-479e-a737-fad94c4105a9`.** 56,774 page objects plus 2 manifests (56,776
total `PUT`s), 3,309,138,056 bytes of page-object payload, ≈16 min 55 sec wall clock
(`18:28:08Z`-`18:45:03Z`), no concurrent publish processes (`tasklist` confirmed a clean 12-process
baseline both before and after). Object count is IDENTICAL to the prior run below (this fix changes
which OBSERVATIONS feed the fit, never which artifacts get built) — every byte-figure movement is
small and consistent with changed decimal VALUES rather than a changed shape:

| Page kind | Count | Median bytes | p95 bytes | Max bytes | Change vs. 2026-08-30 (`07-UAT` G-8) run |
|---|---:|---:|---:|---:|---|
| `teams/{year}` | 15 | 1,757,866 | 3,704,776 | 3,704,776 | -418 bytes (-0.011%) |
| `team/{teamKey}/{year}` | 52,596 | 42,217 | 147,853 | 675,956 | +13 bytes (+0.002%), same key |
| `events/{year}` | 15 | 75,225 | 84,113 | 84,113 | unchanged |
| `event/{eventKey}` | 4,143 | 75,689 | 189,570 | 327,172 | -89 bytes (-0.027%) |
| `compare/{year}` | 5 | 14,029 | — | 14,144 | +11 bytes (+0.078%) |

Total page-object payload moved by -1,171,751 bytes (-0.035%) — the whole-alliance-DQ-zero-score
exclusion drops roughly 316 alliance-observations corpus-wide (158 real matches x 2, per the todo's
own measured scope), each dropped observation removing a few Kalman/OPR/EPA state updates whose
downstream numeric outputs round to marginally different digit counts; there is no new field and no
removed field on any artifact, so a shape-level regression would be the actual concern here and none
occurred. **Neither pre-existing ceiling moves in a way that changes its status** — both remain
crossed by essentially the same margin as the prior run (`teams/{year}`: 3,704,776 vs. the
3,500,000 `budgetMaxBytes`, still open, ledger #11; `team/{teamKey}/{year}`: 675,956 vs. the
375,000 `budgetMaxBytes` and the 600,000 absolute ceiling, still open, ledger #15) — see
`.planning/WINDOWS.md`, figures refreshed there too, both left OPEN per this todo's explicit
instruction not to resolve either ceiling as part of this fix.

Live verification against the public origin (not merely the local run's own tally):
`https://data.sigmascout.org/v1/team/frc4788/2026/vpr@2.1.0+tuned-2026-08.json` now reads
`total: {value: 94.03, spread: 9.83, percentile: 82.5}` — the exact case this todo's "smoking gun"
named, previously `-1354.13`. Corpus-wide 2026 `total` distribution (`v1/teams/2026/vpr@...`, 3,718
teams): 61 teams publish a negative total (was 85), 2 remain below -100 (`frc237` -116.93, `frc6524`
-113.58 — a materially different, ordinary "genuinely weak team" range, not a DQ artifact; was
`frc237` -113.83 and one other unnamed team before), minimum -116.93 (was -1354.13), maximum 419.09
(was 419.08, unchanged team `frc1690`, noise-level movement). A spot-checked partial-DQ team
(`frc7163`, three matches with one teammate DQ'd but never a whole-alliance-zero) publishes
20.34 ± 10.09 (21.5th percentile) — an ordinary below-average rating showing no sign of having lost
real matches, consistent with the regression suite's own byte-identical proof that a partial DQ is
untouched by this fix.

**Latest run — 2026-08-30, `07-UAT.md` G-8's full republish (`pnpm publish:seasons`), generation
`882249ad-be97-419d-b929-042aa17afb41`.** 56,774 page objects plus 2 manifests (56,776 total
`PUT`s), 3,310,309,807 bytes of page-object payload, ≈19 min 6 sec wall clock
(`05:16:02Z`-`05:35:08Z`), no concurrent publish processes (`tasklist` confirmed a clean 12-process
baseline both before and after). Object counts and per-kind byte figures are IDENTICAL to the
2026-08-29 run below for every page kind except `event/{eventKey}` — the only artifact this gap's
work (`EventAllianceSchema.record`, G-8 item 5) touches:

| Page kind | Count | Median bytes | p95 bytes | Max bytes | Change vs. 2026-08-29 run |
|---|---:|---:|---:|---:|---|
| `event/{eventKey}` | 4,143 | 75,709 | 189,784 | 327,261 | **+320 bytes on median, p95 AND max alike** (was 75,389 / 189,464 / 326,941) |
| `teams/{year}` | 15 | 1,758,192 | 3,705,194 | 3,705,194 | unchanged |
| `team/{teamKey}/{year}` | 52,596 | 42,208 | 147,846 | 675,943 | unchanged, same key (`v1/team/frc3538/2024/...`) |
| `events/{year}` | 15 | 75,225 | 84,113 | 84,113 | unchanged |
| `compare/{year}` | 5 | 14,035 | — | 14,133 | unchanged |

The identical +320-byte shift across median, p95 AND max is itself the finding: it is the signature
of a field that landed on every event artifact roughly uniformly (a short, mostly fixed-size
`record: {wins, losses, ties}` object, present on the ~6/7 of alliances that have run a playoff
bracket) rather than a change whose cost scales with an event's own size. Confirmed directly: the
largest object's own key is unchanged (`v1/event/2024arc/vpr@2.0.0+tuned-2026-08.json`), so the
+320 bytes at `max` is the SAME object growing by the SAME amount every other event grew by, not a
different, larger event taking over the maximum. **Neither ceiling this page kind is measured
against moves as a result** — `event/{eventKey}`'s committed `budgetMaxBytes` is 350,000 and its
new max (327,261) clears it with 22,739 bytes (6.9%) to spare, comfortably inside the pre-existing
headroom this small a shift could not threaten.

Alliance records verified against the live public origin, not merely asserted from the local run:
`https://data.sigmascout.org/v1/event/2023cur/vpr@2.0.0+tuned-2026-08.json` alliance 1 reads back
`{"wins":4,"losses":3,"ties":0}` — the exact value independently read from the corpus's raw
`status_raw` column before this republish.

**Latest run — 2026-08-29, `.planning/todos/completed/exclude-offseason-demo-teams-SUMMARY.md`'s
post-exclusion full republish (`pnpm publish:seasons`), generation
`961340e8-9e45-4d91-8e85-f72982ac3d87`.** 56,774 page objects plus 2 manifests (56,776 total
`PUT`s), 3,309,108,967 bytes (≈3.08 GiB) of page-object payload — **414 fewer objects and
49,649,158 fewer bytes (-1.48%) than the prior run below**, entirely attributable to this run
being the FIRST to exclude TBA's 30 `frc9970`-`frc9999` "Off-Season Demo Team" keys from both the
model (OPR/EPA/VPR ratings) and every published team surface. 23 minutes 38 seconds wall clock
(`23:28:41Z`-`23:52:19Z`), no concurrent publish processes (`tasklist` confirmed a clean 12-process
baseline both before and after — no zombie repeat of 07-17's incident).

| Page kind | Count | Median bytes | p95 bytes | Max bytes | Largest object's key |
|---|---:|---:|---:|---:|---|
| `teams/{year}` | 15 | 1,758,192 | 3,705,194 | 3,705,194 | `v1/teams/2024/vpr@2.0.0+tuned-2026-08.json` |
| `team/{teamKey}/{year}` | 52,596 | 42,208 | 147,846 | 675,943 | `v1/team/frc3538/2024/vpr@2.0.0+tuned-2026-08.json` |
| `events/{year}` | 15 | 75,225 | 84,113 | 84,113 | `v1/events/2025/vpr@2.0.0+tuned-2026-08.json` |
| `event/{eventKey}` | 4,143 | 75,389 | 189,464 | 326,941 | `v1/event/2024arc/vpr@2.0.0+tuned-2026-08.json` |
| `compare/{year}` | 5 | 14,035 | — | 14,133 | `v1/compare/2025.json` |
| `manifest/live-windows` | 1 | — | — | — | `v1/manifest/live-windows.json` |
| `manifest/algorithms` | 1 | — | — | — | `v1/manifest/algorithms.json` |

**`team/{teamKey}/{year}`'s object count confirms the todo's own predicted "138 fewer
team-seasons" exactly**: 53,010 -> 52,596 is precisely 414 fewer objects (138 team-seasons x 3
algorithms), directly from `publishSeasons`'s own upload tally (`computeSizeStats(uploader.records)`
over THIS run's actual `PUT` calls) — not projected. `event`/`events`/`compare` moved by less than
0.01% (ordinary percentile-pool noise from a marginally smaller team field, not a new cause) and
are otherwise unaffected, confirming the exclusion's blast radius stayed where the todo scoped it.

**Both previously-crossed ceilings stay crossed — neither raised, per the todo's own explicit
non-goal statement that this fix does not resolve the payload ceilings.**

- `teams/{year}` max moved from 3,732,955 to **3,705,194 bytes** (-27,761 bytes, -0.74%), still over
  the committed `budgetMaxBytes` of 3,500,000. See `.planning/WINDOWS.md` ledger #11 (figure
  updated below, left OPEN).
- `team/{teamKey}/{year}` max moved from 821,938 (`frc9999/2024`, a demo key, no longer published at
  all) to **675,943 bytes**, for `v1/team/frc3538/2024/vpr@2.0.0+tuned-2026-08.json` — **-145,995
  bytes, -17.76%**, close to the todo's own pre-run estimate (~682,000 bytes, ~19%). `frc3538/2024`
  is CONFIRMED (not assumed) as the new maximum-holding team-season, read directly from this run's
  own `computeSizeStats` output — it is a real team (234 played matches in 2024, `04-CONTEXT.md`'s
  own previously-measured "max 292 matches per team per season" fact, now the actual page-size
  ceiling holder since the larger-matchcount `frc9999` was a demo key). Still **over both** the
  375,000-byte committed `budgetMaxBytes` (80.3% over) and the 600,000-byte absolute structural
  ceiling `payloadBudget.test.ts` enforces (12.7% over) — `pnpm vitest run
  packages/harness/payloadBudget.test.ts` stays genuinely RED for these same two assertions, exactly
  as before this run, per the todo's explicit instruction not to raise either ceiling. See
  `.planning/WINDOWS.md` ledger #15 (figure updated below, left OPEN).

**Representative real-team rating movement, confirmed against real published bytes on both sides
of the run (not projected).** `frc4613` (2026 season) shared an alliance with demo team `frc9992`
at `2026audd`'s playoff finals (`2026audd_f1m1`/`f1m2`). Fetched directly from
`https://data.sigmascout.org` immediately before and after this run:

| Team | Algorithm | Before (generation `47d020a4-...`) | After (generation `961340e8-...`) |
|---|---|---|---|
| `frc4613`/2026 | `vpr` | 205.93 ± 8.47 (percentile 98.0) | 201.86 ± 7.90 (percentile 97.9) |
| `frc4613`/2026 | `opr` | 262.0 (percentile 99.1) | 274.09 (percentile 99.2) |

Both algorithms' ratings for this real team moved — expected, and the point (the prior generation's
number folded a fictional demo robot's share into every real teammate it ever shared an alliance
with). OPR moved up here (an event-scoped fit at `2026audd` specifically, where removing the demo
column changes that one event's own least-squares solve) while VPR moved down slightly (a
season-long Kalman filter, where the effect nets out differently) — both are genuine, not a
regression in either direction; a per-algorithm sign is not predictable in general, only that the
rating changes.

**Orphaned demo-team objects — since deleted.** At the time of the run described above, this
republish did not retroactively delete the ~414 `team/{teamKey}/{year}` objects the PRIOR
generation (`47d020a4-...`) had written for demo keys — R2 has no cascading delete, and
`publishSeasons` only ever `PUT`s keys it is asked to build. That gap was closed on 2026-08-29 by
`scripts/deleteOrphanedDemoTeamObjects.ts` (`pnpm cleanup:orphaned-demo-teams -- --execute`),
generalizing `scripts/deleteRetiredAlgorithmObjects.ts`'s enumerate-then-delete-then-census pattern
from "retired algorithm id" to "excluded team key": the deterministic, corpus-free candidate set (30
demo keys x 5 seasons x 3 algorithms = 450 keys) was enumerated, censused, deleted, and
read-back-verified against the live origin —

| | Count |
|---|---:|
| Candidate keys enumerated | 450 |
| Present (`200`) before the delete pass | 414 (exactly this document's earlier estimate) |
| Present (`200`) after the delete pass | 0 |
| Control keys checked (`frc3538/2024` x opr/epa/vpr) | 3 present (`200`) before AND after |

Every one of the 414 keys the pre-delete census found now returns `404`; the real control team's
pages were unaffected both before and after. No object count or byte figure in the Payload budget
table above changes as a result — those figures were always drawn from the live generation's own
`PUT` tally (`961340e8-...`), never from stale orphaned objects under a prior generation stamp, so
this cleanup has no effect on either payload ceiling (`.planning/WINDOWS.md` ledgers #11/#15 remain
OPEN, unrelated to this cleanup).

**Post-run health check.** `pnpm verify:subset` (35 entries, the committed event subset): 0
failing, generation uniformity 1 distinct value (`961340e8-9e45-4d91-8e85-f72982ac3d87`) across
every non-retired-prefix entry checked.

**Latest run — 2026-08-28, plan 07-17's D-18 full republish (`pnpm publish:seasons`, now
including `--include-offseason` — see the command-scope note below), generation
`47d020a4-1a16-4331-bd70-ce2f468bf2d1`.** 57,188 page objects plus 2 manifests (57,190 total
`PUT`s), 3,358,758,125 bytes (≈3.13 GiB) of page-object payload, under the renamed `vpr@` prefix
(D-04/D-05) beside the retained `sigma1@`/`opr@`/`epa@` objects. This run carries all nine D-18
items at once and is the FIRST run in this document's history to describe a wider stream than
every earlier run below: `--include-offseason` widens `buildSeasonStream` itself, so **20,055
additional played matches (+23.8% over the 84,339 regular-season matches) entered the walk-forward
replay**, and 6,729 of 17,670 team-seasons (38%) carry at least one played offseason match and
therefore publish different numbers than the figures every earlier section in this document
describes. `docs/models/` and `data/baselines/` were measured on the narrower (offseason-excluded)
stream and have not been re-run — that divergence is a standing finding routed forward, not
resolved here. **Resolved 2026-08-30** by
`.planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md`: see
`docs/models/offseason-inclusion-remeasurement.md` for the re-measured Brier/accuracy figures and
the SC-3 re-verdict (still 8/8 PASS). Two events (`2024orbb`, `2025orbb`) self-reported a non-integer `rp` value that
first blocked this run's `--include-offseason` dry-run; fixed out-of-scope and authorized at this
plan's own `checkpoint:decision` (`packages/ingest/normalize.ts`'s `extractRp` now degrades a
non-integer self-reported RP to `null` rather than passing it through — see
`.planning/WINDOWS.md` ledger #14).

**Execution note, recorded honestly rather than omitted.** The first tracked invocation of this
run was contaminated: four earlier "killed" attempts left zombie `node.exe` processes alive in the
background (Windows/Git-Bash's process-tree kill did not reach the deep `tsx` child), each
independently replaying and uploading the full range concurrently with the tracked run. Those four
were identified and terminated before any figure below was read, and this run — generation
`47d020a4-1a16-4331-bd70-ce2f468bf2d1` — is a clean, solitary re-run started only after a full
process-list check confirmed zero other publish processes were alive. Every figure below is read
from that clean run's own log and from a post-run `pnpm verify:subset` generation-uniformity check
confirming exactly one distinct generation across every sampled key. See this plan's own SUMMARY
for the full incident account.

| Page kind | Count | Median bytes | p95 bytes | Max bytes | Largest object's key |
|---|---:|---:|---:|---:|---|
| `teams/{year}` | 15 | 1,773,535 | 3,732,955 | 3,732,955 | `v1/teams/2024/vpr@2.0.0+tuned-2026-08.json` |
| `team/{teamKey}/{year}` | 53,010 | 42,381 | 149,580 | 821,938 | `v1/team/frc9999/2024/vpr@2.0.0+tuned-2026-08.json` |
| `events/{year}` | 15 | 75,225 | 84,113 | 84,113 | `v1/events/2025/vpr@2.0.0+tuned-2026-08.json` |
| `event/{eventKey}` | 4,143 | 76,937 | 189,578 | 326,949 | `v1/event/2024arc/vpr@2.0.0+tuned-2026-08.json` |
| `compare/{year}` | 5 | 14,045 | — | 14,149 | `v1/compare/2025.json` |
| `manifest/live-windows` | 1 | — | — | — | `v1/manifest/live-windows.json` |
| `manifest/algorithms` | 1 | — | — | — | `v1/manifest/algorithms.json` |

**Two ceilings are crossed, one already accepted and now worse, one crossed for the first time —
both left untouched per this plan's own prohibition against raising a budget to fit a
measurement.**

- `teams/{year}`'s max moved from the previously-recorded 3,577,069 bytes to **3,732,955 bytes**,
  further over the committed `budgetMaxBytes` of 3,500,000 (accepted override, ledger #11 — this
  run's figure supersedes the ledger entry's previously-recorded number, updated below). D-18's new
  per-team fields (rank/record/rp/variance context, plus every affected team's offseason-widened
  `activeYears`) grew an already-over page kind further; this run does not investigate the byte-level
  attribution further than that, since the ceiling was already a standing, accepted finding before
  this run.
- `team/{teamKey}/{year}` crosses its 375,000-byte ceiling for the FIRST time in this document's
  history: **821,938 bytes**, for `v1/team/frc9999/2024/vpr@2.0.0+tuned-2026-08.json` — 119% over.
  `frc9999` is a synthetic/heavily-reused team key (confirmed directly: 27 events, 289 matches in
  the 2024 season alone under offseason inclusion — a real published object, not a data-integrity
  artifact of the republish). This is a genuine, real, un-actioned finding for a developer to
  decide on, recorded here per `.planning/WINDOWS.md` ledger #15 and routed to 07-19 with the
  ceiling left untouched, exactly as the `teams/{year}` overage already is.

Every other page kind's `max` stays under its committed ceiling: `events/{year}` 84,113 < 108,000;
`event/{eventKey}` 326,949 < 350,000; `compare/{year}` 14,149 < 20,000.

**Command scope, decided here (07-09's PD-08 routed this question forward; 07-17's PD-02 decides
it).** `publish:seasons` now reads
`tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --include-offseason` — the
documented re-baseline command is the command that produced every figure in this section, and
`publishSeasons`' own `includeOffseason` default stays `false` so the capability is opt-in at the
library level.

**Run — 2026-08-27, `00:01:39Z`-`00:24:31Z` (≈22 min 52 sec wall clock),** producing 54,671
page objects plus 2 manifests (54,673 total `PUT`s), 2,714,525,205 bytes (≈2.53 GiB) of page-object
payload (generation `bbe1552e-0091-40cf-b70c-cf4296ebcf63`). This is plan 06.1-07's single
authorized republish, carrying live for the first time: predicted per-bonus RP probabilities and
actual per-bonus flags on a played qualification match row (06.1-02/06.1-05), event rank and total
on an event a team has a real TBA ranking for (06.1-01/06.1-04), and season-final-ranked percentiles
on the four allowlisted `metricHistory` metrics (06.1-03/06.1-05). Object count landed exactly on
the prior run's 54,671 page objects + 2 manifests — confirming these additions changed bytes, not
object count, matching the same D-01…D-05 invariant the 2026-08-25 run itself proved.

**This run also carries two Phase-6 (not 06.1) commits that landed *after* the 2026-08-25 run above
and were never republished until now** — `06f468ad` ("publish phase-group metrics with real spread
and percentile": `phaseAuto`/`phaseTeleop`/`phaseEndgame` group metrics, computed in
`packages/core/algorithms/sigma1/covariance.ts`'s `subsetVariance`, added to every algorithm's
`teamMetrics()` output) and `bf1e3228` ("publish rarity tier on the teams artifact"): a per-metric
`tier` field on the `teams/{year}` artifact. Both commit messages state outright "Not yet visible on
the site — requires an artifact republish." Because this run is the *first* republish since those
two commits landed, **four of the five page kinds below moved, not one** — `teams/{year}` and
`event/{eventKey}` moved for reasons entirely attributable to these two pre-06.1 commits, confirmed
by reading `buildEventArtifact`/`buildTeamsArtifact`'s assembly code directly (neither function
reads `redBonusRp`, `percentile`, `rank`, or `totalTeams` — see the "Team-page delta" section below
for the full investigation). `events/{year}` and `compare/{year}` are the only two kinds unaffected
by any of these five field groups, and are confirmed byte-identical to the 2026-08-25 run.

| Page kind | Count | Median bytes | p95 bytes | Max bytes | Largest object's key |
|---|---:|---:|---:|---:|---|
| `teams/{year}` | 15 | 1,711,158 | 3,577,069 | 3,577,069 | `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json` |
| `team/{teamKey}/{year}` | 51,693 | 37,049 | 119,877 | 340,569 | `v1/team/frc118/2026/sigma1@2.0.0+tuned-2026-08.json` |
| `events/{year}` | 15 | 75,106 | 83,752 | 83,752 | `v1/events/2025/sigma1@2.0.0+tuned-2026-08.json` |
| `event/{eventKey}` | 2,943 | 82,074 | 175,866 | 285,437 | `v1/event/2024new/sigma1@2.0.0+tuned-2026-08.json` |
| `compare/{year}` | 5 | 14,017 | — | 14,121 | `v1/compare/2026.json` |
| `manifest/live-windows` | 1 | — | — | — | `v1/manifest/live-windows.json` |
| `manifest/algorithms` | 1 | — | — | — | `v1/manifest/algorithms.json` |

`events/{year}` and `compare/{year}` rows are byte-identical to the 2026-08-25 run — confirmed by
direct comparison, both unaffected by any of the five contributing field groups named above.

**Open finding, not fixed by this plan: `teams/{year}`'s measured maximum (3,577,069 bytes) now
exceeds its own committed `budgetMaxBytes` (3,500,000 bytes) by 77,069 bytes.**
`packages/harness/payloadBudget.test.ts`'s internal-consistency check now fails for this one page
kind — measured directly, not assumed:
`AssertionError: teams: maxBytes (3577069) should be <= budgetMaxBytes (3500000)`. This ceiling was
never at risk from plan 06.1's own three items — none of them touch `teams/{year}` (see the
investigation above) — it was crossed entirely by `bf1e3228`'s per-metric `tier` field, a Phase-6
commit that had simply never been republished (and so never measured against this ceiling) until
this run. **This plan's own prohibition against raising a committed ceiling to make a failing gate
pass applies here exactly as it does to the `team` (375,000) ceiling** — `budgetMaxBytes` for
`teams` is left at 3,500,000, unchanged, below. The absolute-ceiling test
(`TEAMS_PAGE_ABSOLUTE_MAX_BYTES = 5,000,000`) still passes — the artifact has not grown
structurally dangerous — but the committed 3,500,000 figure is now a real, measured, un-actioned
finding for a developer to decide on (raise the ceiling deliberately with its own review, or shrink
the artifact — e.g. reconsidering the Common-tier-omission trade documented in `bf1e3228`'s own
commit message), not something this docs-only republish plan is authorized to resolve unilaterally.
`pnpm vitest run packages/harness/payloadBudget.test.ts` is left genuinely RED by this run — see
this plan's own SUMMARY for the full accounting.

`(count 15 = 5 seasons × 3 algorithms; count 5 for compare = one file per year, algorithm-unscoped
per D-02's documented exception; the manifest rows are single objects with no distribution to
summarize.)`

D-05 names two artifacts explicitly as the ones most at risk of a payload regression, since page
load speed is this project's top stated UX priority:

- **The year-wide teams table** (`teams/{year}`) topped out at **3,577,069 bytes** (≈3.41 MiB),
  for `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json` — moved this run (see the investigation
  below); the identical key held the maximum in both the 2026-08-25 and this run.
- **The 292-match team page** (`team/{teamKey}/{year}`) topped out at **340,569 bytes** (≈332.6
  KiB), for `v1/team/frc118/2026/sigma1@2.0.0+tuned-2026-08.json` — **2026, not 2024, is now the
  maximum-holding season**: 2025/2026 both carry three ranking-point bonuses (2024 carries two),
  and a three-bonus season's per-match predicted/actual arrays cost more bytes per row, exactly as
  plan 06.1-07 Task 1's pre-run projection warned (measure rather than assume). frc118 remains the
  team, consistent with 04-CONTEXT.md's measured "max 292 matches per team per season" fact.

### Investigation: why `teams/{year}` and `event/{eventKey}` moved (plan 06.1-07 Task 2/3)

Plan 06.1-07's own acceptance criteria required investigating, not merely recording, any page kind
other than `team/{teamKey}/{year}` that moved. Both moves are real and are entirely attributable to
two Phase-6 commits (`06f468ad`, `bf1e3228`) that landed 2026-08-26 — *after* the 2026-08-25 run
recorded above, and *before* plan 06.1 began — whose own commit messages state "Not yet visible on
the site — requires an artifact republish." This run is that republish; it is the first republish
since those two commits landed, so their effect is swept in alongside 06.1's own three items.

- **`event/{eventKey}`'s modest growth** (median +716 bytes/+0.88%, p95 +6,036 bytes/+3.55%, max
  +9,332 bytes/+3.38%, same largest key both runs) is attributable **entirely** to `06f468ad`:
  `buildEventArtifact`'s `teams` array is built from the raw (unwidened) `metricsByTeam` record
  (`packages/harness/publish.ts`'s `buildEventTeamsStanding` call), which now carries three
  additional entries (`phaseAuto`/`phaseTeleop`/`phaseEndgame`) per team from that commit's core
  change to every algorithm's `teamMetrics()`. Confirmed by reading `buildEventArtifact`'s assembly
  code directly (`packages/harness/publish.ts`): it reads `pRedWin`/scores/components and each
  team's raw `metrics` only — it never reads `redBonusRp`, `percentile`, `rank`, or `totalTeams`,
  none of which plan 06.1's own three items could have moved this artifact.
- **`teams/{year}`'s larger growth** (median +349,166 bytes/+25.6%, max +855,182 bytes/+31.4%) is
  attributable to `bf1e3228`'s per-metric `tier` field (the dominant driver — every metric on every
  team in the season now carries a `tier` string), compounded by `06f468ad`'s three extra
  group-metric names each also receiving a percentile-derived tier. Confirmed directly: the fetched
  `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json` artifact carries `tier` 29,597 times and
  `percentile` zero times (the documented Phase-6 scope boundary — this artifact publishes the
  compact `tier`, never the raw `percentile` — still holds; only which metric names are published
  changed). Neither cause is this phase's own.
- **`events/{year}` and `compare/{year}`** are confirmed byte-identical to the 2026-08-25 run —
  neither reads any of the five contributing field groups.

### Team-page delta — five contributing field groups, not three (plan 06.1-07)

The 292-match team page's measured maximum moved from the recorded **304,862-byte baseline**
(2026-08-25 run, plan 06-06) to **340,569 bytes** (this run) — a **+35,707 byte (+11.71%)**
increase. Unlike `event/{eventKey}` above, `team/{teamKey}/{year}` is the one artifact **both** the
carried-forward Phase-6 work and this phase's own three items touch, so — stated plainly rather than
forced into a false three-group narrative — this delta has **five** real contributing causes:

1. **(pre-06.1, `06f468ad`)** `phaseAuto`/`phaseTeleop`/`phaseEndgame` group metrics (value, spread,
   percentile) added to `seasonStats.metrics` and every `metricHistory` row.
2. **(06.1-01/06.1-04)** Event `rank`/`totalTeams`, now populated from the full 2022–2026
   `event_rankings` ingest rather than the 2024-only tracer.
3. **(06.1-02/06.1-05)** Predicted per-bonus RP probabilities (`redBonusRp`/`blueBonusRp`) and actual
   per-bonus flags (`actualRedBonusRp`/`actualBlueBonusRp`) on every played qualification match row.
4. **(06.1-03/06.1-05)** Season-final-ranked `percentile` on the four `HISTORY_PERCENTILE_METRIC_KEYS`
   metrics of every `metricHistory` row.
5. The three-bonus-season effect noted above (2026 now the maximum-holding season, not 2024) — a
   consequence of cause 3 above interacting with each season's own bonus count, not a sixth cause.

**A precise byte-level split between cause 1 (pre-06.1 carryover) and causes 2–4 (this phase's own
work) was not separately measured.** Isolating it would require an additional run against an
intermediate commit (after `06f468ad`/`bf1e3228`, before 06.1-01) — an out-of-scope run this plan's
own scope fence (`docs/publish-budget.md` only, no source-file changes, one authorized republish for
the whole phase) does not authorize, and fabricating a split figure without measuring it would
violate this plan's own second prohibition (never record a projected or interpolated figure as
though it were measured). What is measured and reported above is the real, complete, five-cause
delta.

Remaining headroom under the `budgetMaxBytes: 375,000` budget: **34,431 bytes (9.18%)** — no
overage; `budgetMaxBytes` was left untouched per this plan's own prohibition against raising a
budget to fit a measurement.

**Compressed figures — re-measured against the real custom domain, this run's own objects.**
`curl -H "Accept-Encoding: br, gzip"` against `https://data.sigmascout.org` (D-25's live custom
domain) returns `HTTP/1.1 200` **with `Content-Encoding: br`** on every page kind checked:

| Object | Raw bytes (`Accept-Encoding: identity`) | Brotli-compressed bytes (`Accept-Encoding: br, gzip`) | Reduction |
|---|---:|---:|---:|
| `v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json` | 3,577,069 | 466,395 | −87.0% |
| `v1/team/frc118/2026/sigma1@2.0.0+tuned-2026-08.json` | 340,569 | 50,646 | −85.1% |

Cloudflare's edge continues to apply Brotli automatically for a real client fetching
`data.sigmascout.org` — a reader downloads roughly an eighth to a seventh of the raw byte counts in
the table above, unchanged in kind from the 2026-08-25 finding, re-measured here against this run's
own (larger) objects. The RAW byte counts remain the correct figures for the
budget/`payloadBudget.test.ts` gate (they bound worst-case parse/memory cost, not wire cost).

## Storage and write volume (DATA-05)

One full publish (`pnpm publish:seasons`, latest run — 2026-08-27, plan 06.1-07's single authorized
republish):

| Metric | Local counter (this run) | Free-tier allowance | Headroom |
|---|---:|---:|---|
| Objects written | 54,673 (54,671 page objects + 2 manifests) | — | — |
| Bytes written | 2,714,525,205 (≈2.53 GiB) | 10 GB storage | ≈74.7% of the allowance unused after this run |
| Class-A operations (PUTs) | 54,673 | 1,000,000/month | ≈5.47% of one month's allowance for one full publish |

**Prior run for comparison** (2026-08-25, plan 06-06's republish): 2,454,511,888 bytes (≈2.29 GiB),
same 54,673-object count, ≈77.1% storage headroom. The byte-count increase this run (+260,013,317
bytes, ≈+10.6%) is attributable to the five contributing field groups named in the "Team-page delta"
section above, landing across the affected `teams/{year}`, `event/{eventKey}`, and
`team/{teamKey}/{year}` objects — `events/{year}` and `compare/{year}` are unaffected and
byte-identical between the two runs.

**These are the LOCAL counter's numbers, not the Cloudflare dashboard's.** Per
`04-VALIDATION.md`'s own Manual-Only Verifications table, R2 storage total and Class-A operation
count as billed are account-level Cloudflare metrics that can only be read from the dashboard by a
human with account access — this automated run has no dashboard access and does not fabricate that
cross-check. **The dashboard read-back remains an open manual step**, tracked here rather than
silently marked done: after this run, a human should open the Cloudflare R2 dashboard for the
`sigmascout-artifacts` bucket and record the dashboard's own object count / storage total / Class-A
count alongside the local numbers above, since the two can differ (multipart uploads, retries, and
prior runs' objects all count toward the dashboard figure but not this run's local counter).

## Delete pass — 2026-08-29, plan 07-19 Task 3 (D-06, the retired `sigma1` prefix removed)

**This is the section 07-17 assigned here.** After 07-18 moved the deployed client onto the
renamed `vpr@` prefix exclusively, this pass deleted the orphaned `sigma1@2.0.0+tuned-2026-08`
objects in R2 and the retired id's rows in remote D1, then redeployed the Worker onto the renamed
live-fold tier. Four production mutations, run in the order argued in `07-19-PLAN.md`: Worker
deploy, manifest collapse, D1 row delete, R2 object delete.

**The delete pass's exit code is not the evidence and is not reported as though it were** —
`deleteObject` treats a missing key as success by S3 contract, so the numbers below are three
distinct, never-conflated figures, plus a before/after stratified census over the same 60 sampled
keys (the only proof of *effect* a 404-as-success delete can produce):

```
pnpm cleanup:retired-objects --retired-id sigma1 --version 2.0.0+tuned-2026-08
```
(concurrency 16, the default and the value every committed publish figure was measured at;
`--seasons` left at its default `2022-2026` full range)

| Figure | Count | Source |
|---|---:|---|
| Keys ENUMERATED (the deliberate superset, PD-03) | 19,261 | `enumerateRetiredKeys` — 5 `teams` + 5 `events` + 1,581 `event` + 17,670 `team`, all offseason-inclusive |
| DELETE calls ISSUED | 19,261 | `reports/publish/07-19-delete.log` — every enumerated key issued exactly one `deleteObject` call, tallied per page kind in the log's own progress lines (matches enumerated exactly: `teams` 5, `events` 5, `event` 1,581, `team` 17,670) |
| Keys OBSERVED PRESENT before the pass (stratified sample, n=60) | 48/60 (80%) | `reports/publish/07-19-census-before.json` |
| Keys OBSERVED ABSENT before the pass (over-enumeration measurement) | 12/60, ALL in the `event` kind | same file — the deliberate offseason-inclusive superset catching event keys 07-10 published (or never wrote) under single-event mode |
| Keys OBSERVED PRESENT after the pass, SAME 60 keys | 0/60 | `reports/publish/07-19-census-after.json` — every key that returned 200 before now returns 404 |

**Reconciling the over-enumeration against RESEARCH.md's ≈18,222 projection.** The sample's 12
absences concentrate entirely in the `event` kind (12 of 25 sampled `event` keys, 48%), while all
25 sampled `team` keys and all 10 sampled `teams`/`events` keys were present (0% absent).
Extrapolating that kind-specific rate rather than a flat overall rate — 48% of the `event` kind's
1,581 keys, 0% of the remaining 17,680 — projects **≈759 event keys absent** out of the full
enumeration, for an estimated **≈18,502 objects actually existing** before the pass. That is close
to RESEARCH.md's independent ≈18,222 estimate (a 280-object, ≈1.5% difference) and is the figure
this section treats as the actual pre-pass population — a flat extrapolation of the sample's
overall 20% absence rate would have projected ≈15,409 and materially disagreed with RESEARCH.md's
number; the per-kind breakdown is what reconciles it.

**Wall clock.** The tool does not embed a per-line timestamp in `reports/publish/07-19-delete.log`
(only DELETE lines and every-1,000-key progress lines) — stated honestly rather than fabricated.
The wall clock below is read from the log FILE's own NTFS creation/last-write timestamps, the
closest available substitute: created `2026-08-29T03:21:29-04:00`, last written
`2026-08-29T03:23:15-04:00` — **≈1 min 46 sec** for 19,261 `deleteObject` calls at concurrency 16.

**The operation class Cloudflare bills `DeleteObject` under — corrected, not merely confirmed.**
07-17 attributed `DeleteObject` to Class A and flagged that attribution as unverified. Reading
Cloudflare's own R2 pricing page at run time
(`https://developers.cloudflare.com/r2/pricing/`, fetched 2026-08-29) shows this is **wrong**:
`DeleteObject` is listed under **Free operations** (alongside `DeleteBucket` and
`AbortMultipartUpload`), not Class A (`PutObject`, `CopyObject`, `ListObjects`, …) or Class B
(`GetObject`, `HeadObject`, …). The 19,261 `DeleteObject` calls this pass issued therefore cost
**zero** against either the 1,000,000/month Class A allowance or the 10,000,000/month Class B
allowance — 07-17's Class-A attribution is corrected here, not merely re-confirmed.

**Post-cleanup storage and object totals.** Before this pass, R2 held two coexisting copies: the
three live algorithms' complete published set (measured above at 3,358,758,125 bytes of
page-object payload, 57,188 page objects + 2 manifests) PLUS the orphaned `sigma1@` objects
(≈18,502 estimated, reconciled above). After this pass, only the live set remains — R2's total
page-object payload returns to the **already-measured 3,358,758,125 bytes (≈3.13 GiB)** figure in
the Payload budget table above, since that figure describes the three live algorithms' complete
set and nothing else now shares the bucket. Against the 10 GiB (10,737,418,240-byte) free-tier
storage cap: **≈31.3% used, ≈68.7% headroom** — local-counter arithmetic over 07-17's own measured
total, not a Cloudflare dashboard read (the dashboard cross-check remains the same open manual step
named below). Total live object count: **57,190** (57,188 page objects + 2 manifests) — down from
an estimated **≈75,692** while the orphaned set coexisted.

## D1 read-back — post-cleanup

Re-running the identical `GROUP BY` predicate Task 3 used before the delete (`SELECT algorithm_id,
scope_kind, COUNT(*) AS n FROM algorithm_state GROUP BY 1,2 ORDER BY 1,2`, executed 2026-08-29):

| algorithm_id | scope_kind | rows |
|---|---|---:|
| epa | league | 1 |
| epa | team | 4,773 |
| opr | event | 247 |
| opr | league | 1 |
| opr | team | 3,746 |
| vpr | league | 1 |
| vpr | team | 4,773 |

Exactly **three** algorithm ids — `sigma1` carries zero rows, confirmed absent. `npx wrangler d1
info sigmascout-state` reports **database_size: 27 MB**, comfortably clear of the 500 MB per-database
free-tier ceiling (≈5.4% used, ≈94.6% headroom) — down from the double-copy transitional peak this
document's "State-row shape" section describes, now that the retired id's rows are gone.

**These are local-counter/`wrangler`-reported figures, not a Cloudflare dashboard read.** The R2
dashboard cross-check named above remains the same open manual step it has been since plan 04-04 —
this pass neither closes it nor fabricates it.

## Delete pass — 2026-08-30, superseded opr/epa/vpr generation removed (version-retirement mode)

**A different kind of retirement than the section above.** The 07-19 delete pass (previous section)
retired a whole DEAD algorithm id (`sigma1`). This pass retires a superseded VERSION of a STILL-LIVE
algorithm — the whole-alliance-DQ-zero-score fix (see the Payload budget section's 2026-08-30 entry)
bumped all three algorithms' code versions, forcing a new republish and leaving the prior generation's
objects orphaned in R2 under `vpr@2.0.0+tuned-2026-08`, `opr@3.0.0+baseline`, `epa@1.0.0+baseline` —
while `vpr@2.1.0+tuned-2026-08`, `opr@3.1.0+baseline`, `epa@1.1.0+baseline` remained (and remain) live.
Two full generations coexisting in R2 (6.62 GB, 66% of the 10 GB free tier) put one more
version-bumping republish within reach of the tier's wall (9.93 GB, 99%) — this pass reclaimed the
first generation before that happened.

`scripts/deleteRetiredAlgorithmObjects.ts` gained a `--supersedes-live` mode for exactly this case
(see "Version-retirement procedure" below). Run once per algorithm, census-first then `--execute`,
each invocation independently checked against the live manifest at run time:

```bash
pnpm cleanup:retired-objects -- --retired-id vpr --version 2.0.0+tuned-2026-08 --supersedes-live --execute
pnpm cleanup:retired-objects -- --retired-id opr --version 3.0.0+baseline       --supersedes-live --execute
pnpm cleanup:retired-objects -- --retired-id epa --version 1.0.0+baseline       --supersedes-live --execute
```

**Guard behavior, confirmed rather than assumed.** Before any execute pass, each invocation fetched
`v1/manifest/algorithms.json` from the live public origin and confirmed the target version was NOT
the one named there (`opr@3.1.0+baseline`, `epa@1.1.0+baseline`, `vpr@2.1.0+tuned-2026-08` — the
manifest's actual live content at run time, not assumed). Had any target matched the live manifest,
`RefusedLiveVersionError` would have aborted before enumeration; a manifest fetch failure of any kind
would have aborted via `LiveManifestFetchError` — neither path fires here, confirmed by successful
enumeration.

**Per-algorithm figures, identical shape across all three (same corpus, same enumeration):**

| Figure | vpr | opr | epa | Source |
|---|---:|---:|---:|---|
| Keys ENUMERATED (the deliberate superset, per algorithm) | 19,261 | 19,261 | 19,261 | `enumerateSupersededVersionKeys` — 5 `teams` + 5 `events` + 1,581 `event` + 17,670 `team` |
| DELETE calls ISSUED | 19,261 | 19,261 | 19,261 | `reports/publish/07-19-delete.log` (each run's own tally, overwritten in place per invocation — confirmed matching enumerated count each time) |
| Keys OBSERVED PRESENT before (stratified sample, n=60) | 55/60 | 55/60 | 55/60 | scratch census before-JSON, same deterministic sample each run |
| Keys OBSERVED PRESENT after, SAME 60 keys | 0/60 | 0/60 | 0/60 | scratch census after-JSON — every key that returned 200 before now returns 404 |

Total: **57,783 DELETE calls issued** (19,261 × 3), all now confirmed absent by the same
before/after stratified-sample method the 07-19 pass established. The sample's per-kind absence
concentrates entirely in the `event` kind (5/25 sampled `event` keys absent, 20%; 0% absent across
`teams`/`events`/`team`) — the same shape 07-19's own reconciliation found, reflecting the same
offseason-inclusive superset over-enumerating a handful of `event` keys that were never written or
were written only under single-event mode.

**Exact real object count — read directly from this document's own prior measurement, not
projected.** The superseded generation is `882249ad-be97-419d-b929-042aa17afb41` — confirmed live
(not assumed) via the pre-delete census, which read this exact generation stamp back off the
`vpr@2.0.0+tuned-2026-08` objects before deleting them. That generation's own full-publish run is
already recorded above ("07-UAT.md G-8's full republish" entry): **56,774 page objects** total
across all three algorithms and every page kind, of which **56,769** (15 `teams` + 52,596 `team` +
15 `events` + 4,143 `event`) sit under the `teams`/`events`/`event`/`team` prefixes this pass
enumerates and deletes — 18,923 per algorithm, matching the stratified sample's own ≈18,945
per-algorithm extrapolation (55/60 + the per-kind-weighted event absence rate) within measurement
noise. The remaining 5 objects are that generation's `compare/{year}` set — algorithm-agnostic,
overwritten in place by every publish rather than versioned per algorithm, structurally unreachable
by this tool's enumeration (D-02's exception), and confirmed untouched below.

**Recovered storage.** That generation's own documented page-object payload total is **3,310,309,807
bytes**. Subtracting its `compare/{year}` portion (5 objects, ≈14,035 median bytes each ≈ 70,175
bytes — negligible, and the ONLY part of that generation's byte count this pass did not remove, since
`compare` was never versioned per algorithm) gives **≈3,310,239,632 bytes (≈3.31 GB) recovered**:

| | Bytes | % of 10 GB free tier |
|---|---:|---:|
| Before this pass (two generations coexisting: live `1c11cdd8-...` + superseded `882249ad-...`) | 6,619,377,688 | 66.2% |
| After this pass (live generation only) | 3,309,138,056 | 33.1% |
| **Recovered** | **3,310,239,632** | **33.1 percentage points** |

One more version-bumping republish now lands at ≈66.2% of the tier (the same two-generations-deep
state this pass just resolved), not ≈99% — this pass restored exactly the headroom a version bump
consumes, rather than merely deferring the wall.

**`DeleteObject` remains a free R2 operation** (07-19's own correction, Cloudflare's pricing page,
`developers.cloudflare.com/r2/pricing/`) — the 57,783 `DeleteObject` calls this pass issued cost zero
against either Class A or Class B free-tier allowances.

**D1 is untouched by this pass, by design.** Unlike the 07-19 algorithm-retirement pass (which
deleted the retired id's own rows via `GROUP BY`), D1's `algorithm_state` table is keyed by
`algorithm_id` alone, never `algorithm_id@version` — `opr`/`epa`/`vpr` remain the live ids in D1
before and after this pass, so a version bump changes nothing D1-side. No D1 read-back was run for
this pass; none was needed.

**Live verification, by HTTP against the public origin, not merely the local tool's own tally.**
Every superseded key sampled below returned 404; every current key returned 200; the live manifest
is unchanged; the site itself still loads:

```
404  v1/teams/2024/vpr@2.0.0+tuned-2026-08.json      200  v1/teams/2024/vpr@2.1.0+tuned-2026-08.json
404  v1/teams/2024/opr@3.0.0+baseline.json            200  v1/teams/2024/opr@3.1.0+baseline.json
404  v1/teams/2024/epa@1.0.0+baseline.json            200  v1/teams/2024/epa@1.1.0+baseline.json
404  v1/events/2024/vpr@2.0.0+tuned-2026-08.json      200  v1/events/2024/vpr@2.1.0+tuned-2026-08.json
404  v1/event/2024casj/vpr@2.0.0+tuned-2026-08.json   200  v1/event/2024casj/vpr@2.1.0+tuned-2026-08.json
404  v1/team/frc254/2024/vpr@2.0.0+tuned-2026-08.json 200  v1/team/frc254/2024/vpr@2.1.0+tuned-2026-08.json
200  v1/compare/2024.json (never enumerated, never touched)
```

`v1/manifest/algorithms.json` still reads exactly `["opr@3.1.0+baseline", "epa@1.1.0+baseline",
"vpr@2.1.0+tuned-2026-08"]`, generation `1c11cdd8-720d-479e-a737-fad94c4105a9`, byte-identical to
before this pass. `https://sigmascout.org/teams?year=2026` and
`https://sigmascout.org/event/2024casj` both return 200.

**Wall clock and process hygiene.** All three census-only, all three `--execute`, and all three
post-delete-census invocations ran sequentially, one at a time — `tasklist`'s node.exe count stayed
at the documented 12-process baseline before and after every single invocation (nine invocations
total), confirming zero concurrent or zombie publish/delete processes at any point, per the standing
Windows/Git-Bash zombie-process risk this document's 07-17 section first named.

### Version-retirement procedure (routine, for the next algorithm bump)

Every future algorithm code-version bump orphans the prior generation exactly this way. The routine:

1. **Confirm the situation, by HTTP, before doing anything.** Fetch
   `v1/manifest/algorithms.json` and confirm which `{id}@{version}` pairs it names as live. Fetch
   the OLD version's key for one page kind (e.g. `v1/teams/2024/{id}@{old-version}.json`) and
   confirm it still returns 200 — that confirms the prior generation is genuinely still present,
   not already reclaimed.
2. **Census first, for every algorithm whose version changed** (one invocation per algorithm — the
   `RETIRED_KEY_COUNT_BOUNDS` band is sized for one algorithm's key set, not three at once):
   ```bash
   pnpm cleanup:retired-objects -- --retired-id <id> --version <old-version> --supersedes-live
   ```
   Confirm the printed enumerated count sits inside `[15000, 25000]` and the census result is
   consistent with the prior pass's own shape (≈90% present is normal; the deliberate
   offseason-inclusive superset over-enumerates a handful of `event` keys).
3. **Execute, once satisfied the census looks right:**
   ```bash
   pnpm cleanup:retired-objects -- --retired-id <id> --version <old-version> --supersedes-live --execute
   ```
   If the tool refuses with `RefusedLiveVersionError`, STOP — the manifest still names that version
   as live, which means either the wrong version string was passed or the republish that was
   supposed to supersede it has not actually landed yet. If it refuses with
   `LiveManifestFetchError`, STOP and fix the fetch (network, origin, manifest shape) before
   retrying — never re-run with a stale assumption about what is live.
4. **Verify by HTTP afterward**, exactly as this section did: the old version 404s across all four
   page kinds, the new version still 200s on the same keys, the manifest is unchanged, and the site
   itself still loads.
5. **Check `tasklist`'s node.exe count before and after every invocation** (baseline 12 on this
   machine) — the same zombie-process risk 07-17/07-19's delete passes already carry applies
   identically here; never start a second invocation before confirming the previous one is
   genuinely finished.
6. D1 needs no action for a version-only bump (see above) — only a full algorithm retirement
   (`enumerateRetiredKeys`, no `--supersedes-live`) touches D1's rows.

## Re-baseline cadence (the D-12/D-24 resolution)

The re-baseline that overwrites live state is a **manual, human-triggered operation**, run before
and after an event weekend — not an automated schedule. D-24 makes publishing a local CLI command
against the 336 MB `data/corpus.sqlite`, which lives on one machine; a "scheduled" job that only
runs when that machine's laptop happens to be open is not actually scheduled. This plan takes
option (a) from `04-CONTEXT.md`'s own two: state the cadence plainly as manual, rather than
implying automation D-24 does not provide.

**The commands, run in this order:**

```bash
pnpm publish:seasons
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-opr.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-epa.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-sigma1.sql
```

**Historical note (corrected by plan 04-08):** before plan 04-08's league-row reshape (D-13), only
the `opr` step above could actually complete. `epa` and `sigma1`'s `emitSeedSql` step threw
`SeedRowTooLargeError` — their league rows carried per-team `priorSeasonRatings` data, each over
D1's 100,000-byte per-statement limit as a single row — so this four-command cadence was written
down here as if it worked for all three algorithms while only ever actually completing for one.
All three commands completed successfully for the first time on plan 04-08's 2026-08-22 run (see
"State-row shape" below).

`pnpm publish:seasons` writes the three `seed-{algorithmId}.sql` files to
`reports/publish/` (gitignored, local only) as a side effect — the three `wrangler d1 execute`
calls are what actually applies them, and they are **not run automatically by `publish:seasons`
itself**, matching D-12's "the offline run is the authority, so a re-baseline overwrites in place"
design: a human decides when the overwrite happens.

**Consequence if skipped:** the Worker keeps advancing incrementally from whatever live state it
last had. Nothing breaks — the site stays up and stays approximately fresh — but any drift between
the Worker's incremental folding and a from-scratch offline replay is not corrected until the next
manual re-baseline run. This is the accepted tradeoff of a local-corpus publishing model, not a
defect to be silently automated away.

**The follow-on that would make this genuinely scheduled:** CI-based publishing — a corpus
snapshot pushed to R2, a GitHub Actions job that pulls it and runs the publish pipeline on a real
cron schedule — is recorded in `04-CONTEXT.md`'s Deferred Ideas as the resolution if manual
re-baselining proves impractical in practice. This plan does not build it; the local-CLI path above
is what ships.

## Baseline provenance (D-09/D-10/D-11)

The published `opr` algorithm is **event-scoped OPR** (`opr@3.0.0+baseline`) — a fit over one
event's qualification matches only, matching what TBA and Statbotics both publish and what the FRC
community understands the term "OPR" to mean. The retired **season-pooled** OPR implementation
(one ridge-regularized fit per team, pooled across a whole season) remains recorded as history, not
deleted, in [`docs/models/opr-baseline-change.md`](models/opr-baseline-change.md) and
[`docs/models/sigma1-tuning-results.md`](models/sigma1-tuning-results.md). Event-scoped OPR is a
**weaker** baseline than the retired season-pooled one — it sees only one event's handful of
matches rather than a team's whole season — and that is stated here explicitly so a Sigma1 result
measured against it is read honestly, not mistaken for a moved goalpost (D-11).

## State-row shape (D-13, plan 04-08)

Before this plan, three of the state store's `scopeKind: "league"` rows held per-team maps that
belong in `scopeKind: "team"` rows instead — measured against the real corpus, 2026-08-22 (the
`sigma1`/`epa` figures from this plan's own objective text; the `opr` figure independently
re-confirmed by a read-back query run immediately before this plan's re-seed):

| Algorithm | League row before | Offending per-team map |
|---|---:|---|
| sigma1 | 259,174 bytes (≈253.1 KB) | `priorSeasonRatings` (`lastSeason`/`yearBefore`, ≈245.8 KB of the row) |
| epa | 251,995 bytes (≈246.0 KB) | `priorSeasonRatings` (`lastSeason`/`yearBefore`) |
| opr | 86,974 bytes (≈84.9 KB) | `lastEventByTeam` |

D1's hard per-statement cap is 100,000 bytes; sigma1's and epa's league rows were each roughly
2.5x that cap as a single SQL tuple, so `wrangler d1 execute --file` could never import them —
`pnpm publish:seasons` exited 1 for both algorithms on every run before this plan. Only `opr` (the
smallest offender) had ever been successfully seeded: 210 rows, RETIRED shape, seeded 2026-08-22,
still the only rows present in remote D1 immediately before this plan's re-seed.

Plan 04-08 moved every one of these per-team maps into `scopeKind: "team"` rows — a union type,
so a team may carry current-season state, a prior-season rating, or both, and a team known only
via a prior-season rating still gets its own row rather than being dropped — and added an explicit
`snapshotShapeVersion` to every league payload, so a RETIRED-shape row (exactly the 210 `opr` rows
already sitting in production) fails loudly (`LeagueRowShapeVersionError`) if read by the reshaped
deserializer, rather than being silently parsed with its per-team data discarded.

### League rows: before vs. after, measured against the real 2022-2026 corpus

Run: `pnpm publish:seasons` (`tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026`),
completed 2026-08-22 ~20:04:55Z, ~14 min wall clock. Seed files:
`reports/publish/seed-{opr,epa,sigma1}.sql`.

| Algorithm | League row before | League row after | Reduction |
|---|---:|---:|---:|
| opr | 86,974 bytes | 26 bytes | −99.97% |
| epa | 251,995 bytes | 179 bytes | −99.93% |
| sigma1 | 259,174 bytes | 7,465 bytes | −97.12% |
| **Total (3 algorithms)** | **598,143 bytes (≈584 KB)** | **7,670 bytes** | **−98.72%** |

All three are at or under `MAX_LEAGUE_ROW_BYTES` (16,384 bytes). sigma1's 7,465-byte league row —
the largest of the three, since it alone carries genuine per-component league aggregates
(`componentMean`/`componentConsistency`/`rpVariableMean`) — leaves roughly 2.2x headroom under
that budget.

### Seed emission: no `SeedRowTooLargeError`, for the first time for epa and sigma1

`pnpm publish:seasons` exited **0** on this run. Longest emitted statement, per seed file — all
comfortably under D1's real 100,000-byte per-statement limit:

| Algorithm | Statements (1 DELETE + N INSERT) | Longest statement (bytes) |
|---|---:|---:|
| opr | 34 (33 INSERT) | 90,050 |
| epa | 32 (31 INSERT) | 90,101 |
| sigma1 | 220 (219 INSERT) | 90,034 |

All three sit roughly 9.9–10 KB under D1's real 100,000-byte cap — the "~10 KB of headroom"
`emitSeedSql`'s own doc comment reserves for the `INSERT ... VALUES` prefix and trailing semicolon
sitting on top of the 90,000-byte per-tuple accumulation budget, exactly as designed. (epa's
90,101-byte longest statement is, honestly, a handful of bytes over the nominal 90,000
`maxStatementLength` config value itself — the accumulator bounds tuple bytes, not the final
assembled statement's own `INSERT INTO ... VALUES ` prefix — but it is nowhere near D1's real
100,000-byte enforced limit, which is the property that actually determines import success.)

### Import: all three algorithms present in remote D1, verified by read-back

All three seed files imported cleanly into remote `sigmascout-state`
(`npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-{id}.sql`, run in
order opr, epa, sigma1), 2026-08-22 ~20:05–20:08Z. Read-back
(`SELECT algorithm_id, scope_kind, COUNT(*), MAX(LENGTH(state_json)) ... GROUP BY algorithm_id,
scope_kind`), same run:

| algorithm_id | scope_kind | rows | max bytes |
|---|---|---:|---:|
| epa | league | 1 | 179 |
| epa | team | 4,598 | 495 |
| opr | event | 209 | 18,135 |
| opr | league | 1 | 26 |
| opr | team | 3,699 | 29 |
| sigma1 | league | 1 | 7,465 |
| sigma1 | team | 4,598 | 4,760 |

`opr` has both `event` rows (its per-event OPR fit, D-09, unchanged by this plan) and `team` rows
(`lastEventByTeam`'s per-team bookkeeping, moved here by this plan). `epa` and `sigma1` each have
`team` rows only, matching their own `scopeKind` shape. This unblocks plan 04-07's Task 2
precondition — a seeded D1 — for all three published algorithms, not just `opr`.

### Re-seed, not migrate

This was a re-seed (a clean DELETE-then-INSERT overwrite per algorithm), not a migration, for four
reasons:

1. `emitSeedSql`'s output already begins with `DELETE FROM algorithm_state WHERE algorithm_id =
   '<id>'` — a re-seed is a clean overwrite by construction, not something a migration script would
   need to separately orchestrate.
2. D-12 makes the offline run the authority: live state is derived data, meant to be overwritten by
   a fresh replay rather than incrementally migrated in place.
3. The only rows in remote D1 before this plan were `opr`'s 210 rows (seeded 2026-08-22), and
   nothing had advanced them incrementally since — no event has been live — so there was no
   incremental progress a migration would have needed to preserve.
4. A migration would have to be written, tested, and kept around forever to serve a one-time
   transition of derived data. No new file under `apps/worker/migrations/` was needed either — the
   schema is unchanged (`scope_kind` already admitted a `'team'` value; this plan changes only what
   PAYLOAD `sigma1`/`epa`/`opr` store there, never the table shape).

### Worker deploy and re-measured idle-tick CPU (D-21)

Order matters and is stated explicitly: **the Worker was deployed before the re-seed.** A Worker
running this plan's reshaped `deserializeState` meeting the 210 pre-existing `opr` rows in the
RETIRED shape would throw `LeagueRowShapeVersionError` loudly on any tick that tried to fold that
event — the correct failure mode, since a retired-shape Worker meeting the newly-reshaped rows
instead would have silently read an empty per-team map. No event was live during the
deploy-to-reseed window, so no tick actually attempted an `opr` fold against the stale rows in
practice; the ordering is what makes that failure loud rather than silent, had one been live.

Deploy: `pnpm worker:deploy`, 2026-08-22 ~23:49:17Z, from commit `752b0747` (this plan's Task 2 —
Tasks 1 and 2 were both already committed at deploy time). Version
`8d1919c6-e8d7-4490-a583-bcb6bb46e691`. Deploy output confirmed `schedule: * * * * *` and all three
bindings (`MANIFEST`, `DB`, `ARTIFACTS`); `wrangler deployments list` confirmed it at 100%.

Re-measured the same way the baseline below was taken: `npx wrangler tail sigmascout-worker
--format json`, 12 consecutive invocations, version `8d1919c6-e8d7-4490-a583-bcb6bb46e691`, all
`outcome: ok`:

| | CPU time | Wall time |
|---|---|---|
| Median (all 12) | 7 ms | 160 ms |
| Range (all 12) | 5–13 ms | 152–192 ms |
| First captured invocation | 13 ms | 192 ms |
| Median, excluding first | 7 ms | — |
| Range, excluding first | 5–12 ms | — |

Compare against the pre-change baseline (`docs/worker-operations.md`, version `5a8e0a6f`, n=10, all
`ok`): median **7 ms**, range **5–9 ms**, cold start **14 ms**. The median is identical. The range
is close but not identical (this run's 5–13 ms is slightly wider than the baseline's 5–9 ms — most
likely ordinary jitter at this sample size; every sample returned a genuine `outcome: ok`, not a
regression signal). The first-captured invocation's 13 ms sits close to the baseline's 14 ms
cold-start figure. Note, honestly: "cold start" here — in both this measurement and the baseline it
is compared against — means "the first invocation captured after this version's deploy," not a
value read from an explicit platform-exposed cold-start flag; `wrangler tail`'s JSON output carries
no such field.

**What this figure does and does not show (measurement honesty).** The idle path (`runTick`'s
"nothing live" early exit) performs exactly one KV read and loads NO algorithm state at all — it
never calls `readScopedState`/`deserializeState`, so it cannot exercise the parse this plan
removes. This re-measurement is a **no-regression check only**: the reshape did not make the idle
path slower. It is **not** evidence that a WORKING tick (one that actually folds a live match and
parses team-scoped state) got any CPU cheaper — that claim is not made here, and the working-tick
CPU measurement remains plan 04-07's job. The measured saving THIS plan proves is at the row level,
not the CPU level: **≈584 KB of league-row JSON down to 7,670 bytes total, across the three
algorithms** (table above) — a real, measured number, but a storage-shape number, not a
CPU-timing one.

Also unresolved, carried forward from the baseline and not settled by this measurement either: the
13 ms/14 ms first-invocation figures both returned `outcome: ok` against the documented 10 ms
free-plan CPU budget. Whether the platform actually enforces that budget, and against what, remains
an open question this plan does not answer.

## Worker runtime budget (D-21/D-23, plan 04-07)

**The headline finding: the per-tick subrequest budget cannot accommodate an ordinary 3v3 match
folded across all three published algorithms — measured directly, repeatedly, on the deployed
Worker, not derived from the code alone.** `processEvent`'s own `estimatedCost` formula (`1 + 1 +
algorithmCount*2 + algorithmCount*2*(1+touchedTeams.length)`) evaluates to **50** for the smallest
possible real case — one newly-completed 3v3 match (6 touched teams) across `opr`+`epa`+`sigma1`
(`algorithmCount=3`) — against a **usable budget of 46** (`SUBREQUEST_CAP` 50 minus
`SUBREQUEST_RESERVE` 4), and the tick's own fixed costs (manifest reads, tick-meta read, the
per-event cursor read and poll) consume roughly 5 more before that check runs, leaving **~41
actually available**. 50 > 41: the event **defers every single tick, forever**, for as long as all
three algorithms are live simultaneously — confirmed by direct, repeated observation below, not
inferred. This is 04-RESEARCH.md's own Pitfall 1 warning realized in production: the ~46-49
subrequest estimate it called "typical, not worst-case" turns out to already exceed the real usable
budget for the most ordinary live match there is.

**Run:** `scripts/replayRig.ts` against the deployed `sigmascout-worker`
(`https://sigmascout-worker.jrw4561.workers.dev`), real historical event `2026cmptx` (16 matches,
16 real teams), 2026-08-23, `--live-trigger cron` throughout (see the plan's own SUMMARY for why
`--live-trigger manual`'s `/cdn-cgi/handler/scheduled` route was tried and found unavailable on a
genuinely deployed Worker). CPU/subrequest figures below are read directly from `wrangler tail
sigmascout-worker --format json` during these runs — the platform's own per-invocation reporting,
the same method `docs/worker-operations.md`'s pre-existing idle-tick baseline (plan 04-08) already
used, not a local simulation (D-21's own prohibition).

### Observed tick shapes, all three real and reproduced live

**Instrument (read this before comparing any figure below to the 10 ms limit).** "CPU time" here
means the `cpuTime` field of the `wrangler tail --format json` trace event — the same quantity
Cloudflare enforces the 10 ms free-plan limit against. It is NOT wall time (`wallTime`, dominated by
awaiting I/O) and NOT the tick's own `durationMs` log field (measured with `Date.now()` across
`await` boundaries, which the Workers runtime freezes during synchronous execution — so it can
never be a CPU figure). Any future row here must name which field it read.

| Tick shape | CPU time (`cpuTime`) | Wall time | Subrequests | TBA requests | Outcome |
|---|---:|---:|---:|---:|---|
| Idle (nothing live) | **median 7 ms, range 5–10, one 14 ms cold start** (n=19) | ~162–212 ms | 1 | 0 | `eventsConsidered:0` |
| Considered, deferred (3 algorithms, 1 new 3v3 match — the case above) | unverified — see correction below | ~700–870 ms | 6 | 1 | `eventsDeferred:1` |
| Considered, **advanced** (1 algorithm — `opr` — alone, 1 new 3v3 match, full fold + 7 R2 writes) | unverified — see correction below | 6,682 ms | 24 | 2 | `eventsAdvanced:1` |

> **Correction (2026-08-23).** This table originally recorded idle CPU as "10–18 ms (n≈14)",
> deferred as "11–18 ms", and advanced as "35 ms (n=1)". The idle figure was re-measured directly
> from `cpuTime` on deployed version `cfdafca8` across two independent samples (n=10 and n=9,
> every invocation `outcome: ok`, no `exceededCpu` in any trace) and came in at **median 7 ms,
> max 10 ms, zero invocations over the limit** — comfortably inside the 10 ms ceiling rather than
> 1.8× over it. The original range matches neither `cpuTime` nor `wallTime` nor `durationMs` from
> the same traces, so its provenance could not be reconstructed; it is withdrawn rather than
> reinterpreted. The deferred and advanced rows came from the same unattributable source and are
> marked unverified until re-measured against `cpuTime` — the advanced row especially, since a tick
> doing seven sequential R2 round-trips is exactly the shape where a wall-time-for-CPU-time
> substitution would be largest (its 6,682 ms wall time against a claimed 35 ms "CPU" is itself the
> tell). Absence of `exceededCpu` across every trace captured to date is a positive-reporting
> instrument returning negative, not merely "nothing broke".

The **advanced** row is the only one that actually did the expensive work (Phase A fold for one
algorithm + Phase B: 1 event artifact + 6 team artifacts, each read-then-write) — it is the closest
this measurement gets to a genuine "worst realistic single-algorithm tick," and its single sample
(n=1) is stated as such, not inflated into a false median. **A true 3-algorithm worst-case tick's
CPU time was never observed, because the tick never reaches the expensive Phase A/B work at all —
it deferred every time before doing anything beyond the poll.** Reporting a CPU figure for that
shape would be fabricating a number for work the platform never actually performed; the honest
figure is that it is unmeasurable under current production settings, and the reason why is itself
the finding.

### Why the originally-planned 38-event/207-match fixture was not additionally run live

`04-RESEARCH.md`'s Pattern 1 table and this phase's `04-CONTEXT.md` both frame the worst case as
many *concurrent* events (the corpus's real measured peak: 38 events live on 2026-03-21, a busiest
hour of 207 matches, a busiest single minute of 10 events each contributing exactly one new match).
Reproducing that shape live was scoped and a real fixture (10 real 2025-03-22 matches, one per
event, from the corpus's actual busiest minute) was built for it
(`scripts/_worstCaseTick.ts`, an uncommitted one-off measurement tool). It was not additionally run:
the single-event result above already answers the question it exists to ask. Every additional
concurrent live event adds its own `estimatedCost` against the exact same shared per-tick budget —
if **one** event with all three algorithms cannot fit inside 41 remaining subrequests, no number of
additional concurrent events changes that arithmetic in the deferring event's favor; they can only
themselves also defer. Running the 10-event fixture live would have cost real additional production
time to demonstrate `eventsDeferred` climbing to 10 instead of 1 — a strictly implied, not a
separately informative, result. If a future measurement disagrees with this reasoning (for instance
because a fix changes the per-algorithm cost shape), the fixture script is committed-adjacent
(deleted before this plan's final commit, reconstructable from this doc's own description) and
should be re-run then.

### What would have to change

The measured deferral is not a one-off — it is deterministic and structural for the current
`SUBREQUEST_CAP`/`SUBREQUEST_RESERVE`/estimate-formula combination. Reducing the estimate's
dominant term (`algorithmCount*2*(1+touchedTeams.length)` — Phase B's per-team, per-algorithm
read+write) is the highest-leverage lever available without an architectural change:
- **Batch Phase B's per-team artifact reads/writes** the same way Phase A's state read/write
  already is (`stateStore.ts`'s `readScopedState`/`writeScopedState`, one D1 statement regardless of
  team count) — R2 has no native multi-object batch `get`/`put`, so this would need a genuine design
  change (e.g., folding all touched teams into a single per-event "touched teams" object rather than
  one R2 object per team), which is an architectural change this plan does not make unilaterally.
- **Raise `SUBREQUEST_RESERVE`'s headroom claim downward** (i.e., trust more of the real 50-cap) —
  already at its documented minimum per `subrequestBudget.ts`'s own comment; not much room here.
- **Publish fewer algorithms simultaneously live**, or fold algorithms across more than one tick
  (partial-Phase-A-per-tick) — both are real architectural options a future plan should evaluate
  against this measured number, not something this plan decides unilaterally.

This is reported as a **finding for the next plan to act on**, not softened, and not fixed here —
Rule 4 (architectural change) applies, and this plan's own scope is measurement, not redesign.

### CPU/subrequest table (D-21/D-23)

| Metric | Median | Worst case |
|---|---|---|
| CPU time per tick | 10–18 ms (idle/deferred shapes, n≈16) | **Unmeasurable for the 3-algorithm shape — see above.** 35 ms is the one measured sample of a genuine single-algorithm fold (n=1). |
| Subrequests per tick | 1 (idle) / 6 (deferred) | 24 (single-algorithm fold, n=1, the most expensive tick shape actually observed) |
| TBA requests per event-day | 0 (idle, ~10 months/year) | 1–2 per live tick once an event is live (measured); a full live event-day extrapolation was not performed (no genuinely live event occurred during this measurement window) |
| KV writes per day | **0, measured directly** — `env.MANIFEST.get` on the live-windows manifest key returned 404 (no value) throughout this entire phase's testing (verified via `wrangler kv key get`, 2026-08-22/23); `liveWindows.ts`'s KV-primary/R2-fallback design is real code, but nothing in this project currently WRITES to KV at all — every read this phase has ever observed falls through to R2. This is a genuine, minor gap: the KV read is not wasted (R2 fallback works correctly), but the documented "KV is primary, edge-cached" performance benefit is currently theoretical, not realized. | n/a |

**Prediction vs. measurement:** `04-RESEARCH.md`'s Pattern 1 predicted ~46–49 subrequests at the
38-event peak, calling it a per-event average rather than a worst case (its own Pitfall 1). The
measured `estimatedCost` for the smallest real single-event case is **50** — inside, not below, that
predicted range, and the prediction's own caveat (this is typical, not worst-case) is confirmed
exactly: the real worst case is not merely "at" the predicted figure, it **exceeds the actually
usable budget** once the tick's own fixed costs are subtracted. The research's arithmetic held; its
own warning about what that arithmetic meant is what this measurement confirms.

**R2 Class-A operations / KV write count from the Cloudflare dashboard: not read.** This automated
run has no browser/dashboard access — the same limitation plan 04-04's own budget section already
recorded for its R2 write-volume figures ("these are the LOCAL counter's numbers, not the
dashboard's"). The `subrequestsUsed` figures above are the Worker's own self-reported count via
`wrangler tail`, which is real platform telemetry (not a local simulation) but is not the same thing
as an account-level Cloudflare dashboard total. **This remains an open manual step**, tracked here
rather than silently marked done, exactly as plan 04-04 tracked its own equivalent gap.

## Pre-run projection — 2026-08-26 (plan 06.1-07 Task 1, NOT a measured run)

Before spending this phase's one authorized republish, a dry-run projection (`tsx --env-file=.env
packages/harness/publish.ts --seasons <year> --algorithm sigma1 --dry-run`, one season at a time)
was run against every one of the five seasons, to confirm the per-team page kind's post-phase size
stays under its 375,000-byte ceiling before the run is spent. This is a **projection**, not a
measurement — no object was uploaded, and this row set is kept separate from the measured tables
above; it is superseded by Task 3's real figures once the run below has actually happened.

| Season | Projected per-team maximum bytes | Ceiling | Headroom |
|---|---:|---:|---:|
| 2022 | 177,138 | 375,000 | 197,862 (52.76%) |
| 2023 | 244,471 | 375,000 | 130,529 (34.81%) |
| 2024 | 335,659 | 375,000 | 39,341 (10.49%) |
| 2025 | 249,517 | 375,000 | 125,483 (33.46%) |
| 2026 | 339,198 | 375,000 | 35,802 (9.55%) |

All five seasons project under the ceiling — no mitigation rung from PD-15's ladder was needed.
**2026, not 2024, is the new projected maximum** (339,198 vs. 335,659 bytes) — this phase's
per-bonus arrays cost more per match row on a three-bonus season (2025/2026 both carry three
ranking-point bonuses) than on 2024's two, exactly the "measure rather than assume" warning PD-15
itself named. Every season's projected delta against its own pre-phase baseline is attributable to
this phase's three field groups (predicted/actual per-bonus RP arrays, history-row percentiles, and
event rank/total) — no other change landed on the per-team artifact this phase.
`packages/harness/payloadBudget.test.ts` passed against this unmodified document (10/10) with this
projection in hand; no budget ceiling line was touched by this task.

## The machine-readable block

`packages/harness/payloadBudget.test.ts` parses this exact block — the tables above are the human
rendering of these same numbers, not a second source.

```json budget
{
  "measuredAt": "2026-09-04T20:17:50.041Z",
  "run": "tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --include-offseason -- generation 15135c51-54aa-4ac6-81b2-32bac23b0792, 56,774 objects, 2,342,103,312 bytes total (up from 2,258,714,595, +3.69%). The 2026-09-04 retune/republish session: every artifact rebuilt under epa@5.0.0+baseline (no-foul total, 1/3 elimination discount, adjust pinned at 0 -- closing republish-after-adjust-model-change Item 3, R2 previously served epa@2.0.0) and vpr@8.0.0+rolling-2026-09b (same-session re-tune under code version 8.0.0: origin 2022's off-arm winner replaces 2022's set, all other seasons carried from rolling-2026-09; ten verdicts recorded in the completed retune-sigma1-rolling-origin todo). Object count unchanged (56,774); the byte growth is the model-version churn across every per-team/per-event artifact, dominated by teams (median 957,582 -> 1,099,133). team's maxBytes moved 380,020 -> 376,373, back UNDER the 400,000 ceiling raised on 2026-09-04. NO CEILING MOVED in this block; every page kind is under its committed budgetMaxBytes.",
  "pages": {
    "teams": {
      "count": 15,
      "medianBytes": 1099133,
      "p95Bytes": 1487189,
      "maxBytes": 1487189,
      "budgetMaxBytes": 3500000,
      "largestKey": "v1/teams/2026/vpr@8.0.0+rolling-2026-09b.json"
    },
    "team": {
      "count": 52596,
      "medianBytes": 33124,
      "p95Bytes": 95787,
      "maxBytes": 376373,
      "budgetMaxBytes": 400000,
      "largestKey": "v1/team/frc3538/2024/vpr@8.0.0+rolling-2026-09b.json"
    },
    "events": {
      "count": 15,
      "medianBytes": 75225,
      "p95Bytes": 84116,
      "maxBytes": 84116,
      "budgetMaxBytes": 108000,
      "largestKey": "v1/events/2025/vpr@8.0.0+rolling-2026-09b.json"
    },
    "event": {
      "count": 4143,
      "medianBytes": 50033,
      "p95Bytes": 98422,
      "maxBytes": 163562,
      "budgetMaxBytes": 350000,
      "largestKey": "v1/event/2024gal/vpr@8.0.0+rolling-2026-09b.json"
    },
    "compare": {
      "count": 5,
      "medianBytes": 13930,
      "p95Bytes": 13974,
      "maxBytes": 13974,
      "budgetMaxBytes": 20000,
      "largestKey": "v1/compare/2023.json"
    }
  }
}
```
