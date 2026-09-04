# Quick Task 260904-cs1: make cold start positional - Context

**Gathered:** 2026-09-04
**Status:** Ready for planning

<domain>
## Task Boundary

`seasonBoundaryFor` (`packages/harness/seasonBoundary.ts`) decides cold start by **matching a
value**, not by position:

```ts
isColdStart: season === coldStartSeason        // COLD_START_SEASON = 2022
```

That makes the corpus's first season a fact someone must *remember*, and it went stale silently the
moment `extend-corpus-2019-2020` moved the corpus start to 2019. Measured consequence, verified by
direct evaluation 2026-09-04:

```
tune origin 2022, replay [2019, 2020, 2022]
  2019 -> isColdStart false   (index 0 — nothing to carry anyway)
  2020 -> isColdStart false
  2022 -> isColdStart TRUE    <-- state built from 2019+2020 is DISCARDED
```

Every team enters 2022 from the rookie baseline despite two prior seasons sitting in the corpus.
The backfill feeds the search OBJECTIVE but contributes nothing to the STATE the origin is predicted
from.

**Make it positional — `index === 0` is the cold start, by construction — so this cannot go stale
again.**

</domain>

<decisions>
## Implementation Decisions — LOCKED

### D-1 — Positional by construction, not a corrected literal

The number being wrong is the symptom. The mechanism is the defect: a module constant that must
agree with whatever range a caller happens to pass, with nothing enforcing the agreement. Correcting
2022 to 2019 would leave the identical trap for the next corpus change.

`index === 0` is right by construction: the first element of the replay range has no predecessor to
carry from, which is the actual definition of a cold start.

### D-2 — THIS DOES NOT CHANGE THE REPUBLISH. Verified, and it is the reason this can land now.

Measured across every real replay range:

| range | current | positional | |
|---|---|---|---|
| `publish --seasons 2022-2026` | 2022 cold | 2022 cold | **SAME** |
| `harness --seasons 2022-2026` | 2022 cold | 2022 cold | **SAME** |
| `tune origin 2022` `[2019,2020,2022]` | 2022 cold | 2019 cold | DIFFERS |
| `tune origin 2026` `[2019,…,2026]` | 2022 cold | 2019 cold | DIFFERS |

Publishing `2022-2026` starts at index 0 = 2022, which is exactly what the constant says — so the
published figures are byte-identical either way and still match the D-T7 validation, which
cold-started 2022. **Only future tuning replays change.** A test must pin this equivalence, because
it is the whole reason this is safe to land before the re-tune.

### D-3 — The ten recorded verdicts are NOT invalidated by this change, but they ARE superseded by it

They were measured under cold-start-at-2022 and remain internally consistent — the promoted
`rolling-2026-09` params match their own validation. This task does not re-run anything.

But a future re-tune under positional cold start will measure a genuinely different (warmer) replay,
so its numbers will not be comparable to the recorded ten. Say so where the verdicts are recorded,
so nobody diffs the two sets as though they were.

### D-4 — Keep an explicit override, but it must be deliberate

`--cold-start-season` exists and is wired through `cli.ts` (`runSeasons`, :642/:656/:660). Its
documented purpose — "extending the corpus back to 2016 is a flag, not an edit" — is now better
served by positional default. Keep an override path for a caller with a genuine reason, but the
DEFAULT must be positional, and no caller may rely on a module constant matching by coincidence.

If `COLD_START_SEASON` ends up with no remaining honest reader, delete it rather than leaving a
stale literal for someone to find and trust.

### Claude's Discretion

- The exact signature (optional parameter, separate function, or explicit sentinel).
- Whether `COLD_START_SEASON` is deleted or retained with a narrowed doc comment.

</decisions>

<specifics>
## Specific Ideas

**`seasonBoundary.ts`'s own comment currently asserts something FALSE** and must be corrected:

> "Index 0 has no predecessor to read: `season - 1` is kept there as a nominal label, which is safe
> precisely because `isColdStart` will be `true` for that season"

On a 2019-start corpus, index 0 (2019) gets `isColdStart: false` today. It is harmless only by
accident — `carrySeason` is skipped because there is no prior state, not for the reason the comment
gives. Under D-1 the comment becomes true again, which is the point.

**Callers to check:** `cli.ts:656` (`runSeasons`), `tune.ts:422` (`runBoundedSeasons`),
`publish.ts:1605`. All three go through `seasonBoundaryFor`.

**Do NOT** run a tuning search, a promote, a publish, or any re-measurement. A harness run and a
republish are in flight in the orchestrator's hands; this task changes code and tests only.

**Known traps** (project memory): never `timeout <n> pnpm <cmd>`. Run `npx vitest run` from the REPO
ROOT; run `npx tsc --noEmit` separately in `apps/web`. Check `git status --porcelain` first and last.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/todos/pending/cold-start-season-discards-backfill-carry.md` — the filed defect
- `packages/harness/seasonBoundary.ts` — `seasonBoundaryFor` and the now-false comment
- `packages/core/algorithms/breakdown/constants.ts:72` — `COLD_START_SEASON = 2022`
- `.planning/todos/pending/retune-sigma1-rolling-origin.md` — the ten verdicts D-3 concerns

</canonical_refs>
