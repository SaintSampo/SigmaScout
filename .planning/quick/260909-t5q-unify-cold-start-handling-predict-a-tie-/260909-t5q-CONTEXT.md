# Quick Task 260909-t5q: Unify cold-start handling — predict a tie when all 6 robots are unseen - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Task Boundary

Unify how OPR, EPA, and BPR handle one structural edge case: a match in which all six
robots have never been seen before. Today each algorithm improvises. After this task:

1. All three algorithms emit the same answer for such a match — a tie (`pRedWin === 0.5`).
2. The match is excluded from every accuracy report (winner accuracy AND Brier), counted
   in a new, visible exclusion bucket rather than silently dropped.
3. The Call column shows a new neutral glyph meaning "tie called — not scored", distinct
   from the existing ✓/✗.
4. The comparison methodology post documents the rule.

2016 is the corpus's first season, so it carries by far the most of these matches.
</domain>

<decisions>
## Implementation Decisions

### Definition of "unseen" — corpus-global first appearance
A team is unseen iff it has **zero prior PLAYED matches anywhere in the ingested corpus**,
strictly before the match being predicted, evaluated walk-forward (predict-before-update).

The gate is **algorithm-independent** — one shared predicate, consulted identically by OPR,
EPA, and BPR. This is the whole point of "unify": the excluded set must be the same for all
three algorithms so Compare's coverage rows keep agreeing across them.

Explicitly REJECTED:
- *Per-algorithm state* ("has MY state store rated this team?"). OPR is event-scoped, so this
  would flag every event's opening matches across all ten seasons and produce a DIFFERENT
  exclusion set per algorithm — the opposite of unification.
- *Season-global first appearance*. Would flag every season's week-1 openers, not just 2016.

### Exclusion scope — both winner accuracy and Brier
The match leaves the scored population entirely. It never enters `scoredCount`. It is counted
in a new `coldStart` key on `exclusionCounts` (`packages/harness/score.ts`), alongside the
existing `offseason` / `surrogateAffected` / `missingResult` / `quarantined`, and surfaces in
the Compare Data Coverage table like the others.

This preserves the existing "MUST NOT silently narrow the scored population" rule: the matches
are visible and counted, just not scored. A forced-0.5 guess must not be scored against an
outcome it had no information to predict.

Note this INTENTIONALLY diverges from the D-Q3 no-call contract (quick task 260901-is2), which
counts a `pRedWin === 0.5` no-call as a miss inside the accuracy denominator. D-Q3 governs a
prediction that *happens* to land on 0.5 with information available. This task governs a
STRUCTURAL class where no information exists at all. Two different situations — the new rule
must key off the structural cold-start flag, NOT off `pRedWin === 0.5`, so an ordinary no-call
keeps its D-Q3 treatment.

### Tie symbol — em dash `—`
Reads as "no call made / not scored" and is visually neutral, so it does not compete with ✓/✗
for attention. Rendered in the Call column of BOTH `apps/web/src/components/event/EventMatchTable.tsx`
and `apps/web/src/components/team/MatchTable.tsx`, with an accessible label distinct from the
existing "Prediction correct" / "Prediction incorrect".

Out of scope: how an ACTUAL tie renders. Today `row.actualWinner === "tie"` renders ✗. That is a
separate concern and stays as-is unless raised separately.

### Republish — deferred, not part of this task
Land code + tests + methodology doc only. Published R2 artifacts keep their current values until
a separate republish is triggered. The task MUST report what a republish would change.

### Claude's Discretion
- Where the shared cold-start predicate physically lives (a leaf in `packages/core/`, consistent
  with how `predictionValidity.ts` is hoisted as one shared implementation rather than three).
- How the flag is threaded to the harness — most likely a new boolean on
  `HarnessPredictionInput` mirroring the existing `isOffseason` / `isSurrogateAffected`.
- Exact wording of the methodology-page copy.
</decisions>

<specifics>
## Specific Ideas

Existing machinery this should reuse rather than reinvent:

- `packages/harness/score.ts` — `ExclusionCounts`, `EMPTY_EXCLUSIONS`, and the exclusion
  branch in `aggregateScores` (~L341-360). Add `coldStart` here.
- `packages/core/scoring/brier.ts` — the existing no-call machinery. Do NOT repurpose it;
  the new rule is structural, keyed off the cold-start flag, not off `pRedWin === 0.5`.
- `packages/core/algorithms/bpr.ts` (~L180) — BPR ALREADY produces dead-even cold-start
  predictions (274 in 2016, 1 in 2017) and its `normCdf` has an exact-0.5 guard specifically
  so they stay visible. That count is a natural cross-check for the new predicate on BPR's side.
- `packages/harness/artifact.ts` L64-65 and `packages/harness/pageArtifacts.ts` L1531-32 —
  the Zod schemas carrying `noCallCount` / `exclusionCounts`. Both need the new key.
- `apps/web/src/components/compare/coverageRows.ts` L55 — `CoverageExclusionKey` union.
- `apps/web/src/components/compare/DataCoverageTable.tsx` — renders the exclusion columns.
- `packages/harness/report.ts` L75, L90 — the HTML report's excluded-total line and its
  per-key breakdown.
</specifics>

<canonical_refs>
## Canonical References

- The comparison methodology post: `apps/web/src/routes/methodology.compare.tsx` and
  `apps/web/src/components/compare/MethodologyNote.tsx` — this is the "comparison methodology
  post" the task must update.
- `.claude/CLAUDE.md` — project instructions, including the secrets-handling rule.
- Walk-forward / predict-before-update sequencing is a hard project constraint from the
  failure log; the cold-start predicate must respect it (a team seen only in LATER matches
  is still unseen now).
</canonical_refs>
