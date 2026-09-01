---
phase: 01-data-foundation-evaluation-harness
reviewed: 2026-08-13T00:00:00Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - .env.example
  - .gitignore
  - docs/data/tba-field-recon.md
  - package.json
  - packages/core/algorithms/opr.test.ts
  - packages/core/algorithms/opr.ts
  - packages/core/algorithms/types.ts
  - packages/core/isomorphic.test.ts
  - packages/core/scoring/brier.test.ts
  - packages/core/scoring/brier.ts
  - packages/core/scoring/calibration.test.ts
  - packages/core/scoring/calibration.ts
  - packages/corpus/db.test.ts
  - packages/corpus/db.ts
  - packages/corpus/schema.sql
  - packages/harness/artifact.test.ts
  - packages/harness/artifact.ts
  - packages/harness/cli.ts
  - packages/harness/replay.season.test.ts
  - packages/harness/replay.test.ts
  - packages/harness/replay.ts
  - packages/harness/report.test.ts
  - packages/harness/report.ts
  - packages/harness/score.test.ts
  - packages/harness/score.ts
  - packages/harness/statbotics.ts
  - packages/ingest/cli.ts
  - packages/ingest/normalize.test.ts
  - packages/ingest/normalize.ts
  - packages/ingest/schemas.ts
  - packages/ingest/tbaClient.test.ts
  - packages/ingest/tbaClient.ts
  - pnpm-workspace.yaml
  - scripts/recon-tba-fields.ts
  - scripts/verify-native-module.ts
  - tsconfig.json
  - vitest.config.ts
findings:
  critical: 1
  warning: 6
  info: 3
  total: 10
resolution:
  resolved: 7
  open: 3
  open_ids: [IN-01, IN-02, IN-03]
  resolved_at: 2026-08-20
  note: CR-01 and WR-01 through WR-06 resolved by phase 03.1 (address-phase-1-3-review-warnings-and-doc-drift); IN-01, IN-02, IN-03 remain open by design, out of this phase's scope. status stays issues_found rather than flipping to a resolved value, since the three info findings genuinely remain open -- matches 02-REVIEW.md's identical precedent.
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-08-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 35 (`.env.example` could not be opened — the harness's own sandbox denies reads of `.env*` files; `.gitignore` confirms it is not tracked as a secret carrier, so this is a tooling limitation, not a review gap of concern)
**Status:** issues_found

## Summary

This phase implements the data corpus, ingestion, OPR baseline algorithm, and walk-forward evaluation harness. The engineering discipline is generally high: extensive test coverage, explicit exclusion accounting, secret-scrubbing on artifact/report writes, and a documented rationale for the season-pooled ridge-regularized OPR rewrite. The by-hand algebra check on the Sherman-Morrison/RLS incremental solve (`packages/core/algorithms/opr.ts`) confirms it is mathematically equivalent to the from-scratch ridge solve, as claimed.

However, one finding undermines the phase's own headline guarantee: the walk-forward leak-proofing Proxy (`toLeakProofUpcoming`) can be bypassed with `Object.getOwnPropertyDescriptor`/`Reflect.getOwnPropertyDescriptor`, which returns the real outcome value without throwing — verified empirically (see CR-01). Several other findings identify latent data-integrity and robustness gaps: an unenforced foreign key combined with an inner join that can silently drop matches, no numerical-drift safeguard on the long-running incremental solve, a misconfigured `pnpm-workspace.yaml`, a TOCTOU race in the single-writer lock, and missing input validation on `pRedWin` in the scoring layer.

## Resolution Summary (2026-08-20, phase 03.1 follow-up)

Phase 03.1 (address-phase-1-3-review-warnings-and-doc-drift) closed all six carried-forward Warnings plus CR-01. All findings below now have a per-finding `#### Resolution` subsection appended (original finding text is unchanged):

| Finding | Status | Commit(s) |
|---|---|---|
| CR-01 (critical) | Resolved | `e70b31df` (quick task 260819-2x6) |
| WR-01 (warning) | Resolved | `2b635f20`, `71224de8` (plan 03.1-03) |
| WR-02 (warning) | Resolved | `8dec3a05` (plan 03.1-01, Task 3) |
| WR-03 (warning) | Resolved | `8dec3a05` (plan 03.1-01, Task 3) |
| WR-04 (warning) | Resolved | `12816722` (plan 03.1-01, Task 2) |
| WR-05 (warning) | Resolved | `257939c9`, `ea361568` (plan 03.1-02) |
| WR-06 (warning) | Resolved | `3cfe4ebc` (plan 03.1-01, Task 1) |
| IN-01 (info) | Open, by design | Out of scope for phase 03.1 — not addressed this session |
| IN-02 (info) | Open, by design | Out of scope for phase 03.1 — not addressed this session |
| IN-03 (info) | Open, by design | Out of scope for phase 03.1 — not addressed this session |

A note on commit labeling: several commits above carry a numeric label in their own subject line (e.g. `8dec3a05`'s subject reads `fix(03.1-03): ...`) that does not match the plan that actually produced them. Plan 03.1-01 committed its three tasks using task-numbered commit-message prefixes (`03.1-01`, `03.1-02`, `03.1-03`) rather than its own plan ID, and those prefixes collide with the real, later plan IDs 03.1-02 and 03.1-03. The table above and each finding's own resolution subsection record the correct originating plan explicitly, verified against each plan's own `*-SUMMARY.md`, not inferred from the commit subject's numeric label alone.

## Critical Issues

### CR-01: Walk-forward leak-proofing Proxy can be bypassed via `getOwnPropertyDescriptor`

**File:** `packages/harness/replay.ts:26-37`
**Issue:** `toLeakProofUpcoming` wraps a `MatchResult` in a `Proxy` whose `get` trap throws for any outcome-bearing key. This is the project's stated mechanism for making walk-forward leakage "a runtime fact, not a type-level convention that a cast could bypass" (see the file's header comment and `replay.test.ts`'s "leaky-fake" test, which specifically exercises a cast-based bypass and confirms it's caught).

However, the handler only defines a `get` trap. `Object.getOwnPropertyDescriptor` / `Reflect.getOwnPropertyDescriptor` do not go through `get` — with no `getOwnPropertyDescriptor` trap defined, the Proxy forwards to the real target and returns the actual (leaked) value with no error. Verified directly:

```
$ node -e "
const target = { matchKey: 'm1', redScore: 999 };
const p = new Proxy(target, {
  get(t, prop, receiver) {
    if (prop === 'redScore') throw new Error('Outcome leakage: ' + String(prop));
    return Reflect.get(t, prop, receiver);
  }
});
console.log(p.redScore);                                          // throws, as intended
console.log(Object.getOwnPropertyDescriptor(p, 'redScore').value); // => 999, NOT intercepted
"
direct access threw: Outcome leakage: redScore
getOwnPropertyDescriptor bypass value: 999
```

Any algorithm's `predict()` — buggy or malicious — that reads `Object.getOwnPropertyDescriptor(match, "redScore")?.value` (or the `Reflect` equivalent) obtains the real score with no thrown error and no test currently catches it. This is exactly the class of bug this phase's entire walk-forward guarantee exists to prevent (D-09's headline-accuracy discipline is only meaningful if `predict()` genuinely cannot see the outcome).

**Fix:** Add a `getOwnPropertyDescriptor` trap (and ideally an `ownKeys` trap that omits outcome keys from enumeration) that throws the same `Outcome leakage` error for any outcome key:

```ts
export function toLeakProofUpcoming(result: MatchResult): UpcomingMatch {
  return new Proxy(result, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && OUTCOME_KEYS.has(prop)) {
        throw new Error(`Outcome leakage: attempted to read "${prop}" on match ${target.matchKey} before predict() completed`);
      }
      return Reflect.get(target, prop, receiver);
    },
    getOwnPropertyDescriptor(target, prop) {
      if (typeof prop === "string" && OUTCOME_KEYS.has(prop)) {
        throw new Error(`Outcome leakage: attempted to read "${String(prop)}" on match ${target.matchKey} before predict() completed`);
      }
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
  }) as UpcomingMatch;
}
```

Add a regression test asserting `Object.getOwnPropertyDescriptor(wrapped, "redScore")` also throws, alongside the existing direct-access test in `replay.test.ts`.

#### Resolution (2026-08-20)

**Status: Resolved.** Closed by quick task 260819-2x6, commit `e70b31df` (`docs(quick-260819-2x6): retire stale single-trap docblock claims`), part of a four-commit quick task (`f77757d8`, `807c2a3a`, `e70b31df`, `1eeb43c0`) recorded in STATE.md's Quick Tasks Completed table under `e70b31df`.

The fix added `getOwnPropertyDescriptor` and `ownKeys` traps to `toLeakProofUpcoming`'s Proxy handler (`packages/harness/replay.ts`), closing both the descriptor-read bypass this finding named and a companion key-enumeration bypass the fix went on to close at the same time. This was independently re-derived, not merely trusted from the quick task's own summary: the 2026-08-19 phase re-verification pass ran a standalone probe against the current module, exercising 20+ distinct read surfaces (direct read, `Object.getOwnPropertyDescriptor`, `Reflect.getOwnPropertyDescriptor`, `Reflect.get`, destructuring, prototype-chain read, and every enumeration surface) against a sentinel-loaded `MatchResult`. Every outcome-bearing read now throws a named `Outcome leakage` error or is correctly omitted from enumeration; a sentinel scan across every serializing surface found zero occurrences of any real outcome value. See `01-VERIFICATION.md`'s gap-closure record (ROADMAP Phase 1 success criterion 4) for the full probe.

## Warnings

### WR-01: No numerical-drift safeguard on the long-running Sherman-Morrison/RLS incremental solve

**File:** `packages/core/algorithms/opr.ts:257-404` (`IncrementalInverse.rank1Update`, `applyObservation`)
**Issue:** The by-hand Sherman-Morrison/RLS derivation checks out exactly against `solveRidgeOpr` in exact arithmetic (confirmed by hand: `x_new = x_old + pu*(y - u^T x_old)/denom` is the correct closed form, and `denom = 1 + u^T P u` is provably `> 1` for any nonzero row while `P` stays positive-definite). The equivalence test (`opr.test.ts`'s "incremental solve matches solveRidgeOpr") only exercises 5 matches, however — nowhere near the "~15,000-18,000 played matches per season" / "~100k sequential updates" scale the file's own performance-note comment cites, and which this review's brief specifically calls out as the area needing scrutiny.

Repeated rank-1 updates accumulate floating-point rounding error in `P` over a long sequence with no periodic resynchronization against a fresh solve, no symmetrization step, and no runtime check that `denom` stays comfortably positive. If accumulated error ever pushes `P` out of positive-definiteness for some team combination, `denom` could approach zero or go negative, and `pu[r]/denom` would blow up or invert sign — silently corrupting every rating from that point forward for the rest of the season, with no error raised (this module has no NaN/Infinity guard on the output either).

**Fix:** At minimum, add a season-scale property test (e.g. simulate ~5,000-15,000 synthetic sequential updates across ~1,500-3,700 teams) asserting `state.ratings` stays finite and remains within a documented tolerance of a periodically-refreshed `solveRidgeOpr` batch solve. Consider adding a defensive check in `applyObservation` (e.g. `if (!Number.isFinite(residual) || denom <= 0) throw`) so a numerical breakdown fails loudly instead of silently propagating bad ratings through the rest of a season.

#### Resolution (2026-08-20)

**Status: Resolved.** Fixed in `2b635f20` (`feat(03.1-03): abort incremental OPR solve on numerical breakdown`) and proven at season scale in `71224de8` (`test(03.1-03): prove OPR incremental solve stays finite at season scale`) — plan 03.1-03.

`applyObservation` now throws immediately after computing `residual` and `denom`, before the ratings-vector loop, whenever `residual` is non-finite or `denom <= 0` — naming the offending alliance score, the computed residual, and denom in the thrown message. This is a detect-only guard: no resynchronization or symmetrization was added, and the underlying Sherman-Morrison/RLS arithmetic is unchanged.

A new property test drives 5,000 deterministic synthetic matches across a 400-team pool through `opr.update`, comparing the running incremental state against a fresh `solveRidgeOpr` batch solve at three checkpoints (1,000/3,000/5,000 matches). Every rating stayed finite at every checkpoint; the maximum observed deviation from the batch solve was 4.27e-12 — six orders of magnitude inside the documented `1e-6 * max(1, |batchRating|)` relative tolerance. (Team pool was held at 400 rather than the review's suggested 1,500-3,700, since the drift comparison calls the dense O(n^3) batch solver three times per run; match count was held at the review's own low end of 5,000, since match count — not team count — is the axis floating-point drift actually accumulates along.)

This finding's failure condition (a numerical breakdown in the incremental solve) has never occurred in the real corpus — the guard and the property test are forward-looking safeguards, not repairs. No published OPR rating changed; `packages/harness/digest.test.ts` reproduces every committed digest bitwise.

**Correction (2026-08-20, phase 03.1 code-review gate).** The guard condition quoted above (`residual` non-finite or `denom <= 0`) is the **pre-fix, defective** condition and no longer matches HEAD. Phase 03.1's own code-review gate found it Critical: `NaN <= 0` and `Infinity <= 0` both evaluate to `false` in JS, so a non-finite `denom` walked straight past the throw and then corrupted every entry of `nextRatingsVector` via `pu[r]/denom` — the run aborting one match later, misattributed to an unrelated observation (`03.1-REVIEW.md` CR-01). Widened in `d73d5aba` (`fix(03.1): CR-01 widen OPR breakdown guard to catch non-finite denom`) to `!Number.isFinite(residual) || !Number.isFinite(denom) || denom <= 0`, with a regression test proven red against the pre-fix source. Still detect-only: no rating arithmetic changed, and `packages/harness/digest.test.ts` reproduces every committed digest bitwise. The 5,000-match property test described above predates that fix and never exercised the `denom` path.

### WR-02: `pnpm-workspace.yaml` glob does not match the repository's actual package layout

**File:** `pnpm-workspace.yaml:1-2`
**Issue:** `packages: - "apps/*"` is the only workspace glob, but no `apps/` directory exists anywhere in the repository — every actual package (`packages/core`, `packages/corpus`, `packages/harness`, `packages/ingest`) lives under `packages/*`, none of which have their own `package.json` yet. Currently this is a no-op (there's a single root `package.json` with all dependencies), but it means pnpm's workspace machinery is effectively disconnected from the project's real structure. If a future plan adds a `package.json` under `packages/core` (as the project's own tech-stack doc anticipates — "shared types between pipeline output and client consumption"), pnpm will silently fail to recognize it as a workspace member until this glob is corrected.

**Fix:**
```yaml
packages:
  - "apps/*"
  - "packages/*"
allowBuilds:
  better-sqlite3: true
  esbuild: true
```

#### Resolution (2026-08-20)

**Status: Resolved.** Fixed in `8dec3a05` (`fix(03.1-03): make write-lock acquisition atomic, fix workspace glob`) — plan 03.1-01's Task 3. (The commit's own subject carries the label `03.1-03`; that is a task-numbered prefix from plan 03.1-01's own commit-message convention, not a claim that plan 03.1-03 made this fix — see this file's Resolution Summary for the full explanation of the collision.)

`pnpm-workspace.yaml` now lists `packages/*` alongside `apps/*`, matching this finding's suggested fix exactly. `pnpm install --frozen-lockfile` was confirmed to produce no lockfile change, since no directory under `packages/*` carries its own `package.json` yet — the glob correction is real but currently still a no-op in practice, exactly as this finding anticipated for the "future plan adds a `package.json`" case.

**Correction (2026-08-20, phase 03.1 code-review gate).** The paragraph above is **stale as of HEAD** and no longer describes the tree. Phase 03.1's own code-review gate found that adding `packages/*` did not actually fix anything: no `apps/` directory exists, and no directory under `packages/*` carries its own `package.json`, so the glob still resolved to zero workspace members (`03.1-REVIEW.md` WR-03). In `c09b4b57` (`fix(03.1): WR-03 comment out unmatched pnpm-workspace.yaml package globs`) BOTH the `apps/*` and `packages/*` entries were commented out, with an inline note, so the file states a fact about the present single-root-package repo rather than an aspiration. `allowBuilds` (required by `better-sqlite3` and `esbuild`) remains active and unchanged.

This is a resolution by **redefinition**, and it is recorded as such deliberately rather than presented as a clean close. The original finding's forward-looking concern — that a future `package.json` under `packages/*` would not be recognized — is arguably *reopened* under the commented-out globs, not closed: such a package would now be silently ignored until the globs are uncommented. That is an accepted, recorded trade-off, on the reasoning that converting the four flat subdirectories into genuine workspace members (per-package manifests, dependency rewiring, tsconfig path updates) is a structural change belonging to the planned multi-package split in a later phase, not to a review fix. Whoever performs that split must uncomment these globs as part of it.

**Follow-up (2026-08-20, Phase 4 prep).** That split is now imminent, so the globs were uncommented ahead of it. `pnpm-workspace.yaml` again lists `apps/*` and `packages/*` as live patterns. This resolves the reopened forward-looking risk described in the paragraph above: Phase 4 introduces `apps/worker` as a genuine package, and with the globs commented its `package.json` would have been silently ignored. A directory still only becomes a workspace member once it carries its own `package.json`, so the live globs match zero members today and are harmless until Phase 4 adds one. `pnpm install --frozen-lockfile` verified clean with `pnpm-lock.yaml` unchanged. **This finding is now closed on its original terms, not by redefinition.**

### WR-03: TOCTOU race in the single-writer corpus lock

**File:** `packages/corpus/db.ts:48-60` (`acquireWriteLock`)
**Issue:** `acquireWriteLock` checks `existsSync(lockPath)` and then, if no lock exists (or it's stale), calls `writeFileSync(lockPath, ...)`. These two operations are not atomic. Two processes launched close together (e.g. a scheduled task and a manual run overlapping) can both observe "no lock" and both proceed to write the lock file, defeating the "single-writer lock... fails fast... instead of interleaving writes" guarantee the docstring promises. (SQLite's own WAL + `busy_timeout` will still serialize the actual writes rather than corrupt the file, but the friendly fail-fast error this mechanism exists to provide will not fire, and the two processes' higher-level logic — e.g. two overlapping ingest runs — can still interleave in ways the corpus schema doesn't protect against, such as duplicate/interleaved `ingest_runs` provenance rows.)

**Fix:** Use an atomic exclusive-create write (`writeFileSync(lockPath, String(process.pid), { flag: "wx" })`) and catch `EEXIST` to fall into the existing stale-lock-detection path, rather than checking existence first.

#### Resolution (2026-08-20)

**Status: Resolved.** Fixed in the same commit as WR-02, `8dec3a05` — plan 03.1-01's Task 3.

`acquireWriteLock`'s success path is now a single atomic exclusive-create (`wx`-flag) write attempt, exactly matching this finding's suggested fix, closing the probe-then-write race window entirely. The regression proof needed more than a literal revert-and-rerun: a naive sequential test (pre-write an alive-pid lock file, call `openCorpus`, expect a throw) stays green against the pre-fix code too, because single-threaded JavaScript has no genuine interleaving window without deliberately simulating one. A `vi.mock("node:fs", ...)`-based test that forces the `existsSync` probe to report "absent" while an alive owner's lock file genuinely exists reproduces the race deterministically, and does go red against the pre-fix probe-then-write implementation. This is new test infrastructure for the codebase (no prior `vi.mock`/`vi.spyOn` usage existed) but is scoped entirely to `packages/corpus/db.test.ts`.

**Correction (2026-08-20, phase 03.1 code-review gate).** The paragraph above credits `8dec3a05` with closing this race, which is accurate only for the *no-lock-file fast path*. Phase 03.1's own code-review gate found the *stale-lock reclaim* path still used a plain non-exclusive `writeFileSync`, so two processes both encountering the same crashed-owner lock could both claim it (`03.1-REVIEW.md` WR-01). That residual window was closed separately in `280b1e7e` (`fix(03.1): WR-01 make corpus stale-lock reclaim atomic`), which unlinks the stale lock and retries the same atomic `wx` exclusive-create. This finding is fully resolved only across BOTH commits.

### WR-04: Unenforced `matches.event_key` foreign key + inner join can silently drop matches from the walk-forward corpus

**File:** `packages/corpus/schema.sql:21`, `packages/corpus/db.ts:62-83, 272-329`
**Issue:** `schema.sql` declares `event_key TEXT NOT NULL REFERENCES events(event_key)`, but `openCorpus` never runs `PRAGMA foreign_keys = ON` — SQLite disables FK enforcement by default, so this constraint is decorative only. `selectMatchesChronological` then reads via `FROM matches m JOIN events e ON e.event_key = m.event_key` (an inner join). If any code path ever upserts a match before its event row exists (every current call site in `packages/ingest/cli.ts` and `packages/harness/cli.ts` happens to upsert the event first, so this isn't triggered today), the match would be written successfully with no error, then silently vanish from every chronological/walk-forward query with no warning, log line, or exclusion count — a silent narrowing of the scored population, which is exactly what `packages/harness/score.ts`'s exclusion-accounting design elsewhere in this phase is built to prevent.

**Fix:** Turn on `db.pragma("foreign_keys = ON")` in `openCorpus` so a future ordering bug fails loudly at write time instead of silently at read time; alternatively/additionally, have `selectMatchesChronological` (or a startup check) report a count of matches with no matching event row.

#### Resolution (2026-08-20)

**Status: Resolved.** Fixed in `12816722` (`feat(03.1-02): enforce the event foreign key at corpus open, report quirk populations`) — plan 03.1-01's Task 2. (As with WR-02/WR-03, the commit subject's own numeric label — `03.1-02` — is a task-numbered prefix collision from plan 03.1-01's commit convention, not the originating plan; see this file's Resolution Summary.)

`openCorpus` now sets `PRAGMA foreign_keys = ON`, matching this finding's suggested fix. Two new read functions were also added: `selectOrphanMatchCount`, which `packages/corpus/integrity.test.ts` asserts stays at 0 forever (an always-illegitimate population, since the FK is now enforced at write time), and `selectImputedWinnerCount`, which is reported but never asserted (a legitimate, notable population, not an error) — this asymmetry is deliberate so correct behavior can never turn the suite red. The real corpus has zero orphan matches today — this is a forward-looking guard against a future ordering bug, not a repair, and no published figure changed.

### WR-05: `pRedWin` is never validated before scoring/binning — out-of-range or `NaN` input can throw or silently corrupt results

**File:** `packages/core/scoring/calibration.ts:36-56`, `packages/core/scoring/brier.ts:55-88`
**Issue:** `Prediction.pRedWin` is documented as "in the closed interval [0, 1]" but this is a type comment, not a runtime check, anywhere in the scoring path. Two concrete failure modes:
- `calibrationBins`: `Math.floor(prediction.pRedWin * binCount)` is clamped only on the high side (`Math.min(binCount - 1, ...)`). A negative `pRedWin` (e.g. from a future algorithm bug) produces a negative index, and `accumulators[idx]` is `undefined`, so `bin.predictedSum += ...` throws a `TypeError` rather than failing informatively. `NaN` input produces `Math.min(binCount - 1, NaN) === NaN`, and `accumulators[NaN]` is also `undefined` — same crash.
- `scoreSet`: a `NaN` `pRedWin` silently produces a `NaN` `squaredErrorSum`, and thus a `NaN` `brierScore` — the exact "real, terrible score... and never NaN" failure this module's own header comment says it exists to prevent, just scoped only to the empty-set case rather than to malformed per-prediction input. `winnerAccuracy`'s `prediction.pRedWin > 0.5 ? "red" : "blue"` also silently resolves `NaN` to `"blue"` rather than surfacing the anomaly.

Since these are the modules responsible for the project's headline "measurably better than Statbotics" claim, a malformed prediction should fail loudly rather than either crash unhelpfully or silently corrupt a published Brier score.

**Fix:** Validate `pRedWin` at the entry point of `scoreSet`/`calibrationBins` (or upstream, at `Prediction` construction) and throw a descriptive error for `NaN` or out-of-[0,1] values rather than letting them propagate into either a raw `TypeError` or a silently-wrong published metric.

#### Resolution (2026-08-20)

**Status: Resolved.** Fixed in `257939c9` (`feat(03.1-02): validate pRedWin at every predict() return site (01-REVIEW WR-05, D-05)`) and `ea361568` (`feat(03.1-02): quarantine and bound malformed predictions in the harness (D-06, D-07)`) — plan 03.1-02.

A new dependency-free leaf, `packages/core/scoring/predictionValidity.ts`'s `assertValidPRedWin`, is now called at every algorithm's `predict()` return site (`opr.ts`, `epa.ts`, `sigma1/index.ts`) — closer to "at `Prediction` construction" than this finding's alternate suggestion of validating at the scoring entry point, but the harness gained a matching quarantine at the scoring boundary too: `aggregateScores` now quarantines and counts any malformed prediction (`ExclusionCounts.quarantined`) rather than letting it reach `calibrationBins`/`scoreSet`, bounded by named constants so a run throws rather than publishing a Brier score computed on a materially narrowed population. `brier.ts` and `calibration.ts` themselves are untouched, as intended — they remain the reference the new upstream checks protect.

Writing this check surfaced a real, previously-silent bug: Sigma1's `season-sd` link mode could divide `0/0` into a `NaN` win probability in a genuine cold-start scenario the other two link modes already guarded against. That was fixed with the same degenerate-branch guard the other modes used; neither committed digest was affected, since both are the `predictive-variance` link mode, never `season-sd`.

### WR-06: A played, non-tied match with an empty `winning_alliance` is silently dropped from the corpus

**File:** `packages/ingest/normalize.ts:89-101`
**Issue:** `normalizeMatch` only assigns `winner` when `match.winning_alliance` is `"red"`/`"blue"`, or when scores are exactly equal (the tie fallback). The schema comment (`schemas.ts:54`) notes `winning_alliance` is empty "when the match is unplayed or (rarely) tied" — but does not guarantee it is never empty for a played, non-tied match (a TBA data-quality quirk this project's own docs elsewhere treat as the norm, e.g. the replay/surrogate/DQ handling). If that combination ever occurs, `isPlayed(match)` is `true` (both scores present and non-negative) but `winner` stays `null`, and `selectMatchesChronological`'s `WHERE m.winner IS NOT NULL` filter then silently excludes that match from the entire walk-forward corpus — no log, no exclusion count, no test coverage for this specific combination (existing tests only cover unplayed-empty and tied-empty).

**Fix:** When `played` is true, `winning_alliance` is empty/invalid, and scores differ, derive the winner from the score comparison (`redScore > blueScore ? "red" : "blue"`) rather than leaving it `null`, or at minimum log/count this case explicitly so it isn't a silent loss.

#### Resolution (2026-08-20)

**Status: Resolved.** Fixed in `3cfe4ebc` (`feat(03.1-01): derive winner TBA left empty as a stored corpus fact`) — plan 03.1-01's Task 1.

`normalizeMatch` now derives the winner from a score comparison for a played, non-tied match whose `winning_alliance` TBA leaves empty (or reports as any non-red/blue value), matching this finding's suggested fix exactly. The derivation is recorded as a new, non-recomputed `winner_imputed` column on the match row, rather than a silent value with no trace of how it was produced. No such row exists in the real 2022-2026 corpus today — this is a forward-looking guard, not a repair, and no published figure changed; the local dev corpus was deliberately left un-rebuilt against the new column (see plan 03.1-01's SUMMARY for the exact error message a stale corpus now raises).

## Info

### IN-01: Duplicate team entries within one alliance are handled inconsistently between the batch and incremental solvers

**Status:** resolved — superseded by the demo-team remap work (07): `solveRidgeOpr` now INCREMENTS the design-matrix cell (`M.set(row, idx, M.get(row, idx) + 1)`, opr.ts:228), matching `rank1Update`'s summing, and `demoTeams.ts` documents duplicate pseudo-team slots as deliberate. Both solvers now agree on duplicates. Verified 2026-08-31.

**File:** `packages/core/algorithms/opr.ts:200-207` (`solveRidgeOpr`) vs. `307-330` (`IncrementalInverse.rank1Update`)
**Issue:** `solveRidgeOpr` builds `M` via `M.set(row, idx, 1)`, so a duplicate team key within one `OprObservation.teams` array is idempotent (still contributes 1, not 2). `rank1Update`, by contrast, sums `pu[r] += this.#at(r, c)` and `uPu += pu[c]` over every entry in `indices`, including duplicates, so a duplicate team would be double-counted. Under normal FRC data (exactly 3 distinct teams per alliance, surrogates already deduplicated by `ratingEligibleTeams`) this never triggers, but it means the "mathematically EXACT... identical... to calling `solveRidgeOpr` fresh" claim in the file's performance-note comment would not hold if a duplicate ever slipped through upstream validation. Consider asserting team-uniqueness in `allianceObservation`/`ratingEligibleTeams`, or normalizing both solvers' duplicate-handling to match.

### IN-02: `writeReport` helper has no secret-scrub guard, unlike its sibling inline implementation

**File:** `packages/harness/cli.ts:91-97` vs. `279-287`
**Issue:** `runEventMode` (the path that has a real TBA API key in scope) manually re-implements HTML report writing with an explicit `if (html.includes(apiKey)) throw ...` scrub check rather than calling the shared `writeReport` helper, because `writeReport` has no scrub parameter at all. This is currently safe (`runSeasonsMode`, the only caller of `writeReport`, never touches the API key), but it's a latent trap: if a future change routes an API-key-bearing code path through `writeReport`, nothing would stop a secret from being written to disk. Consider giving `writeReport` the same optional `secretToScrub` parameter `writeArtifact` already has, for defense in depth.

### IN-03: PID-based lock reclaim can misidentify a stale lock as live after PID reuse

**File:** `packages/corpus/db.ts:29-38` (`isProcessAlive`)
**Issue:** `acquireWriteLock` reclaims a lock only when the recorded owner PID is no longer alive. If the OS reuses that PID for an unrelated process before the lock file is cleaned up (more likely on Windows, which recycles PIDs faster than most Unix systems), a legitimate new `openCorpus` call would incorrectly report the corpus as "already open for writing" by a process that has nothing to do with it, blocking a legitimate run until the lock file is manually deleted. Low likelihood for a single-operator hobby tool, but worth a one-line note in the error message suggesting the lock file's recorded PID and a timestamp, so a human debugging the false-positive has enough information to confirm it's stale.

---

_Reviewed: 2026-08-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
