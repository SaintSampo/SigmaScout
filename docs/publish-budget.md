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
resolved here. Two events (`2024orbb`, `2025orbb`) self-reported a non-integer `rp` value that
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
  "measuredAt": "2026-08-28T18:52:38Z",
  "run": "pnpm publish:seasons (tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --include-offseason) -- plan 07-17's D-18 full republish under the renamed vpr@ prefix, generation 47d020a4-1a16-4331-bd70-ce2f468bf2d1, first run in this document to include offseason/preseason matches (20,055 additional played matches, +23.8%)",
  "pages": {
    "teams": {
      "count": 15,
      "medianBytes": 1773535,
      "p95Bytes": 3732955,
      "maxBytes": 3732955,
      "budgetMaxBytes": 3500000,
      "largestKey": "v1/teams/2024/vpr@2.0.0+tuned-2026-08.json"
    },
    "team": {
      "count": 53010,
      "medianBytes": 42381,
      "p95Bytes": 149580,
      "maxBytes": 821938,
      "budgetMaxBytes": 375000,
      "largestKey": "v1/team/frc9999/2024/vpr@2.0.0+tuned-2026-08.json"
    },
    "events": {
      "count": 15,
      "medianBytes": 75225,
      "p95Bytes": 84113,
      "maxBytes": 84113,
      "budgetMaxBytes": 108000,
      "largestKey": "v1/events/2025/vpr@2.0.0+tuned-2026-08.json"
    },
    "event": {
      "count": 4143,
      "medianBytes": 76937,
      "p95Bytes": 189578,
      "maxBytes": 326949,
      "budgetMaxBytes": 350000,
      "largestKey": "v1/event/2024arc/vpr@2.0.0+tuned-2026-08.json"
    },
    "compare": {
      "count": 5,
      "medianBytes": 14045,
      "p95Bytes": 14149,
      "maxBytes": 14149,
      "budgetMaxBytes": 20000,
      "largestKey": "v1/compare/2025.json"
    }
  }
}
```
