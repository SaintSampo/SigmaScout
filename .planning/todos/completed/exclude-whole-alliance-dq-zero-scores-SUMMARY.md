---
todo: exclude-whole-alliance-dq-zero-scores
resolves: .planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md
phase: none (standalone fix, developer-directed)
completed: 2026-08-30
status: complete
commits:
  - 613c11aa (feat: thread red_dqs/blue_dqs into MatchResult; add the predicate)
  - 94d7f697 (fix: drop fully-DQ'd zero-score alliance observations; version bumps; regression tests)
  - 45b6997e (chore: re-promote sigma1 2.1.0 versions and re-pin every consumer)
  - 4a81d1cb (docs: record the post-fix republish figures)
---

# Exclude whole-alliance-DQ zero-score observations — Summary

**A whole-alliance disqualification's recorded 0 score is no longer fitted as real robot
performance in OPR/EPA/VPR. `frc4788`'s 2026 published total moved from -1354.13 to 94.03 — a
physically meaningless outlier is gone, corpus-wide negative-total count dropped from 85 to 61,
and partial DQs are proven byte-identical to today's behavior.**

## Treatment chosen, and how it composes with the demo-team predicate

Drop an alliance's own observation when **every rating-eligible team on it is disqualified AND
the recorded score is exactly 0** — `isFullyDqZeroScoreAlliance` (new file,
`packages/core/algorithms/dq.ts`), mirroring `demoTeams.ts`'s `isFullyDemoAlliance` shape exactly
as the todo asked, but with a **deliberately different scope of what gets dropped**:

- `isFullyDemoAlliance` drops the WHOLE MATCH (both alliances) — a real alliance "beating" three
  fictional robots carries no information about the real alliance either.
- `isFullyDqZeroScoreAlliance` drops only the DQ'd-and-zeroed alliance's OWN observation. The
  disqualified alliance's three robots were REAL and physically on the field; only that alliance's
  ruling-driven 0 is meaningless. The opposing alliance's real score is a genuine observation and
  must not be dropped just because its opponent was disqualified. Concretely: every call site feeds
  `[]` as that alliance's rating-eligible team list — the exact same no-op input every algorithm
  already handles for an all-surrogate alliance — which cascades correctly through OPR's design
  matrix, EPA's `applyComponentUpdate`, and Sigma1's `applyAllianceUpdate`/RP fold/league stats/
  `allianceScoreStats`, all via pre-existing, already-tested empty-array branches.

**Composition with demo teams (the todo's own open question) — decided, and stated explicitly in
`dq.ts`'s file header:** both predicates are evaluated over their own team identity.
`isFullyDemoAlliance` runs first, against the RAW (pre-remap) team lists, exactly as before. The
new predicate runs second, against each algorithm's already-remapped/surrogate-filtered
`ratingEligibleTeams(...)` result, compared against the RAW `red_dqs`/`blue_dqs` key lists. A
genuinely mixed alliance (one real DQ'd team beside two demo teammates, score 0) is **not** caught
by the new predicate: `ratingEligibleTeams` remaps the two demo slots to the shared
`DEMO_PSEUDO_TEAM_KEY`, which never appears in a real `dq_team_keys` list, so `.every(...)` against
a DQ set containing only the real team is false — the observation flows through unchanged, exactly
as `demoTeams.ts` already treats a mixed real+demo alliance. This is deliberate, not an oversight:
the measured population this fix targets is explicitly "whole REAL alliance DQ'd" (158
alliance-observations, demo teams already excluded from that count) — a mixed demo+DQ alliance is
a different, unmeasured population this fix does not claim to address.

## The one type change

`MatchResult.redDqs`/`blueDqs` (`packages/core/algorithms/types.ts`) — `readonly string[]`,
required (not optional, matching `redSurrogates`'/`blueSurrogates`' own convention: an empty array
is the honest "no DQ" value). Outcome-bearing (a disqualification is resolved alongside the match
result, not knowable before the match is played), so added to `leakProof.ts`'s `OUTCOME_KEYS` in
the same commit — `UpcomingMatch` never carries it. Populated end-to-end: the corpus already stored
`matches.red_dqs`/`blue_dqs` (`packages/ingest/normalize.ts`, since Phase 3) — the only gap was
`packages/corpus/db.ts`'s `selectMatchesChronological` dropping it on the way out, now fixed.

`opr.ts`'s Open Question 3 comment (and `allianceObservation`'s matching comment) is corrected, not
merely appended to: it now states the narrower, accurate policy — a partial DQ is still NOT
filtered (the original reasoning holds), but `update()` never even calls `allianceObservation` for
the whole-alliance-DQ-zero-score case, where there is no real contribution left to misattribute.

## Guard against the inverse error

A whole-alliance DQ with a NON-zero recorded score (2 of 158 observed in the todo's measured
corpus) is explicitly excluded from the predicate and pinned by a dedicated regression test per
algorithm — that score may describe real play completed before an unrelated ruling, and this fix
only ever targets the "0 that describes a ruling, not a robot" case.

## Regression tests — proven to bite

Nine new tests across `dq.test.ts` (8, the predicate in isolation) plus three per algorithm
(`opr.test.ts`, `epa.test.ts`, `sigma1/sigma1.test.ts`) covering exactly the three cases the todo
named: a fully-DQ'd zero-score alliance is a no-op fold, a partial DQ still contributes
byte-identically to today, and a whole-alliance DQ with a non-zero score is still counted. Each
algorithm-level test was verified locally to **fail** against the pre-fix code (temporarily
restored via `git show HEAD:<file>`, run, then restored) before being committed — not merely
asserted to pass against the fix.

## Version bumps and re-promotion (a fix this project's own conventions required)

`opr.ts`/`epa.ts`/`sigma1`'s `SIGMA1_CODE_VERSION` all bump (`3.0.0`->`3.1.0`, `1.0.0`->`1.1.0`,
`2.0.0`->`2.1.0`) — D-13's own invariant, already this project's stated convention (`opr.ts`'s
prior `2.0.0`->`3.0.0` bump comment), is that one version string never stands for two different
computations. This fix changes computed output for any team that ever appeared on a fully-DQ'd
alliance, so leaving the version strings unchanged would violate that invariant the moment this
code shipped.

Sigma1's bump forced a re-promotion: `digest.test.ts` replays every committed
`data/algorithm-versions/*.json` file through the CURRENT code (there is only one live
implementation, not one frozen per version), so the two committed `vpr@2.0.0+*.json` files became
permanently non-reproducible the instant `SIGMA1_CODE_VERSION` moved. Re-promoted both from their
original search artifacts under `2.1.0` — same params, new digest, since this was a code fix, not
a re-tune (`reports/tune-joint-off.json` for `tuned-2026-08`; a synthetic single-candidate artifact
carrying the old `tracer-check` promotion's own already-valid params for `tracer-check`, since that
2026-08-14 search log predates the adaptation params the current schema requires). Re-pinned every
hardcoded consumer of the old filename: `cli.ts`'s `PROMOTED_VPR_VERSION_PATH`, `manifests.ts`'s
own duplicate, `fixtures/extract-digest-slice.ts`'s default, and the version-literal test
assertions in `opr.test.ts`, `promotedOverrides.test.ts`, `manifests.test.ts`, and
`apps/worker/test/scheduled.test.ts`/`liveAlgorithmTier.test.ts`. Regenerated the committed CI
`digest-slice.json` fixture against the new promotion.

## Republish, verify, re-measure

Full republish: `tsx --env-file=.env packages/harness/publish.ts --seasons 2022-2026
--include-offseason`, ≈16 min 55 sec wall clock (`18:28:08Z`-`18:45:03Z`), generation
`1c11cdd8-720d-479e-a737-fad94c4105a9`. Checked for stray processes before AND after (`tasklist`,
clean 12-process baseline both times — no repeat of plan 07-17's zombie-process incident);
confirmed complete via the log's own final summary line, not exit code alone.

**The frc4788 acceptance test — verified live from the public origin:**

| | Before | After |
|---|---:|---:|
| `v1/team/frc4788/2026/vpr@...json` `total` | -1354.13 | **94.03 ± 9.83** (82.5th percentile) |

**Corpus-wide 2026 `total` distribution** (`v1/teams/2026/vpr@2.1.0+tuned-2026-08.json`, 3,718
teams), live-read:

| | Before | After |
|---|---:|---:|
| Negative totals | 85 | **61** |
| Below -100 | 2 | 2 (same count — now `frc237` -116.93 and `frc6524` -113.58, an ordinary weak-team range, not a DQ artifact) |
| Minimum | -1354.13 (`frc4788`) | **-116.93** (`frc237` — the todo's own "next-worst" team, essentially unchanged from its own pre-fix -113.83) |
| Maximum | 419.08 (`frc1690`) | 419.09 (`frc1690`, noise-level) |

**Partial-DQ spot check:** `frc7163` (three 2026 matches, one teammate DQ'd, never a whole-alliance
zero) publishes 20.34 ± 10.09 (21.5th percentile) — an ordinary below-average rating showing no
sign of having lost real matches, consistent with the regression suite's own byte-identical proof.

**Payload budget movement** — every page kind moved by less than 0.1% (dropped
alliance-observations change computed VALUES, never a published field's shape):

| Page kind | Before (`882249ad-...`) | After (`1c11cdd8-...`) |
|---|---:|---:|
| `teams/{year}` max | 3,705,194 | 3,704,776 (-418 bytes) |
| `team/{teamKey}/{year}` max | 675,943 | 675,956 (+13 bytes) |
| `event/{eventKey}` max | 327,261 | 327,172 (-89 bytes) |
| `compare/{year}` max | 14,133 | 14,144 (+11 bytes) |
| `events/{year}` max | 84,113 | 84,113 (unchanged) |

Both pre-existing ceilings stay crossed by essentially the same margin (`teams/{year}` over
3,500,000; `team/{teamKey}/{year}` over both 375,000 and the 600,000 absolute ceiling) — neither
raised, and `.planning/WINDOWS.md` ledgers #11/#15 had their figures refreshed but stay `open`, per
this todo's explicit instruction not to resolve either as part of this fix.

## Explicit non-goal — confirmed, not run

`.planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md` was NOT run in this
session, per its own sequencing instruction (this fix lands first, so the accuracy record is
re-measured once against the final model rather than repeatedly). This fix is now another
qualifying input to that re-measurement.

## Test baseline

Before: 2065 passed / 3 failed (1 unrelated pre-existing `reviewFrontmatterLint.test.ts` drift, 2
accepted ledgered `payloadBudget.test.ts`) / 1 skipped.
After: 2081 passed / 3 failed (same three, same reasons, `payloadBudget.test.ts` figures
refreshed) / 1 skipped — +16 new tests (`dq.test.ts` x8, plus 2/3/3 new cases in
`opr.test.ts`/`epa.test.ts`/`sigma1.test.ts`), zero regressions. `tsc --noEmit` clean throughout.

## Secrets boundary

No `.env` value was ever rendered to any output stream, log, command, or file in this session —
`tsx --env-file=.env ...` read it itself, per the established pattern.

## Files touched

- `packages/core/algorithms/dq.ts` (new), `dq.test.ts` (new)
- `packages/core/algorithms/types.ts`, `leakProof.ts`
- `packages/corpus/db.ts`
- `packages/core/algorithms/opr.ts`, `opr.test.ts`
- `packages/core/algorithms/epa.ts`, `epa.test.ts`
- `packages/core/algorithms/sigma1/index.ts`, `sigma1/sigma1.test.ts`, `sigma1/params.ts`
- `packages/harness/cli.ts`, `manifests.ts`, `manifests.test.ts`, `promotedOverrides.test.ts`
- `packages/harness/fixtures/extract-digest-slice.ts`, `fixtures/digest-slice.json`
- `data/algorithm-versions/vpr@2.1.0+tracer-check.json` (new), `vpr@2.1.0+tuned-2026-08.json` (new)
  — the two `vpr@2.0.0+*.json` files were retired (`git rm`)
- `apps/worker/test/scheduled.test.ts`, `liveAlgorithmTier.test.ts`
- `docs/publish-budget.md`, `.planning/WINDOWS.md` (ledger #11/#15 figures updated, both left open)
- Fixture-only compile fixes (new required `MatchResult` fields):
  `packages/core/algorithms/breakdown/breakdown.test.ts`, `sigma1/carryover.test.ts`,
  `sigma1/params.test.ts`, `packages/harness/eventRank.tracer.test.ts`, `metricHistory.test.ts`,
  `publish.test.ts`, `publish.tracer.test.ts`, `replay.multiAlgorithm.test.ts`, `replay.test.ts`

## Follow-on

- `.planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md` may now run.
