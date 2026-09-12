---
phase: 09-analytic-ranking-points-browser-side-simulation
plan: 10
subsystem: publish-pipeline
tags: [presim, r2, housekeeping, d-12, budget, republish]
status: complete
requires:
  - "09-01: data/baselines/level1-digest-2026-09.json — the D-12 baseline"
  - "09-07: the three .optional() pmf row fields + top-level rpOutcomeRp this republish must carry"
  - "09-08: the seed-and-deploy obligation, handed forward unrun"
  - "09-09: rung 1 NO-SHIP — the sidecar is the EXISTING priced-schedule shape"
provides:
  - "package.json publish:seasons --presim-from-season 2026 (presim generation re-enabled)"
  - "the presim-flag drift tripwire (packages/harness/publish.test.ts)"
  - "enumeratePresimKeys / PRESIM_KEY_COUNT_BOUNDS / --include-presim (scripts/deleteRetiredAlgorithmObjects.ts)"
  - "the D-12 cross-phase pin (packages/harness/level1Digest.test.ts)"
  - "measured dry-run budget numbers for the one-way republish decision"
affects:
  - "the orchestrator: every R2/D1/deploy/live-fetch step below is handed over unrun"
tech-stack:
  added: []
  patterns: ["edit-in-place drift tripwire", "enumeration under existing guards", "measured-not-projected pre-write rehearsal"]
key-files:
  created: []
  modified:
    - package.json
    - packages/harness/publish.test.ts
    - packages/harness/level1Digest.test.ts
    - scripts/deleteRetiredAlgorithmObjects.ts
    - scripts/deleteRetiredAlgorithmObjects.test.ts
    - docs/simulation-architecture.md
decisions:
  - "Delta A: PROMOTE. Presim sidecars key to a PUBLISHED_ALGORITHM_IDS member; the orphaned vpr objects are DELETED, not aliased. The BPR->SPR display rename is another agent's work and out of scope — the key segment stays `bpr`."
  - "--presim-from-season set to 2026 explicitly rather than deleted: an explicit value is a recorded decision, a deletion is a silent fallback, and the tripwire needs equality to assert."
  - "STOP-AND-REPORT: EPA's version moved 7.0.0 (last recorded live) -> 10.0.0 (what the dry run builds), by a concurrent session's quick tasks. The republish is still correct but is no longer a pure overwrite-in-place; it orphans an EPA generation and needs a separately-authorized version-retirement pass."
  - "D-12's file-immutability criterion was replaced, not waived: the baseline file has three commits, and a 'was it touched' check cannot distinguish a leak from a deliberate foreign change."
metrics:
  duration: ~85 min
  completed: 2026-09-11
actuals:
  tokens: 61000
  tasks: 3 of 7 (4 are network-bound and handed over)
  commits: 3
---

# Phase 09 Plan 10: Re-key and Re-enable the Pre-schedule Sidecar Summary

Presim generation is back on (the sentinel was a **committed** `package.json` argument, not a per-run flag — the phase's own research said otherwise and was wrong), the cleanup tool can finally see the one orphan class it was structurally blind to, and a full network-free dry run produced measured bytes showing both payload ceilings safe — and one unexpected stop-and-report condition.

**Everything that writes to R2, D1, or the Worker is handed to the orchestrator unrun.** This executor's sandbox denies all network Bash.

## What shipped

| Piece | Where |
|---|---|
| `--presim-from-season` moved off the `9999` sentinel to `2026` | `package.json:43` |
| The presim-flag drift tripwire, red state observed | `packages/harness/publish.test.ts` |
| `enumeratePresimKeys`, `PRESIM_KEY_COUNT_BOUNDS`, `--include-presim` | `scripts/deleteRetiredAlgorithmObjects.ts` |
| Five presim enumeration cases (Tests 9-13) | `scripts/deleteRetiredAlgorithmObjects.test.ts` |
| The D-12 cross-phase pin, red state observed | `packages/harness/level1Digest.test.ts` |
| The "generation has been off" correction, naming the real cause | `docs/simulation-architecture.md` |

## Baseline captures

| Check | Value |
|---|---|
| `git rev-parse --git-dir` | `.git` — main working tree, not a worktree. Worktrees correctly disabled. |
| `data/corpus.sqlite` | present, 582,705,152 bytes |
| `data/schedule-templates/` | populated, **1,331** files |
| Full suite (repo root) | **259 files, 5,025 passed, 4 skipped, 0 failed** |
| `npx tsc --noEmit` | clean |
| `npx tsc --noEmit -p apps/web/tsconfig.json` | clean |
| `publish.test.ts` / `cli.seasonsSpec.test.ts` / `deleteRetired…test.ts` | 192 / 22 / 27 |

**The suite is 259 files, not the 167 the plan expected.** The repo grew; 167 is stale. What the number is *for* still holds — a run reporting 77 was started from `apps/web` and does not count. Recorded rather than silently satisfied.

**No pre-existing typecheck error.** The plan and project memory warned of an inherited `packages/corpus/db.ts` URL collision. It is gone at HEAD. Both typechecks are clean, so any new error is genuinely new.

### The correction, verified verbatim at execution time

```
43:    "publish:seasons": "tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2026 --include-offseason --presim-from-season 9999",
```

**The Correction section is TRUE at HEAD. `09-RESEARCH.md`'s Pitfall 1 is wrong.** There *is* a `9999` literal, it *is* committed, and re-enabling presim *is* a code change. Following the research literally would have spent a full ~45-minute R2 write pass, printed no `presim:` line, and left the pre-schedule stop dark behind a green run report.

### Which upstream plans landed

- **09-06** shipped (D-06 collapse landed; one RP model, no selectable surface).
- **09-08** landed as code — but **its seed-and-deploy was never run.** Its own SUMMARY hands the obligation forward: *"Handed to 09-10: the seed-and-deploy obligation… 09-10 owns the phase's one republish, and that republish is the only source of shape-current seed files."* **There is therefore no 09-08 seed date, and the D1 write cap is not at risk from a same-day collision.** Live D1 and the deployed Worker are both still at **shape 11**, with **four** shape bumps outstanding (11→12→13→14→15) that one pass closes.
- **09-09** did **not** ship rung 1. Delta B is `no-change`; concrete schedules remain primary; the sidecar is the existing priced-schedule shape. The dry run confirms this empirically — sidecars measure ~206 KB median, not rung 1's ~2-3 KB.

## Task 1 — presim generation re-enabled

Three greps, all satisfied:

```
grep -c "presim-from-season 9999" package.json        -> 0
grep -o -- "--presim-from-season [0-9]*" package.json -> --presim-from-season 2026   (once)
grep -c -- "--seasons 2016-2020,2022-2026 --include-offseason" package.json -> 1
```

`publish.test.ts` went 192 → **193**, exactly one higher. `cli.seasonsSpec.test.ts` unchanged at 22. Both green.

### The tripwire's red state was OBSERVED

Restoring `9999` produced, verbatim:

```
AssertionError: --presim-from-season is 9999, later than the latest season this same script
publishes (2026). A cutoff above every season in the corpus makes publish.ts's
`season >= preScheduleFromSeason` gate false for EVERY season: the run logs a "below
presim-from-season" skip per season, writes ZERO pre-schedule sidecars, and still reports
success. That is exactly what commit 1a759198's `9999` did for three full publish runs,
leaving the Simulation tab's pre-schedule stop dark site-wide. [...]
expected 9999 to be less than or equal to 2026
```

`package.json` was then restored and verified byte-identical by `diff` against a pre-edit copy. The assertion is a **relation**, not a literal year — the cutoff must be at most the latest season the same script publishes — so both arguments move together and a hardcoded `2026` cannot go stale into a false green.

### Tracer dry run — `presim:` line verbatim

```
npx tsx packages/harness/publish.ts --seasons 2026 --include-offseason \
  --algorithm bpr --presim-from-season 2026 --dry-run
```

```
  presim: count=213 median=206372B p95=355874B max=388735B key=v1/presim/2026mrcmp/bpr@3.0.0+baseline.json
```

- `below presim-from-season` lines for 2026: **0**.
- 42 skips, every reason accounted for: **41** `event_type 99 is not RP-eligible (PD-06)` (offseason, by design) and **1** `no pre-event walk-forward state was captured (PD-04 — the cold-start season's first event)` (an artifact of a single-season run; it does not recur in the full run for this algorithm).
- **Step 4 outcome 1: sidecars generated.** Not the cold-start chain, not a template error.
- No `--env-file`, no credential read, no byte written.

**Delta A proven on a real key, not asserted:** the algorithm segment is `bpr`, a `PUBLISHED_ALGORITHM_IDS` member, written by `preScheduleKey` from the publisher's own `algorithm.id`. The re-key *is* the republish; there is no rename tool to write.

## Task 2 — the cleanup tool can see presim sidecars

TDD: **8 failed / 27 passed** RED, then **35 passed** GREEN. Every pre-existing case survives (`describe` count 13 → 17).

The blindness was structural, not an operational oversight: every key the tool builds goes through `artifactKey`, and the sidecar is deliberately **not** a `PageKind` — it has its own `preScheduleKey` under PD-01. No key the file could construct ever started `v1/presim/`. That is why the 2026-09-10 passes removed every orphaned `vpr` *page* object while the budget log's closing line still reads *"Sim tab still serves the 641 presim sidecars frozen at 2f1a8885."*

Extended **under all existing guards**, none relaxed or bypassed:

- `RefusedLiveAlgorithmIdError` fires on every `PUBLISHED_ALGORITHM_IDS` member, uniform across **both** enumeration paths, asserted against the imported array rather than a hand-typed list.
- `assertKeySegment` over every enumerated key; the `--execute` intent gate (default still deletes nothing); census reporting unchanged.
- Every key built by **calling** `preScheduleKey`. Source assertion holds: excluding comment lines, `grep -c 'v1/presim/'` over the source is **0**.
- No bulk or prefix delete capability added. No guard added inside `preScheduleKey` — this enumeration is exactly the caller that needs it to accept a retired id.

`PRESIM_KEY_COUNT_BOUNDS = {min: 100, max: 20_000}`, sized from **measured** corpus counts: **318** events in 2026 (the only season presim has ever covered), 1,589 in 2022-2026, 2,825 in 2016-2026. Reproduced against the real corpus: **318 keys enumerated**, all under `v1/presim/`, all carrying `vpr@`, and `RefusedLiveAlgorithmIdError` fires for `bpr`.

The band is its own, not a widening of `RETIRED_KEY_COUNT_BOUNDS`, whose min of 15,000 is sized for a full page-key set and would reject every presim enumeration outright.

**The enumeration is a deliberate superset and the two numbers must never be reconciled:** 641 objects observed live at one generation against a 216-object measurement at another, and this plan's own run builds 641 sidecars against 954 (318 × 3) enumerable event-algorithm pairs, because the builder skips non-RP-eligible events, rosters under six, and events with no pricing state. DELETE is idempotent by S3 contract, so an over-enumerated key costs one cheap request; under-enumeration silently leaves orphans.

Two correctness fixes fell out: the band **named** in the log is now the band actually **enforced** (it hardcoded `RETIRED_KEY_COUNT_BOUNDS`), and a presim pass writes its own census/delete filenames so it cannot overwrite the record of the page-key pass it is meant to be evidence *alongside*.

## Task 3 — the pre-write rehearsal, measured

`npx vitest run` (repo root): **259 files, 5,048 passed, 4 skipped, 0 failed.** Both typechecks clean.

### D-12 pre-write gate

`npx vitest run packages/harness/level1Digest.test.ts` — **5 passed** (3 pre-existing + 2 added, see below).

```
✓ re-runs on the recorded 2022 slice and reproduces the committed digest bitwise, for every published algorithm
✓ corpus-derived and fixture-derived slice match lists are identical (fixture is not stale)
✓ mutating a folded prediction's pRedWin makes the digest assertion FAIL; the unmutated recomputation still passes
✓ opr and bpr reproduce the digests 09-01 froze, bitwise — independent of how many times the baseline file has since been re-frozen
✓ the pin is live, not decorative: it is checked against algorithms that are still published and still in the baseline
```

### Full dry-run summary — verbatim

```
publish: summary (generation=4f92a462-e969-4e18-b353-8da4dfde738b)
  objects=108820 totalBytes=4320759778 (dry-run — nothing uploaded)
  teams: count=30 median=913209B p95=1445501B max=1573854B key=v1/teams/2026/epa@10.0.0+baseline.json
  events: count=30 median=68675B p95=84108B max=84109B key=v1/events/2025/epa@10.0.0+baseline.json
  event: count=7341 median=75366B p95=119164B max=272530B key=v1/event/2016micmp/epa@10.0.0+baseline.json
  team: count=101409 median=31305B p95=87608B max=267128B key=v1/team/frc3538/2025/epa@10.0.0+baseline.json
  compare: count=10 median=14854B p95=15264B max=15264B key=v1/compare/2026.json
  presim: count=641 median=206385B p95=355589B max=393507B key=v1/presim/2026mrcmp/opr@4.0.0+baseline.json
  manifests: v1/manifest/live-windows.json, v1/manifest/algorithms.json
  seed files: reports\publish\seed-opr.sql, reports\publish\seed-epa.sql, reports\publish\seed-bpr.sql
```

The `(dry-run — nothing uploaded)` suffix is present, and the command was invoked **without** `--env-file=.env`. Nothing was written anywhere.

### Budget rules — both ceilings SAFE, neither moved

| Kind | Measured max | Committed ceiling | Headroom | Prior (2026-09-10) | Delta | Rule outcome |
|---|---|---|---|---|---|---|
| `compare` | **15,264** | 20,000 | **4,736** | 14,088 | +1,176 | **Proceed.** Under. |
| `event` | **272,530** | 350,000 | **77,470** | 246,054 | +26,476 | **Proceed.** No stop-and-report. |
| `teams` | 1,573,854 | 3,500,000 | 1,926,146 | 1,626,019 | −52,165 | under |
| `team` | 267,128 | 500,000 | 232,872 | 266,417 | +711 | under |
| `events` | 84,109 | 108,000 | 23,891 | 84,108 | +1 | under |

**No ceiling was moved and none needed to be.** The `compare` block was not shrunk; `reliabilityBins` stays on the wire record.

**The 189-byte-headroom warning does not reproduce.** The briefing cited 09-06 measuring `compare` at 19,811/20,000. The full dry run measures **15,264** — 4,736 bytes of headroom. 09-06's figure is not what a full `publish:seasons` produces; the authoritative number is the one above, measured from the exact command the republish will run.

`event` is the one that genuinely mattered: 09-07's three optional pmf arrays land on every `matches` and `upcoming` row of every event artifact, and the largest page was 246,054 before them. They cost **+26,476 bytes** at the max and left 77,470 of headroom. Measured before the write, exactly as intended.

### Presim coverage — all three algorithms, not just BPR

**641 sidecars**, and the largest key is `opr@4.0.0+baseline` — an OPR sidecar, not a BPR one.

| Algorithm | Skips | Sidecars |
|---|---|---|
| `opr` | 42 | **213** |
| `epa` | 41 | **214** |
| `bpr` | 41 | **214** |

Only two distinct skip reasons across all three, 124 skips total: **123** `event_type 99 is not RP-eligible (PD-06)` (offseason) and **1** `no pre-event walk-forward state was captured` — `2026week0`, for `opr` only, the season's first event.

**The expected F8/F9 shape did NOT materialise.** The plan anticipated 404s on `opr`/`epa` with a 200 on `bpr` if the cold-start chain were still live for the other two. It is not live at the presim level: **no skip anywhere in the run cites a Swing-Score, roster-coverage or cold-start gate.** All three algorithms cover 213-214 of 2026's ~214 non-offseason events. This is derived from the dry run and is strong, but Task 5's three live fetches remain the definitive per-id answer.

**Schedule templates:** `ScheduleTemplateMissingError` **0**, `ScheduleTemplateUnavailableError` **0**. The 1,331-file cache covered the whole run — which matters because 09-09 did not ship rung 1, so the legacy schedule-based path is still what runs, and a missing template fails the *whole* publish rather than one event.

### STOP AND REPORT — an algorithm version moved

**This is the plan's Task 3 Step 6 condition, and it fired.**

| id | Last recorded live | Dry run builds | Moved? |
|---|---|---|---|
| `opr` | 4.0.0 | `4.0.0+baseline` | no |
| `epa` | **7.0.0** | **`10.0.0+baseline`** | **YES — 7.0.0 → 10.0.0** |
| `bpr` | 3.0.0 | `3.0.0+baseline` | no |

The "last recorded live" column comes from two committed records that agree — `docs/publish-budget.md`'s 2026-09-10 entry and `docs/simulation-architecture.md`'s live spot check, both reading *"opr 4.0.0 / epa 7.0.0 / bpr 3.0.0"*. **It has not been confirmed against the live manifest, because this executor cannot make network calls.** Confirming it is step 0 of the runbook below.

**Cause, and it is not Phase 9's.** A concurrent session's EPA quick tasks moved the version twice: `3f36e582` (`quick-260911-j2w`, 8.0.0 → 9.0.0) and `57cef7a7` (`quick-260911-l2k`, 9.0.0 → 10.0.0, "the foul term becomes a post-win-probability scalar"). Both are deliberate, committed model work in a different workstream that shares this checkout.

**What it changes.** The plan's scope boundary says: *"No version-retirement delete pass. This republish overwrites in place: the RP layer is level 2 and moves no algorithm codeVersion, so no generation is orphaned by it."* **That premise no longer holds.** The republish is still correct and still pre-authorized — but it is an overwrite-in-place for `opr` and `bpr` and a **write-new** for `epa`, which leaves roughly a third of 108,820 objects orphaned at `epa@7.0.0+baseline`. For scale, the 2026-09-10 pass that retired `epa@6.0.0+baseline` enumerated 36,832 keys.

**This does not block the republish,** but two things follow and neither is this plan's to decide:

1. **Artifacts-before-manifest becomes load-bearing in a stronger sense than usual.** For `opr`/`bpr` a premature manifest would serve stale-but-valid bytes; for `epa` it would advertise version 10.0.0 while *no* 10.0.0 object exists — a 404 on every EPA page site-wide.
2. **A follow-up version-retirement pass for `epa@7.0.0+baseline` is needed,** and it is a **separately authorized routine**. Jacob's 2026-09-11 approval covers *"deleting published R2 presim sidecars, including the orphaned vpr-keyed objects"* — it does not mention an EPA generation, which did not exist as a question when the approval was given. The tool already supports it (`--supersedes-live`, fail-closed against the live manifest) and the 2026-09-10 entry documents the identical pass being run for 6.0.0.

## D-12 — the file-immutability criterion was replaced, not waived

Task 7's criterion was that `git log -- data/baselines/level1-digest-2026-09.json` show exactly one commit, from 09-01. **At HEAD it shows three, and the criterion is not merely unmet — it is unusable.**

```
47df877d  test(09-01)         opr 223a3e0d  epa 2f723c89  bpr ee9acfec
3f36e582  quick-260911-j2w    opr 223a3e0d  epa 2f723c89  bpr ee9acfec
57cef7a7  quick-260911-l2k    opr 223a3e0d  epa b30d7aa5  bpr ee9acfec
```

Both extra commits belong to the concurrent session's EPA workstream, and they are **two genuinely different events that a "was the file touched?" check reports identically**:

- `3f36e582` moved EPA's **version** 8.0.0 → 9.0.0 and left the stream hash alone. **This is exactly the benign-version-drift case the briefing said to expect** — the version string is metadata, the prediction stream is the claim, and the claim did not move.
- `57cef7a7` moved the version 9.0.0 → 10.0.0 **and** the stream hash `2f723c89` → `b30d7aa5`. Level-1 output really did change — deliberately, by a named non-Phase-9 commit that re-froze the baseline in the same commit, which is the correct discipline for an intentional level-1 change.

A proxy that fires identically for "someone deliberately improved EPA" and "the RP layer leaked into level 1" is not a gate. It was replaced with the assertion that carries D-12's actual meaning: **the RP layer moved no level-1 output.**

`opr` and `bpr` are untouched by the EPA workstream, so their streams must reproduce bitwise what 09-01 froze — across the entire phase and through every legitimate re-freeze of the baseline file. The digests are **hardcoded in the test** rather than read from the baseline, and that duplication is the mechanism: a Phase 9 leak moves these hashes and fails the pin even if the baseline were re-frozen in the same breath. `epa` is deliberately *not* pinned to a literal; the existing gate still checks it against whatever the baseline currently records, which is the right check for an algorithm another workstream is actively changing.

**Both new cases are GREEN.** `opr` at `223a3e0d…` and `bpr` at `ee9acfec…` have not moved since 09-01, across 09-02 through 09-10. **D-12 holds.** No Phase 9 plan commit other than 09-01's freeze has ever touched the baseline file.

The pin's red state was observed: corrupting one frozen literal produced the full *"REAL CROSS-LEVEL LEAK / do NOT update the constant to make this pass"* message; the file was then restored byte-identical.

## Deviations from plan

**1. [Rule 2 — missing critical functionality] The D-12 cross-phase pin.** Task 7's file-immutability criterion is unsatisfiable and unusable at HEAD (above). Rather than record a failed criterion, the invariant it was a proxy for is now asserted directly and mechanically in `packages/harness/level1Digest.test.ts` — a file outside `files_modified`. Recorded as a deviation rather than a silent scope stretch. Commit `1c1badde`.

**2. Task 5 Step 6 is a no-op — already landed by 09-08.** `docs/worker-operations.md`'s re-baseline block already names `seed-opr.sql` / `seed-epa.sql` / `seed-bpr.sql`, already states the filenames follow `PUBLISHED_ALGORITHM_IDS` rather than a fixed list, and already carries the BPR-is-displayed-as-SPR caveat. Nothing to correct. Removed from the runbook rather than left as a step that would produce an empty diff.

**3. The baseline suite is 259 files, not 167.** Stale expectation in the plan; recorded rather than quietly satisfied.

**4. The `compare` 189-byte-headroom warning does not reproduce.** Measured 15,264/20,000 (4,736 bytes free), not 19,811/20,000.

**5. The plan's "no version moved" premise is false.** EPA moved 7.0.0 → 10.0.0. Reported, not worked around.

## Scope — nothing out of bounds moved

Files touched across all three commits, as a set:

```
docs/simulation-architecture.md
package.json
packages/harness/level1Digest.test.ts     <- deviation 1
packages/harness/publish.test.ts
scripts/deleteRetiredAlgorithmObjects.test.ts
scripts/deleteRetiredAlgorithmObjects.ts
```

No prediction code, no schema, no Worker, no `apps/web` file, no BPR→SPR rename, no F8/F9 cold-start fix, no `DEFAULT_PRESCHEDULE_FROM_SEASON` change, no `--event` publish.

**Secrets:** no command in this plan read, printed, echoed, or interpolated `.env` or any value from it. Both dry runs were invoked deliberately **without** `--env-file`.

**Concurrent session:** every commit staged explicit paths (`git add -- <path>`). The other session pushed four `quick-260911-r7e` commits on top of mine mid-execution; their `package.json` edit touched `compare:epa-statbotics`, not `publish:seasons`, and their code changes are confined to `scripts/epaVsStatbotics.ts` — a measurement script, not the EPA model — so the dry-run numbers above stand.

---

# Operational steps for the orchestrator

**Every step below requires network and must run from the main context.** None was run by this executor. The `--dry-run` rehearsal above is network-free and is why these numbers are measured rather than projected.

**Secrets rule, restated because these are commands someone types:** load `.env` with `set -a; . ./.env; set +a` and reference variables unexpanded. **Never** `cat`, `echo`, `head`, `Read`, or otherwise render `.env` or any value from it into any output stream — terminal, log, commit message, or planning document. This rule exists because it was broken on this project once and a live R2 key had to be rotated while every git-side protection passed.

**Deploy does not gate on tests.** Nothing in the publish path runs the suite. The green suite recorded above is the only thing standing between a red repo and a live overwrite.

## Step 0 — CONFIRM THE VERSION MOVE BEFORE ANYTHING ELSE

```bash
curl -s "https://data.sigmascout.org/v1/manifest/algorithms.json?cb=$(date +%s)" | python -m json.tool
```

Read the **body**, not the status. Record the `generation` string and each `{id}@{version}`.

- If `epa` reads **7.0.0** (or anything below 10.0.0): the move is confirmed. The republish is still correct, but it is **not** a pure overwrite-in-place, and an EPA generation will be orphaned. Decide — **this is a decision, not a step** — whether to run the follow-up version-retirement pass in Step 8, which is **separately authorized** and not covered by the 2026-09-11 presim approval.
- If `epa` already reads **10.0.0**: someone published since 2026-09-10; re-read the whole situation before proceeding.

Save this generation string. It is the control that makes a stale read detectable afterwards.

## Step 1 — the publish (~45 min)

```bash
set -a; . ./.env; set +a
pnpm publish:seasons > reports/09-10-publish-$(date +%Y%m%d-%H%M).log 2>&1 &
```

`pnpm publish:seasons` is the right command **because Task 1 fixed it** — invoking the CLI directly would bypass the fix's own proof.

Monitor by the log's **size and mtime**. A quiet log is not proof a run died — this project has paid for that lesson twice. Do **not** wrap in `timeout <n> pnpm <cmd>`: it swallows all output and exits 0. Judge by printed output.

**On success it prints** a `publish: summary (generation=…)` block with **no** `(dry-run …)` suffix, matching the dry-run table above:

```
objects=108820 ... compare max=15264 ... event max=272530
presim: count=641 ... key=v1/presim/2026mrcmp/opr@4.0.0+baseline.json
seed files: reports/publish/seed-opr.sql, seed-epa.sql, seed-bpr.sql
```

**Stop and report if:** `presim: count=` is 0 or absent (the fix did not take); `event max` exceeds 350,000; a `ScheduleTemplateMissingError` is thrown (whole run fails — run `pnpm fetch:schedule-templates` and re-run).

If the session restarts mid-run the process keeps going — re-establish ground truth from the output file and the live manifest before any tail step.

## Step 2 — the manifest (only after Step 1 succeeds)

```bash
pnpm manifest:algorithms
```

**Artifacts before manifest, always.** The browser resolves an object's key from the manifest's advertised version. This is load-bearing here in a stronger sense than usual: a premature manifest advertises `epa@10.0.0` while no 10.0.0 object exists, which is a 404 on **every EPA page site-wide**, not merely a stale read.

`publishSeasons` also writes this manifest at the end of its own run, so the step is idempotent rather than strictly required. Run it anyway, as the skill and every prior run do, and record that both paths agree.

## Step 3 — verify by CONTENT, never by status

A 200 proves nothing about which generation is live. Fetch cache-busted and assert on the **parsed body**.

```bash
CB=$(date +%s)
for U in \
  "v1/manifest/algorithms.json" \
  "v1/compare/2026.json" \
  "v1/event/2026mrcmp/bpr@3.0.0+baseline.json" ; do
  echo "=== $U ==="
  curl -s "https://data.sigmascout.org/$U?cb=$CB" | head -c 400; echo
done
```

| Assert | What proves it |
|---|---|
| Manifest `generation` **differs** from Step 0's | an unchanged generation is a stale read, not a completed publish |
| Manifest names `opr@4.0.0`, `epa@10.0.0`, `bpr@3.0.0` | matches what the dry run built |
| `v1/compare/2026.json` carries the new generation **and** 09-01's RP calibration block | record the block's **actual key name** — its absence means the scorecard shipped as code and never as data |
| A 2026 event artifact carries `matchOutcomePmf`, `redBonusRpPmf`, `blueBonusRpPmf` on a row **and** top-level `rpOutcomeRp` | **this is the check that closes 09-07's window.** Record the field names **as found**, not yes/no |

### Presim coverage — three ids, one event, three statuses

```bash
CB=$(date +%s)
for A in "opr@4.0.0+baseline" "epa@10.0.0+baseline" "bpr@3.0.0+baseline"; do
  echo -n "$A -> "
  curl -s -o /dev/null -w "%{http_code}\n" "https://data.sigmascout.org/v1/presim/2026mrcmp/$A.json?cb=$CB"
done
```

**The dry run predicts 200 on all three** — it produced 213/214/214 sidecars respectively, and `2026mrcmp` is covered for every id. This contradicts the plan's expectation of 404s on `opr`/`epa`; if all three return 200, **the F8/F9 cold-start chain does not gate presim** and that is a measured live fact worth handing to whoever owns F8/F9.

Then fetch one body and **parse it under the shipped `PreScheduleArtifactSchema`** (the priced-schedule shape — 09-09 shipped no-ship). A sidecar that 200s but does not parse is worse than one that 404s: it renders as an error state on a tab whose correct behaviour for absence is a quiet fallback. Confirm its `generation` equals the new one.

## Step 4 — subset verification

```bash
pnpm verify:subset
```

Expect **0 failing entries** and generation uniformity **1** at the NEW generation. Record the entry count. A nonzero failing count is stop-and-report, not something to absorb.

## Step 5 — transcribe the budget BY HAND

**`publish:seasons` prints its summary and does NOT write `docs/publish-budget.md`.** The budget tests stay green against a doc describing a run that no longer exists until someone types it in. Three edits, all from the run's own printed output:

1. A **new dated run entry at the top**, in the format of the two entries above it: command, generation, object count, total bytes, wall clock, what shipped, what was verified by content, what the tail steps did.
2. The **`json budget` block re-transcribed** (`measuredAt`, a `run` string naming the full command, and every per-kind `count`/`medianBytes`/`p95Bytes`/`maxBytes`/`largestKey`). **Leave every `budgetMaxBytes` unchanged** — nothing in this run justifies moving one, and the dry run shows all five kinds comfortably under.
3. A **NEW dated presim table** beneath the 2026-09-06 one. **Do not edit the 2026-09-06 table** — it is a measurement record of a real run. Keep presim **out** of the machine-readable block: it is not a `PageKind`, carries no `budgetMaxBytes` gate and no `pages.presim` row.

The `run` string should say plainly that this run re-enabled presim (641 sidecars, first non-zero count since commit `1a759198`) and that it ships EPA at 10.0.0, superseding the live 7.0.0.

```bash
npx vitest run packages/harness/payloadBudget.test.ts   # must be green after transcription
```

`git diff docs/publish-budget.md` must show **no deletion of any prior dated record** — additions and the block replacement only.

## Step 6 — seed D1, then deploy the Worker

**This is 09-08's obligation, handed forward and still unrun.** Live D1 and the deployed Worker are both at **shape 11**, with four bumps outstanding (11→12→13→14→15). One pass closes all four.

```bash
set -a; . ./.env; set +a
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-opr.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-epa.sql
npx wrangler d1 execute sigmascout-state --remote --file reports/publish/seed-bpr.sql
pnpm worker:deploy
```

- **Order is load-bearing: seed all three FIRST, deploy second.** Seeding without deploying breaks live folding exactly as badly as deploying without seeding; there is no safe intermediate state and the recovery from either is the other command.
- **Auth:** `d1 execute --remote --file` rejects OAuth with **error code 10000**. The account id must come from the loaded environment — without echoing, printing, or interpolating any value.
- **Write cap:** ~4 seed passes/day trips D1's 100k row-write cap. **This is three passes and 09-08's seed never ran, so there is no same-day collision** — the cap is not at risk. It is benign in September regardless; it would not be during a live event.
- **On success:** each `d1 execute` prints a row-count summary and no error; `worker:deploy` prints an upload line and a bindings list including `env.LIVE_ALGORITHM_IDS ("bpr")`.

Read back per file and confirm all three algorithms report the **new** generation. Skipping this leaves the Worker folding forward from a generation the site no longer serves — a measured ~4-hour divergence on 2026-09-10.

**Consider first:** `.planning/todos/pending/sigma-beliefs-absent-from-d1-seed.md` (filed by 09-08) is a three-line mirror that is cheap to land *before* a seed, and this is the event that makes it live. Otherwise BPR's live bands compute from the flat prior until the Worker's own ticks catch up. 09-08 flagged it as a decision to take alongside the seed.

## Step 7 — delete the orphaned `vpr` presim sidecars

**Pre-authorized** (Jacob, 2026-09-11). **Precondition: Step 3 proved at least one published-id sidecar live by content.** The replacement must be reachable before the orphan is removed.

```bash
set -a; . ./.env; set +a

# 7a. PRE-CENSUS — no --execute, deletes nothing.
npx tsx --env-file=.env scripts/deleteRetiredAlgorithmObjects.ts \
  --include-presim --retired-id vpr --version 10.0.0+rolling-2026-09d --seasons 2026

# 7b. DELETE.
npx tsx --env-file=.env scripts/deleteRetiredAlgorithmObjects.ts \
  --include-presim --retired-id vpr --version 10.0.0+rolling-2026-09d --seasons 2026 --execute

# 7c. POST-CENSUS.
npx tsx --env-file=.env scripts/deleteRetiredAlgorithmObjects.ts \
  --include-presim --retired-id vpr --version 10.0.0+rolling-2026-09d --seasons 2026
```

- Enumeration is **318 keys** (measured against the real corpus), band `[100, 20000]`.
- **The census is the evidence; the exit code is not.** DELETE is idempotent by S3 contract and a 404 counts as success, so the tool is structurally unable to testify about its own effect from its exit code. Expect a **nonzero** pre-census and **0 of N** post-census.
- **If the pre-census shows 200s under a version not in the list, add it and re-census.** 641 objects observed live against a 216-object measurement for one generation is exactly the signal that the orphans span more than one retired version. `--version` is repeatable.
- If transient R2 500s interrupt, **re-run to resume** — the idempotent property is designed for this and was exercised on 2026-09-10 (three attempts to completion).
- **A nonzero post-census is stop-and-report.** Either the enumeration missed keys or the census is not observing the origin, and the second possibility is fatal to every absence proof the tool makes.

**Live spot check, by content:**

```bash
CB=$(date +%s)
curl -s -o /dev/null -w "orphan -> %{http_code}\n" \
  "https://data.sigmascout.org/v1/presim/2026mrcmp/vpr@10.0.0+rolling-2026-09d.json?cb=$CB"
curl -s -w "\n" "https://data.sigmascout.org/v1/presim/2026mrcmp/bpr@3.0.0+baseline.json?cb=$CB" | head -c 200
```

Expect **404** on the orphan and **200 with the new generation in the body** on its published-id replacement. One pair of fetches showing the swap actually happened.

Record the delete pass in the run entry from Step 5, in the format of the prior entries' delete-pass sections: versions removed, keys enumerated, ranges, post-census result, live spot check. **State plainly that this is the first delete pass to cover presim sidecars, and why the earlier passes could not** — the tool built every key through `artifactKey`, and the sidecar is deliberately not a `PageKind`.

## Step 8 — DECISION, not a step: the orphaned EPA generation

Only if Step 0 confirmed `epa` was live at 7.0.0. Roughly 36,000 `epa@7.0.0+baseline` page objects are orphaned by this republish.

**This is separately authorized and Jacob's to approve.** The 2026-09-11 approval covers presim sidecars and says nothing about an EPA generation, which was not a question when it was given. The tool supports it and the routine is proven (the 2026-09-10 entry documents the identical pass for `epa@6.0.0+baseline`, 36,832 keys, post-census 0/60 on both ranges):

```bash
npx tsx --env-file=.env scripts/deleteRetiredAlgorithmObjects.ts \
  --supersedes-live --retired-id epa --version 7.0.0+baseline --seasons 2016-2020
# ... and again for --seasons 2022-2026
```

`--supersedes-live` fetches the live manifest at run time and **fails closed** — it refuses if the manifest still names `epa@7.0.0` as published, so it cannot run before Step 2 lands. Leaving the generation in place costs only storage against the 10 GB free tier and is a legitimate choice.

## Step 9 — close the phase

```bash
npx vitest run packages/harness/level1Digest.test.ts   # D-12, the closing record
npx vitest run                                          # 259 files, 0 failures
npx tsc --noEmit && npx tsc --noEmit -p apps/web/tsconfig.json
```

Then update the ROADMAP's Phase 9 row. **Commit with explicit paths only** (`git add -- <path>`) — this is a shared checkout and commit `f0c7af48` absorbed a foreign session's edits exactly that way. Run `git status --short` before every commit; `.planning/quick/260911-r7e-*/` belongs to the other session.

---

## Handoffs

| # | Handoff | Owner | State |
|---|---|---|---|
| 1 | **`09-RESEARCH.md` Pitfall 1 is wrong**, and so is the phase outline's `### 09-10` section. Both state there is no `9999` literal and that re-enabling is "a republish command, not a code change." There was one, in `package.json`. Believing it costs a 45-minute wasted write pass and a silently sidecar-free publish. | recorded in `docs/simulation-architecture.md` and this SUMMARY | **corrected in a document later readers will trust** |
| 2 | **EPA moved 7.0.0 → 10.0.0**, invalidating the plan's "no generation is orphaned" premise. Needs a live-manifest confirmation (Step 0) and a separately-authorized retirement pass (Step 8). | **Jacob** — authorization; orchestrator — confirmation | **open, reported not decided** |
| 3 | **Per-algorithm presim coverage.** The dry run says all three ids produce sidecars (213/214/214) and **no skip cites a cold-start gate**. If Step 3's three live fetches confirm 200/200/200, F8/F9 does **not** gate presim. | whoever picks up F8/F9 | measured offline; live confirmation pending Step 3 |
| 4 | **Widening `--presim-from-season` did NOT become cheap.** 09-09 shipped no-ship, so sidecars are the priced-schedule shape at **206 KB median / 393 KB max**, not rung 1's 2-3 KB. Covering earlier seasons would cost ~200 KB × ~300 events per season. **Recommendation: leave at 2026.** Recorded, not acted on. | future run | closed for now |
| 5 | **D-16's caveats** are moot for this republish — rung 1 did not ship, nothing field-averaged is published, and no caveat copy is owed anywhere. | n/a | closed |
| 6 | **D1 re-seed + Worker deploy are still unrun**, inherited from 09-08. Shape 11 live, four bumps outstanding. No cap risk (09-08's seed never ran). `sigma-beliefs-absent-from-d1-seed.md` is a cheap fix to land first. | orchestrator (Step 6) | **open** |
| 7 | **Task 5 Step 6 was a no-op** — 09-08 already corrected `docs/worker-operations.md`. Removed from the runbook rather than left as an empty-diff step. | n/a | closed |
| 8 | **`docs/publish-budget.md` transcription is a manual step** that nothing automates, and `payloadBudget.test.ts` is the only thing that notices it was skipped. | orchestrator (Step 5) | **open** |

## Known stubs

None. No stub, placeholder, TODO, or unwired component was introduced. No test was skipped and no `<verify>` went unrun within this executor's sandbox; the four network-bound tasks are handed over in full above rather than stubbed or faked.
