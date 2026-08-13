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

## Warnings

### WR-01: No numerical-drift safeguard on the long-running Sherman-Morrison/RLS incremental solve

**File:** `packages/core/algorithms/opr.ts:257-404` (`IncrementalInverse.rank1Update`, `applyObservation`)
**Issue:** The by-hand Sherman-Morrison/RLS derivation checks out exactly against `solveRidgeOpr` in exact arithmetic (confirmed by hand: `x_new = x_old + pu*(y - u^T x_old)/denom` is the correct closed form, and `denom = 1 + u^T P u` is provably `> 1` for any nonzero row while `P` stays positive-definite). The equivalence test (`opr.test.ts`'s "incremental solve matches solveRidgeOpr") only exercises 5 matches, however — nowhere near the "~15,000-18,000 played matches per season" / "~100k sequential updates" scale the file's own performance-note comment cites, and which this review's brief specifically calls out as the area needing scrutiny.

Repeated rank-1 updates accumulate floating-point rounding error in `P` over a long sequence with no periodic resynchronization against a fresh solve, no symmetrization step, and no runtime check that `denom` stays comfortably positive. If accumulated error ever pushes `P` out of positive-definiteness for some team combination, `denom` could approach zero or go negative, and `pu[r]/denom` would blow up or invert sign — silently corrupting every rating from that point forward for the rest of the season, with no error raised (this module has no NaN/Infinity guard on the output either).

**Fix:** At minimum, add a season-scale property test (e.g. simulate ~5,000-15,000 synthetic sequential updates across ~1,500-3,700 teams) asserting `state.ratings` stays finite and remains within a documented tolerance of a periodically-refreshed `solveRidgeOpr` batch solve. Consider adding a defensive check in `applyObservation` (e.g. `if (!Number.isFinite(residual) || denom <= 0) throw`) so a numerical breakdown fails loudly instead of silently propagating bad ratings through the rest of a season.

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

### WR-03: TOCTOU race in the single-writer corpus lock

**File:** `packages/corpus/db.ts:48-60` (`acquireWriteLock`)
**Issue:** `acquireWriteLock` checks `existsSync(lockPath)` and then, if no lock exists (or it's stale), calls `writeFileSync(lockPath, ...)`. These two operations are not atomic. Two processes launched close together (e.g. a scheduled task and a manual run overlapping) can both observe "no lock" and both proceed to write the lock file, defeating the "single-writer lock... fails fast... instead of interleaving writes" guarantee the docstring promises. (SQLite's own WAL + `busy_timeout` will still serialize the actual writes rather than corrupt the file, but the friendly fail-fast error this mechanism exists to provide will not fire, and the two processes' higher-level logic — e.g. two overlapping ingest runs — can still interleave in ways the corpus schema doesn't protect against, such as duplicate/interleaved `ingest_runs` provenance rows.)

**Fix:** Use an atomic exclusive-create write (`writeFileSync(lockPath, String(process.pid), { flag: "wx" })`) and catch `EEXIST` to fall into the existing stale-lock-detection path, rather than checking existence first.

### WR-04: Unenforced `matches.event_key` foreign key + inner join can silently drop matches from the walk-forward corpus

**File:** `packages/corpus/schema.sql:21`, `packages/corpus/db.ts:62-83, 272-329`
**Issue:** `schema.sql` declares `event_key TEXT NOT NULL REFERENCES events(event_key)`, but `openCorpus` never runs `PRAGMA foreign_keys = ON` — SQLite disables FK enforcement by default, so this constraint is decorative only. `selectMatchesChronological` then reads via `FROM matches m JOIN events e ON e.event_key = m.event_key` (an inner join). If any code path ever upserts a match before its event row exists (every current call site in `packages/ingest/cli.ts` and `packages/harness/cli.ts` happens to upsert the event first, so this isn't triggered today), the match would be written successfully with no error, then silently vanish from every chronological/walk-forward query with no warning, log line, or exclusion count — a silent narrowing of the scored population, which is exactly what `packages/harness/score.ts`'s exclusion-accounting design elsewhere in this phase is built to prevent.

**Fix:** Turn on `db.pragma("foreign_keys = ON")` in `openCorpus` so a future ordering bug fails loudly at write time instead of silently at read time; alternatively/additionally, have `selectMatchesChronological` (or a startup check) report a count of matches with no matching event row.

### WR-05: `pRedWin` is never validated before scoring/binning — out-of-range or `NaN` input can throw or silently corrupt results

**File:** `packages/core/scoring/calibration.ts:36-56`, `packages/core/scoring/brier.ts:55-88`
**Issue:** `Prediction.pRedWin` is documented as "in the closed interval [0, 1]" but this is a type comment, not a runtime check, anywhere in the scoring path. Two concrete failure modes:
- `calibrationBins`: `Math.floor(prediction.pRedWin * binCount)` is clamped only on the high side (`Math.min(binCount - 1, ...)`). A negative `pRedWin` (e.g. from a future algorithm bug) produces a negative index, and `accumulators[idx]` is `undefined`, so `bin.predictedSum += ...` throws a `TypeError` rather than failing informatively. `NaN` input produces `Math.min(binCount - 1, NaN) === NaN`, and `accumulators[NaN]` is also `undefined` — same crash.
- `scoreSet`: a `NaN` `pRedWin` silently produces a `NaN` `squaredErrorSum`, and thus a `NaN` `brierScore` — the exact "real, terrible score... and never NaN" failure this module's own header comment says it exists to prevent, just scoped only to the empty-set case rather than to malformed per-prediction input. `winnerAccuracy`'s `prediction.pRedWin > 0.5 ? "red" : "blue"` also silently resolves `NaN` to `"blue"` rather than surfacing the anomaly.

Since these are the modules responsible for the project's headline "measurably better than Statbotics" claim, a malformed prediction should fail loudly rather than either crash unhelpfully or silently corrupt a published Brier score.

**Fix:** Validate `pRedWin` at the entry point of `scoreSet`/`calibrationBins` (or upstream, at `Prediction` construction) and throw a descriptive error for `NaN` or out-of-[0,1] values rather than letting them propagate into either a raw `TypeError` or a silently-wrong published metric.

### WR-06: A played, non-tied match with an empty `winning_alliance` is silently dropped from the corpus

**File:** `packages/ingest/normalize.ts:89-101`
**Issue:** `normalizeMatch` only assigns `winner` when `match.winning_alliance` is `"red"`/`"blue"`, or when scores are exactly equal (the tie fallback). The schema comment (`schemas.ts:54`) notes `winning_alliance` is empty "when the match is unplayed or (rarely) tied" — but does not guarantee it is never empty for a played, non-tied match (a TBA data-quality quirk this project's own docs elsewhere treat as the norm, e.g. the replay/surrogate/DQ handling). If that combination ever occurs, `isPlayed(match)` is `true` (both scores present and non-negative) but `winner` stays `null`, and `selectMatchesChronological`'s `WHERE m.winner IS NOT NULL` filter then silently excludes that match from the entire walk-forward corpus — no log, no exclusion count, no test coverage for this specific combination (existing tests only cover unplayed-empty and tied-empty).

**Fix:** When `played` is true, `winning_alliance` is empty/invalid, and scores differ, derive the winner from the score comparison (`redScore > blueScore ? "red" : "blue"`) rather than leaving it `null`, or at minimum log/count this case explicitly so it isn't a silent loss.

## Info

### IN-01: Duplicate team entries within one alliance are handled inconsistently between the batch and incremental solvers

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
