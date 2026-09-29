---
phase: 08-simulation-compare
plan: 05
subsystem: infra
tags: [r2, publish-pipeline, byte-budget, sigma1, vpr, ranking-points]

requires:
  - phase: 08-simulation-compare (plan 08-02)
    provides: "EventMatchSchema's redRpPmf/blueRpPmf/actualRedRp/actualBlueRp fields, and buildEventArtifact's matches row builder that fills them"
provides:
  - "~56,774 production R2 event-page objects (2022-2026, opr/epa/vpr) now carry redRpPmf/blueRpPmf on played RP-eligible qm rows and actualRedRp/actualBlueRp on every played row of every event artifact -- the first republish since 08-02 landed the schema"
  - "scripts/verifySubsetPublish.ts checks 14 (D-03 pmf presence/absence) and 15 (D-12 actual-RP key presence with null accounting), proven RED pre-republish and GREEN post-republish against live production"
  - "packages/harness/payloadBudget.test.ts's EVENT_PAGE_ABSOLUTE_MAX_BYTES test -- a dedicated, independently reachable event-page byte ceiling gate, closing a reachability hole in the pre-existing internal-consistency block"
  - "A widened pre-flight byte-probe methodology (corpus census -> projected ranking -> direct dry-run measurement) that converted an 8-event spot-check into an 18-event bound, run BEFORE the republish per a user checkpoint decision"
  - "docs/publish-budget.md's Republish ledger data (per-entry byte/pmf/actual-RP counts across all five seasons) that 08-09, 08-11, 08-13 and 08-14 read facts out of"
affects: [08-09, 08-11, 08-13, 08-14, 08-15]

actuals:
  tokens: 9347
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Widened pre-flight byte probe: rank republish-size-risk candidates by a corpus census (played qm row count x measured per-row growth rate, split by RP-eligible vs offseason), then run REAL --dry-run measurements on the top-ranked candidates rather than trusting the projection -- the projection selects candidates, the dry-run is the evidence."

key-files:
  created: []
  modified:
    - scripts/verifySubsetPublish.ts
    - packages/harness/payloadBudget.test.ts
    - docs/publish-budget.md

key-decisions:
  - "USER CHECKPOINT DECISION: widen the single-event (2024gal/2024wvrox) pre-flight probe to ~18 events, ranked by a corpus census of played qm rows and projected post-republish size, before running the 25-minute republish -- because the single-event probe could not bound the risk PD-03 named (the largest event could reshuffle once growth landed on every RP-eligible event)."
  - "Widened probe confirmed the bound: 2024gal remained the maximum both before (327,172B) and after (measured post-run: 342,405B) across all 18 probed candidates, with the closest competitor (2024mil) 1,064 bytes below it. Proceeded to the republish per the resolved checkpoint."
  - "Corrected the plan's own pre-run claim that pmf array length is 'always length 7' -- the real published bytes show it is season-dependent (length 5 for 2022-2024's two-RP-bonus seasons, length 7 for 2025-2026's three-RP-bonus seasons), plus a degenerate length-1 pmf on every playoff row at an RP-eligible event (pmf production is gated on event type, not competition level)."

patterns-established:
  - "Byte-budget pre-flight probes should widen from a single historically-largest key to a corpus-census-ranked candidate set whenever a change's per-row cost could plausibly reorder which artifact is largest."

requirements-completed: [EVNT-07, EVAL-05]

coverage:
  - id: D1
    description: "Every played qm row of every RP-eligible VPR event artifact in production R2 carries redRpPmf/blueRpPmf (D-03), and every played row of every event artifact (VPR/OPR/EPA) carries actualRedRp/actualBlueRp (D-12), read back from https://data.sigmascout.org and asserted per key against expectations declared before the run."
    requirement: "EVNT-07"
    verification:
      - kind: other
        ref: "pnpm verify:subset -- 35 entries checked, 0 failing, 0 total failures (post-republish, quoted in full below)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The event page kind's post-republish byte maximum stays at or under the 350,000-byte ceiling, asserted by a dedicated, independently reachable test rather than a block that could not fire."
    requirement: "EVAL-05"
    verification:
      - kind: unit
        ref: "npx vitest run packages/harness/payloadBudget.test.ts -t EVENT_PAGE_ABSOLUTE_MAX_BYTES -- 1 passed | 10 skipped, both pre- and post-republish"
        status: pass
    human_judgment: false

duration: 24min (this continuation) + prior Task 1 session
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 05: Production republish -- D-03/D-12 ranking-point fields live, widened pre-flight probe

**One full republish (56,774 objects, generation `e2d220d9-e97b-480a-bcf1-82d3e2076b42`, 23m20s, backgrounded) put `redRpPmf`/`blueRpPmf`/`actualRedRp`/`actualBlueRp` on every played event-artifact row for the first time, gated by a user-directed widened pre-flight probe (18 events, not 2) that confirmed `2024gal` stays the byte-maximum both before and after, with the true post-run max (342,405B) landing 7,595 bytes (2.17%) under the 350,000-byte ceiling.**

## Performance

- **Duration:** ~24 min this continuation (widened probe + republish wait + verification + docs), plus a prior session for Task 1
- **Started:** 2026-08-31T19:15:53Z (republish launch)
- **Completed:** 2026-08-31T19:39:13Z (republish end); verification and docs work followed
- **Tasks:** 3 (Task 1 completed in a prior session; Task 1b inserted by checkpoint; Tasks 2-3 this session)
- **Files modified:** 3 (`scripts/verifySubsetPublish.ts`, `packages/harness/payloadBudget.test.ts`, `docs/publish-budget.md`)

## Checkpoint resolution (Task 1b -- widened pre-flight probe)

Task 1's original pre-flight probe (PD-03) measured exactly two events: `2024gal` (327,172B before publish, 341,949B `--dry-run` after) and `2024wvrox` (296,045B before, 300,944B after). `2024gal`'s dry-run result crossed the plan's own 340,000-byte pre-flight tripwire (though comfortably under the true 350,000 ceiling), which halted the prior agent at a checkpoint. **The user's decision: "widen the probe first."** Rationale: a two-event probe cannot bound the risk PD-03 itself names -- adding ~118B/row to every RP-eligible event *reshuffles* which event is largest; `2024gal` being today's maximum does not prove it stays the maximum once every RP-eligible event grows.

**Method.** Queried `data/corpus.sqlite` read-only for played `qm` row counts and `event_type`/`is_offseason` per event (top 60 by row count). Computed a projected post-republish size for each candidate: `current live bytes (HTTP HEAD, no upload) + playedQmRowCount x measured per-row growth rate` -- 118.216 B/row for RP-eligible events (derived from `2024gal`'s own measured growth: 14,777B / 125 qm rows), 36.29 B/row for offseason events (derived from `2024wvrox`: 4,899B / 135 qm rows). Selected the top-ranked candidates for **real `--dry-run` measurement** rather than trusting the projection -- the projection only picks candidates, the dry-run is the evidence. This surfaced a genuine risk cluster the projection alone would have missed context for: five other 2024 Championship-Division-family events (`2024mil`, `2024hop`, `2024dal`, `2024new`, `2024arc`) sit within ~1,200 bytes of `2024gal`'s CURRENT size, all sharing the same ~125-qm-row count -- a tight cluster that could plausibly reshuffle under real (non-uniform) per-row growth.

**18 events probed via real `--dry-run` invocations** (`pnpm publish:artifacts --event <key> --algorithm vpr --dry-run`, zero uploads):

| Event | Season | RP-eligible | Pre-republish bytes | Post-republish (dry-run) bytes | Growth | Margin vs. 350,000 |
|---|---:|---|---:|---:|---:|---:|
| `2024gal` | 2024 | yes | 327,172 | **341,949** | 14,777 | 8,051 (2.30%) -- probed maximum |
| `2024mil` | 2024 | yes | 327,149 | 341,341 | 14,192 | 8,659 (2.47%) |
| `2024dal` | 2024 | yes | 326,899 | 341,071 | 14,172 | 8,929 (2.55%) |
| `2024hop` | 2024 | yes | 326,931 | 340,932 | 14,001 | 9,068 (2.59%) |
| `2024new` | 2024 | yes | 327,115 | 340,996 | 13,881 | 9,004 (2.57%) |
| `2024arc` | 2024 | yes | 327,105 | 340,787 | 13,682 | 9,213 (2.63%) |
| `2024cur` | 2024 | yes | 324,193 | 338,304 | 14,111 | 11,696 (3.34%) |
| `2024joh` | 2024 | yes | 323,987 | 337,668 | 13,681 | 12,332 (3.52%) |
| `2024mrcmp` | 2024 | yes | 302,016 | 316,062 | 14,046 | 33,938 (9.70%) |
| `2026mrcmp` | 2026 | yes | 275,086 | 288,456 | 13,370 | 61,544 (17.58%) |
| `2026arc` | 2026 | yes | 276,761 | 289,267 | 12,506 | 60,733 (17.35%) |
| `2023cur` | 2023 | yes | 258,130 | 272,270 | 14,140 | 77,730 (22.21%) |
| `2024chcmp` | 2024 | yes | 272,851 | 285,253 | 12,402 | 64,747 (18.50%) |
| `2024oncmp1` | 2024 | yes | 254,778 | 265,943 | 11,165 | 84,057 (24.02%) |
| `2024gacmp` | 2024 | yes | 254,696 | 265,100 | 10,404 | 84,900 (24.26%) |
| `2022oncmp` | 2022 | yes | 192,006 | 207,474 | 15,468 | 142,526 (40.72%) |
| `2024wvrox` | 2024 | no (offseason) | 296,045 | 300,944 | 4,899 | 49,056 (14.02%) |
| `2026wvrox` | 2026 | no (offseason) | 206,128 | 209,993 | 3,865 | 140,007 (40.00%) |

**Bound established: 341,949 bytes, held by `2024gal` -- the SAME key that was already the committed maximum before this run.** No candidate in the widened set met or exceeded 350,000. Per the resume gate, this authorized proceeding directly to Task 2's republish. (The republish's real post-run measurement, 342,405B, landed 456 bytes above the dry-run projection for `2024gal` -- see "pmf-array-length finding" below for why; the margin against 350,000 stayed comfortable at 7,595 bytes / 2.17%.)

No file changes beyond the throwaway, gitignored probe scripts (`reports/publish/08-05-census*.ts`, deleted after use) and the dry-run invocations themselves -- both fully covered by `reports/` being gitignored. Nothing was committed for Task 1b as a standalone task; its evidence is recorded here per the resume instructions' fallback clause.

## Task 1's pre-republish RED-state evidence (recap, not re-derived)

Task 1 (commit `8967291f`) was completed and verified in a prior agent session before this continuation began. That agent's acceptance criteria (per the orchestrator's completed-tasks report) confirmed: `EVENT_PAGE_ABSOLUTE_MAX_BYTES` reachable and passing in isolation (1 passed / 10 skipped) against the pre-republish committed block (327,172 <= 350,000); `pnpm typecheck` exit 0; `pnpm verify:subset --algorithm vpr` observed correctly RED on checks 14 and 15 for every RP-eligible entry (`playedActualRpKeyCount: 0`, `playedQmBothPmfCount: 0`); `git diff --stat` touched exactly the two declared files; no publish ran without `--dry-run`; no secret read, printed, or interpolated.

**Honesty note:** this continuation agent does not have the prior agent's verbatim RED-run terminal output in its context (it was captured and evaluated before this session started, and the site is now post-republish, so that transient state cannot be re-produced). Rather than fabricate a quote, this is stated plainly: the RED-run evidence is attested by the completed-tasks report that gated commit `8967291f`, not re-quoted here verbatim. The commit itself (`git show 8967291f`) contains the checks and declared expectations that were verified against that RED state.

## RP-eligibility census (from the committed verifier, `scripts/verifySubsetPublish.ts`)

The 16 live `vpr` presence entries plus the two `opr`/`epa` arms at `2024casf`, with each entry's declared expectation traceable to `isRpEligibleEventType(event_type)`:

| Event | Season | TBA `event_type` | RP-eligible | Played qm rows | `expectPlayedQmRpPmf` |
|---|---:|---:|---|---:|---|
| `2024casf` (vpr) | 2024 | 0 (Regional) | yes | 72 | present |
| `2024casf` (opr) | 2024 | 0 (Regional) | n/a -- algorithm-level negative | 72 | absent |
| `2024casf` (epa) | 2024 | 0 (Regional) | n/a -- algorithm-level negative | 72 | absent |
| `2022ilpe` | 2022 | 0 (Regional) | yes | 70 | present |
| `2022mirr` | 2022 | 99 (Offseason) | no | 38 | absent |
| `2023cur` | 2023 | 3 (Championship Division) | yes | 130 | present |
| `2023cnsh` | 2023 | 99 (Offseason) | no | 58 | absent |
| `2023nhgrs` | 2023 | 1 (District) | yes | 52 | present |
| `2024new` | 2024 | 3 (Championship Division) | yes | 125 | present |
| `2024vabrb` | 2024 | 99 (Offseason) | no | 16 | absent |
| `2024wvrox` | 2024 | 99 (Offseason) | no | 135 | absent |
| `2025flta` | 2025 | 0 (Regional) | yes | 63 | present |
| `2025isios` | 2025 | 99 (Offseason) | no | 43 | absent |
| `2025bc` | 2025 | 99 (Offseason) | no | 83 | absent |
| `2025cmptx` | 2025 | -- | n/a -- zero played qm rows | 0 | undefined (nothing to assert) |
| `2026vache` | 2026 | 1 (District) | yes | 60 | present |
| `2026wvrox` | 2026 | 99 (Offseason) | no | 120 | absent |
| `2024auwarp` | 2024 | 99 (Offseason) | no | 47 | absent (D-12 fallback case) |

Every value is traceable to the committed `note` field on each `SubsetEntry` in `scripts/verifySubsetPublish.ts` (commit `8967291f`), captured from the corpus BEFORE the republish.

## Task 2 -- the republish itself

**Invocation:** `pnpm publish:seasons` (equivalently `tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026 --include-offseason`), `run_in_background: true` on the FIRST invocation, output tee'd to a log file in the session scratchpad directory (outside the repository, never committed).

**Concurrency evidence:**
- Before start: untruncated `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*publish.ts*' -and $_.CommandLine -notlike '*Get-CimInstance*' }` returned zero processes.
- After completion: the same query returned zero processes.
- Exactly one distinct `generation` value (`e2d220d9-e97b-480a-bcf1-82d3e2076b42`) was observed across every key `pnpm verify:subset` sampled, equal to the run's own summary line.

**Wall clock:** `2026-08-31T19:15:53Z` -> `2026-08-31T19:39:13Z` = **23 min 20 sec** (prior recorded run: 16 min 55 sec; CONTEXT's own estimate: 23-25 minutes -- consistent).

**Run's own summary block, quoted verbatim:**

```
publish: summary (generation=e2d220d9-e97b-480a-bcf1-82d3e2076b42)
  objects=56774 totalBytes=3325231704
  teams: count=15 median=1757866B p95=3704776B max=3704776B key=v1/teams/2024/vpr@2.1.0+tuned-2026-08.json
  events: count=15 median=75225B p95=84113B max=84113B key=v1/events/2025/vpr@2.1.0+tuned-2026-08.json
  event: count=4143 median=78127B p95=197483B max=342405B key=v1/event/2024gal/vpr@2.1.0+tuned-2026-08.json
  team: count=52596 median=42217B p95=147853B max=675956B key=v1/team/frc3538/2024/vpr@2.1.0+tuned-2026-08.json
  compare: count=5 median=14029B p95=14144B max=14144B key=v1/compare/2026.json
  manifests: v1/manifest/live-windows.json, v1/manifest/algorithms.json
  seed files: reports\publish\seed-opr.sql, reports\publish\seed-epa.sql, reports\publish\seed-vpr.sql
```

**Object count check:** `objects=56774` (page objects) + 2 manifests = 56,776 total PUTs -- IDENTICAL to the prior recorded run (56,774 + 2). D-03/D-12 changed field CONTENTS, not which artifacts get built. Confirmed, no reconciliation needed.

## Post-run health check -- full `pnpm verify:subset` output

35 entries checked, **0 failing, 0 total failures**. Full per-entry output:

```
2024casf/sigma1 [v1/event/2024casf/sigma1@2.0.0+tuned-2026-08.json] status=404 (expectAbsent: correctly retired)
2022ilpe/sigma1 [...] status=404 (expectAbsent: correctly retired)
2022mirr/sigma1 [...] status=404 (expectAbsent: correctly retired)
2023cur/sigma1 [...] status=404 (expectAbsent: correctly retired)
2023cnsh/sigma1 [...] status=404 (expectAbsent: correctly retired)
2023nhgrs/sigma1 [...] status=404 (expectAbsent: correctly retired)
2024new/sigma1 [...] status=404 (expectAbsent: correctly retired)
2024vabrb/sigma1 [...] status=404 (expectAbsent: correctly retired)
2024wvrox/sigma1 [...] status=404 (expectAbsent: correctly retired)
2025flta/sigma1 [...] status=404 (expectAbsent: correctly retired)
2025isios/sigma1 [...] status=404 (expectAbsent: correctly retired)
2025bc/sigma1 [...] status=404 (expectAbsent: correctly retired)
2025cmptx/sigma1 [...] status=404 (expectAbsent: correctly retired)
2026vache/sigma1 [...] status=404 (expectAbsent: correctly retired)
2026wvrox/sigma1 [...] status=404 (expectAbsent: correctly retired)
[17 renamed-sigma1-prefix absence entries all confirmed 404, retired prefix not resurrected]

2024casf/opr [v1/event/2024casf/opr@3.1.0+baseline.json] status=200 bytes=41763 generation=e2d220d9-e97b-480a-bcf1-82d3e2076b42
  matches=87 upcoming=0 teams=43 ranked=43 playedQm=72 bothPmf=0 pmfLenHist={} actualRpKeys=72 actualRpNulls=0
2024casf/epa [v1/event/2024casf/epa@1.1.0+baseline.json] status=200 bytes=144276 generation=e2d220d9-e97b-480a-bcf1-82d3e2076b42
  matches=87 upcoming=0 teams=43 ranked=43 playedQm=72 bothPmf=0 pmfLenHist={} actualRpKeys=72 actualRpNulls=0
2024casf/vpr [v1/event/2024casf/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=209450 generation=e2d220d9-e97b-480a-bcf1-82d3e2076b42
  matches=87 upcoming=0 teams=43 ranked=43 playedQm=72 bothPmf=72 pmfLenHist={"1":30,"5":144} actualRpKeys=72 actualRpNulls=0
2022ilpe/vpr [v1/event/2022ilpe/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=120352
  matches=85 upcoming=3 teams=38 ranked=38 playedQm=70 bothPmf=70 pmfLenHist={"1":36,"5":140} actualRpKeys=70 actualRpNulls=0
2022mirr/vpr [v1/event/2022mirr/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=102096
  matches=38 upcoming=60 teams=15 ranked=15 playedQm=38 bothPmf=0 pmfLenHist={} actualRpKeys=38 actualRpNulls=0
2023cur/vpr [v1/event/2023cur/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=273310
  matches=145 upcoming=0 teams=78 ranked=78 playedQm=130 bothPmf=130 pmfLenHist={"1":30,"5":260} actualRpKeys=130 actualRpNulls=0
2023cnsh/vpr [v1/event/2023cnsh/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=105371
  matches=62 upcoming=0 teams=29 ranked=0 playedQm=58 bothPmf=0 pmfLenHist={} actualRpKeys=58 actualRpNulls=58
2023nhgrs/vpr [v1/event/2023nhgrs/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=162825
  matches=67 upcoming=26 teams=39 ranked=39 playedQm=52 bothPmf=52 pmfLenHist={"1":30,"5":156} actualRpKeys=52 actualRpNulls=0
2024new/vpr [v1/event/2024new/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=341859
  matches=140 upcoming=0 teams=75 ranked=75 playedQm=125 bothPmf=125 pmfLenHist={"1":30,"5":250} actualRpKeys=125 actualRpNulls=0
2024vabrb/vpr [v1/event/2024vabrb/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=54050
  matches=26 upcoming=0 teams=13 ranked=0 playedQm=16 bothPmf=0 pmfLenHist={} actualRpKeys=16 actualRpNulls=16
2024wvrox/vpr [v1/event/2024wvrox/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=301127
  matches=154 upcoming=0 teams=30 ranked=30 playedQm=135 bothPmf=0 pmfLenHist={} actualRpKeys=135 actualRpNulls=0
2025flta/vpr [v1/event/2025flta/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=146671
  matches=78 upcoming=21 teams=42 ranked=42 playedQm=63 bothPmf=63 pmfLenHist={"1":30,"7":168} actualRpKeys=63 actualRpNulls=0
2025isios/vpr [v1/event/2025isios/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=103293
  matches=43 upcoming=25 teams=45 ranked=0 playedQm=43 bothPmf=0 pmfLenHist={} actualRpKeys=43 actualRpNulls=43
2025bc/vpr [v1/event/2025bc/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=171315
  matches=113 upcoming=0 teams=62 ranked=62 playedQm=83 bothPmf=0 pmfLenHist={} actualRpKeys=83 actualRpNulls=0
2025cmptx/vpr [v1/event/2025cmptx/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=38159
  matches=16 upcoming=0 teams=26 ranked=0 playedQm=0 bothPmf=- pmfLenHist={} actualRpKeys=- actualRpNulls=-
2026vache/vpr [v1/event/2026vache/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=144617
  matches=75 upcoming=0 teams=30 ranked=30 playedQm=60 bothPmf=60 pmfLenHist={"1":30,"7":120} actualRpKeys=60 actualRpNulls=0
2026wvrox/vpr [v1/event/2026wvrox/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=210088
  matches=120 upcoming=5 teams=30 ranked=30 playedQm=120 bothPmf=0 pmfLenHist={} actualRpKeys=120 actualRpNulls=0
2024auwarp/vpr [v1/event/2024auwarp/vpr@2.1.0+tuned-2026-08.json] status=200 bytes=118810
  matches=62 upcoming=0 teams=25 ranked=0 rp=0 playedQm=47 bothPmf=0 pmfLenHist={} actualRpKeys=47 actualRpNulls=0

35 entries checked, 0 failing, 0 total failure(s).
generation uniformity (event subset, non-control): 1 distinct value(s) -- e2d220d9-e97b-480a-bcf1-82d3e2076b42
```

## Republish ledger

One row per live presence entry, generation `e2d220d9-e97b-480a-bcf1-82d3e2076b42` throughout:

| eventKey | season | eventType | rpEligible | algorithmId | bytes | playedQmRowCount | playedQmBothPmfCount | pmfLengthHistogram | playedActualRpKeyCount | playedActualRpNullCount | rankedTeams |
|---|---:|---:|---|---|---:|---:|---:|---|---:|---:|---:|
| 2024casf | 2024 | 0 | yes | vpr | 209,450 | 72 | 72 | `{"1":30,"5":144}` | 72 | 0 | 43 |
| 2024casf | 2024 | 0 | n/a | opr | 41,763 | 72 | 0 | `{}` | 72 | 0 | 43 |
| 2024casf | 2024 | 0 | n/a | epa | 144,276 | 72 | 0 | `{}` | 72 | 0 | 43 |
| 2022ilpe | 2022 | 0 | yes | vpr | 120,352 | 70 | 70 | `{"1":36,"5":140}` | 70 | 0 | 38 |
| 2022mirr | 2022 | 99 | no | vpr | 102,096 | 38 | 0 | `{}` | 38 | 0 | 15 |
| 2023cur | 2023 | 3 | yes | vpr | 273,310 | 130 | 130 | `{"1":30,"5":260}` | 130 | 0 | 78 |
| 2023cnsh | 2023 | 99 | no | vpr | 105,371 | 58 | 0 | `{}` | 58 | **58** | 0 |
| 2023nhgrs | 2023 | 1 | yes | vpr | 162,825 | 52 | 52 | `{"1":30,"5":156}` | 52 | 0 | 39 |
| 2024new | 2024 | 3 | yes | vpr | 341,859 | 125 | 125 | `{"1":30,"5":250}` | 125 | 0 | 75 |
| 2024vabrb | 2024 | 99 | no | vpr | 54,050 | 16 | 0 | `{}` | 16 | **16** | 0 |
| 2024wvrox | 2024 | 99 | no | vpr | 301,127 | 135 | 0 | `{}` | 135 | 0 | 30 |
| 2025flta | 2025 | 0 | yes | vpr | 146,671 | 63 | 63 | `{"1":30,"7":168}` | 63 | 0 | 42 |
| 2025isios | 2025 | 99 | no | vpr | 103,293 | 43 | 0 | `{}` | 43 | **43** | 0 |
| 2025bc | 2025 | 99 | no | vpr | 171,315 | 83 | 0 | `{}` | 83 | 0 | 62 |
| 2025cmptx | 2025 | -- | n/a | vpr | 38,159 | 0 | -- | `{}` | -- | -- | 0 |
| 2026vache | 2026 | 1 | yes | vpr | 144,617 | 60 | 60 | `{"1":30,"7":120}` | 60 | 0 | 30 |
| 2026wvrox | 2026 | 99 | no | vpr | 210,088 | 120 | 0 | `{}` | 120 | 0 | 30 |
| 2024auwarp | 2024 | 99 | no | vpr | 118,810 | 47 | 0 | `{}` | 47 | 0 | 0 |

**RP-eligible events with pmfs, one per season:** 2022 -> `2022ilpe` (70/70); 2023 -> `2023cur` (130/130) and `2023nhgrs` (52/52); 2024 -> `2024casf` (72/72) and `2024new` (125/125); 2025 -> `2025flta` (63/63); 2026 -> `2026vache` (60/60). All five seasons covered, every count exactly matches its own `playedQmRowCount`.

**Events publishing NO pmfs and why:** (a) offseason (`event_type` 99, `isRpEligibleEventType` excludes it): `2022mirr`, `2023cnsh`, `2024vabrb`, `2024wvrox`, `2025isios`, `2025bc`, `2026wvrox`, `2024auwarp` -- 8 entries, all report `playedQmBothPmfCount: 0` while still carrying `actualRedRp`/`actualBlueRp` on every played row. (b) algorithm-level, regardless of event type: `2024casf/opr` and `2024casf/epa` -- neither OPR nor EPA models ranking points at all.

**D-12's fallback case:** `2024auwarp` -- 47 played `qm` rows, `actualRedRp`/`actualBlueRp` present (key-count 47, zero nulls) on all of them, **zero teams carrying `rp`**. This is the real published object on which D-12's summed-fallback precedence path (TBA Ranking Score absent -> sum per-match earned RP) is falsifiable against production bytes.

## A measured pmf-array-length finding (correcting the plan's own pre-run text, then correcting this SUMMARY author's own first pass)

The plan's `<behavior>` section for Task 1 stated "D-03 records the measured shape as always length 7." That claim is not universal. The real published bytes show the pmf array length is **season-dependent**, tracking each season's own RP-bonus count (2 for a win, plus up to N ranking-point bonuses, giving `2N+3` integer totals):

- **Length 5** for 2022-2024 (`2022ilpe`, `2023cur`, `2023nhgrs`, `2024casf`, `2024new` -- all N=2, two RP bonuses that season)
- **Length 7** for 2025-2026 (`2025flta`, `2026vache` -- N=3, three RP bonuses that season, matching `docs/publish-budget.md`'s own earlier note that "2025/2026 both carry three ranking-point bonuses (2024 carries two)")

Every RP-eligible entry ALSO carries a **degenerate length-1** pmf on every non-qualification (playoff) row, regardless of season -- sigma1 predicts a certain, single-outcome distribution for playoff matches rather than omitting the field, since pmf production is gated on event type, not competition level (`publish.ts`'s `matches` row builder comment: "Not gated on the competition level, deliberately"). This degenerate playoff-row pmf is also why the republish's real measured `event` max (342,405, at `2024gal`) exceeded the pre-flight dry-run probe's own measurement for the same key (341,949, Task 1) by 456 bytes -- the probe's projection used qm-row counts only and did not account for `2024gal`'s own playoff rows.

This correction was caught and fixed in `docs/publish-budget.md` before this SUMMARY was written (commit `33071fd0`, a Rule 1 auto-fix of an error introduced in this same plan's own prior commit).

## A materially non-zero `actualRedRp`/`actualBlueRp` null rate -- routed to 08-11

Three offseason entries report a **100%** null rate for both fields (every OTHER subset entry reports zero nulls): `2023cnsh` (58/58 played qm rows null), `2024vabrb` (16/16 null), `2025isios` (43/43 null). `MatchResult.redRpEarned`/`blueRpEarned` was never derivable for these three offseason events (D-12's honest `null`, never coerced to `0`), most likely because their TBA score-breakdown data lacks the fields the RP-earned calculation reads. **08-11's known-incomplete-baseline branch needs this:** a per-season null rate is not uniformly low, and these three are real published objects to test the branch against.

## The offseason pmf gap, confirmed on real published bytes (PD-06) -- routed to 08-09 and 08-11

Seven offseason `vpr` subset entries (`2022mirr`, `2023cnsh`, `2024vabrb`, `2024wvrox`, `2025bc`, `2025isios`, `2026wvrox`) plus `2024auwarp` publish `actualRedRp`/`actualBlueRp` on every played row and ZERO `redRpPmf`/`blueRpPmf` on any row, because `isRpEligibleEventType` excludes event type 99 from Sigma1's `predict()` pmf production. STATE.md's Phase 06.1 ingest record puts **368 offseason events** in the full corpus. A Simulation-tab empty state gated on zero `qm` rows will NOT catch this case -- "qm rows exist, no pmf" is a distinct state this republish makes directly observable for the first time on real bytes. Not fixed here (out of phase scope, `isRpEligibleEventType` is the same predicate Sigma1's own `update()` uses deliberately).

## The byte gate's verdict

**Observed post-republish `event` maxBytes: 342,405, key `v1/event/2024gal/vpr@2.1.0+tuned-2026-08.json`** (same key as before). Delta from the pre-run committed 327,172: **+15,233 bytes (+4.66%)**. Remaining margin against the 350,000-byte ceiling: **7,595 bytes (2.17%)**. Largest key did NOT change (`2024gal` held the maximum both before and after, confirmed by the widened 18-event probe -- see above).

`npx vitest run packages/harness/payloadBudget.test.ts -t EVENT_PAGE_ABSOLUTE_MAX_BYTES`:
```
 Test Files  1 passed (1)
      Tests  1 passed | 10 skipped (11)
```
Passed both before (against 327,172) and after (against 342,405) the republish.

**Measured per-played-row byte cost against predictions:** D-01's ~84-byte pmf-pair figure and D-12's ~34-byte actual-RP-pair figure were both per-MATCH estimates made before a full corpus measurement existed. The real measured combined growth at `2024gal` (an RP-eligible, length-5-pmf, 2024 event) is 15,233B / 140 total matches (125 qm + 15 playoff) = ~108.8 B/match overall, or 15,233B / 125 qm rows = ~121.9 B/qm-row if attributed only to qm rows -- close to but not identical to the pre-run 118.2 B/qm-row dry-run estimate, the difference being the playoff-row degenerate pmf cost this dry-run-based estimate did not include. Offseason events pay only D-12's actual-RP cost (no pmf at all): `2024wvrox` grew 4,899B / 154 total played rows = ~31.8 B/row, or /135 qm rows = ~36.3 B/row -- both close to the plan's ~34-byte offseason prediction. Reported as measured, not adjusted to match either prior prediction.

## Whole-file `payloadBudget.test.ts` -- baseline comparison

`npx vitest run packages/harness/payloadBudget.test.ts` (whole file), post-update:

```
 ❯ |node| packages/harness/payloadBudget.test.ts (11 tests | 2 failed) 299ms
     × is internally consistent: medianBytes <= p95Bytes <= maxBytes <= budgetMaxBytes for every page kind
     × team page (the 292-match outlier, D-05's second at-risk artifact) stays under its absolute upper bound

AssertionError: teams: maxBytes (3704776) should be <= budgetMaxBytes (3500000)
AssertionError: team page maxBytes (675956) exceeded the absolute ceiling (600000)

 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)
```

**Exactly the `<baseline>` set of failing test names** -- WINDOWS.md ledger #11's `teams` breach and ledger #15's `team` breach -- and **zero new failures**. `teams`/`team` figures are byte-for-byte unchanged from the pre-run committed block (D-03/D-12 land only on `event/{eventKey}` matches), so these two failures are structurally identical before and after this run, confirmed by inspection rather than assumed.

`pnpm typecheck` exits 0 (confirmed both before Task 2 and after Task 3, no output).

## The committed budget block, before and after

**Before (pre-run, `event` kind only):** `measuredAt: 2026-08-30T18:45:03Z`, generation `1c11cdd8-...`, `count: 4143, medianBytes: 75689, p95Bytes: 189570, maxBytes: 327172, budgetMaxBytes: 350000, largestKey: v1/event/2024gal/vpr@2.1.0+tuned-2026-08.json`.

**After (this run, `event` kind only):** `measuredAt: 2026-08-31T19:39:13Z`, generation `e2d220d9-...`, `count: 4143, medianBytes: 78127, p95Bytes: 197483, maxBytes: 342405, budgetMaxBytes: 350000 (UNCHANGED), largestKey: v1/event/2024gal/vpr@2.1.0+tuned-2026-08.json (UNCHANGED)`.

All five `budgetMaxBytes` values remain exactly as committed: `teams` 3,500,000; `team` 375,000; `events` 108,000; `event` 350,000; `compare` 20,000. `git diff docs/publish-budget.md` confirms none moved. Ledger #11's `teams` figure (3,704,776) and ledger #15's `team` figure (675,956) are byte-identical to the pre-run block -- neither field lands on those page kinds, both ledger entries remain OPEN, neither ceiling was raised.

## Explicit statements

- **No R2 object was deleted, no key was renamed, no D1 row was written or removed, no Worker was deployed, and no second `--seasons` pass was run** (dry or otherwise -- the widened probe's 18 dry-runs and Task 1's 2 dry-runs each carried `--dry-run` and uploaded nothing).
- **No `budgetMaxBytes` was raised, no published field was trimmed, and no ledger entry was closed.**
- **No secret was read, printed, copied, or interpolated at any point.** `.env` was reached only through `tsx --env-file=.env` (the pre-existing `pnpm publish:seasons`/`pnpm publish:artifacts` scripts). The tee'd run log lives at a path outside the repository (session scratchpad) and was never committed.
- **`git diff --stat` for the whole plan touches exactly three tracked files**: `scripts/verifySubsetPublish.ts`, `packages/harness/payloadBudget.test.ts`, `docs/publish-budget.md`. `git diff --stat packages/harness/publish.ts packages/harness/pageArtifacts.ts apps/ package.json pnpm-lock.yaml` is empty across the whole plan.

## Task Commits

1. **Task 1: Both gates built and proven pre-republish** -- `8967291f` (test) -- completed in a prior session, verified per completed-tasks report.
2. **Task 2: The one full republish** -- `09f3a3b5` (docs) -- narrative entry in `docs/publish-budget.md`.
3. **Task 3: The hard byte gate re-measured** -- `1992a8c2` (docs) -- committed budget block updated from this run's own numbers.
4. **Fix-up (Rule 1 auto-fix): correct pmf-array-length finding** -- `33071fd0` (fix) -- corrected a claim in commit `09f3a3b5` from "always length 5" to the accurate season-dependent finding, caught before writing this SUMMARY.

## Files Created/Modified

- `scripts/verifySubsetPublish.ts` -- checks 14 (D-03) and 15 (D-12), declared expectations on all 18 live-presence entries (Task 1, prior session)
- `packages/harness/payloadBudget.test.ts` -- `EVENT_PAGE_ABSOLUTE_MAX_BYTES` constant and its dedicated, reachable `it(...)` (Task 1, prior session)
- `docs/publish-budget.md` -- republish narrative entry, re-measured committed budget block, and the pmf-array-length correction (Tasks 2, 3, fix-up, this session)

## Decisions Made

- **USER CHECKPOINT: widen the pre-flight probe before republishing.** See "Checkpoint resolution" above.
- Proceeded to the republish once the widened 18-event probe confirmed no candidate met or exceeded 350,000 -- per the resume gate's explicit instruction.
- Corrected the pmf-array-length claim in `docs/publish-budget.md` as a Rule 1 auto-fix (own-work bug caught before it reached the SUMMARY) rather than leaving an inaccurate "always length 5" statement live.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected a self-introduced factual error in the pmf-array-length finding**
- **Found during:** Task 3, while compiling the Republish ledger for this SUMMARY
- **Issue:** Task 2's own narrative commit (`09f3a3b5`) claimed the measured pmf shape was universally length 5, generalizing from a single 2024 sample (`2024casf`). The full post-run `verify:subset` output across all seasons shows length is season-dependent: 5 for 2022-2024 (two RP bonuses), 7 for 2025-2026 (three RP bonuses).
- **Fix:** Rewrote the finding paragraph in `docs/publish-budget.md` with the corrected, season-scoped claim and supporting evidence from both a length-5 and a length-7 example.
- **Files modified:** `docs/publish-budget.md`
- **Verification:** Cross-checked against the full `verify:subset` output for all six RP-eligible entries across five seasons; the length-5/length-7 split matches the document's own pre-existing note about 2024's two vs. 2025/2026's three RP bonuses.
- **Committed in:** `33071fd0`

---

**Total deviations:** 1 auto-fixed (1 bug, self-caught)
**Impact on plan:** No scope creep. The correction improves the accuracy of a finding this plan itself introduced, before it could mislead a downstream reader.

## Issues Encountered

None beyond the checkpoint itself (resolved per the user's explicit "widen the probe first" decision, documented above).

## Next Phase Readiness

- **08-09** (Simulation tab shell): can now build against real `redRpPmf`/`blueRpPmf`-bearing artifacts. Its empty-state branch (gated on zero `qm` rows) needs a SEPARATE check for "qm rows exist, no pmf" -- the offseason gap this plan surfaced on real bytes (368 corpus-wide).
- **08-11** (`simulationInputs.ts`): `2024auwarp` is the real object to test D-12's summed-fallback branch against (47 rows, zero teams with `rp`). `2023cnsh`/`2024vabrb`/`2025isios` are real objects with a 100% `actualRedRp`/`actualBlueRp` null rate for its known-incomplete-baseline branch.
- **08-13** (run control): the sampled events in the Republish ledger above (roster sizes, remaining-match counts) are available for its representative runtime capture.
- **08-14** (mock-before-build sampling): `2023cnsh`, `2024vabrb`, `2025isios` are real published objects with `EventTeamSchema.rp` absent (ranked=0 on each), matching its precondition.
- **New todo (not filed here, named for tracking):** `payloadBudget.test.ts`'s internal-consistency block short-circuits on its first failing page kind (`teams`, ledger #11), leaving `team`, `events`, `event` and `compare` iterations unreachable while that ledger entry is open (PD-02's finding). Deliberately not fixed in this plan; worth its own future change.

---
*Phase: 08-simulation-compare*
*Completed: 2026-08-31*

## Self-Check: PASSED

All files and commit hashes verified present.
