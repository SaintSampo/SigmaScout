---
phase: 08-simulation-compare
plan: 02
subsystem: pipeline
tags: [zod, harness, publish, schema]

requires:
  - phase: 07-event-pages
    provides: EventMatchSchema/EventUpcomingMatchSchema/TeamSeasonMatchSchema shapes, toIntegerRpOrNull, roundPmf/ROUNDING_RULE.pmf
provides:
  - "EventMatchSchema.redRpPmf/blueRpPmf (D-03) — the ranking-point distribution pair on played event matches"
  - "EventMatchSchema.actualRedRp/actualBlueRp (D-12) — the three-state actual-ranking-point pair on played event matches"
  - "buildEventArtifact's matches row builder filling all four fields from prediction/match already in scope"
affects: [08-05 (the republish that populates these fields), 08-09 (Simulation tab), 08-11 (start-match picker + D-12 fallback baseline)]

actuals:
  tokens: 30000
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "EventMatchSchema converted from a bare z.object() to a .refine()-chained schema, matching EventUpcomingMatchSchema/TeamSeasonMatchSchema's own shape (PD-01)"
    - "Cross-builder equivalence test: one shared match + one shared prediction fed to two different assembly functions, asserting agreement rather than two independently-typed fixtures that could coincidentally agree"

key-files:
  created: []
  modified:
    - packages/harness/pageArtifacts.ts
    - packages/harness/pageArtifacts.test.ts
    - packages/harness/publish.ts
    - packages/harness/publish.test.ts
    - packages/harness/rounding.ts

key-decisions:
  - "PD-02 confirmed live: the pmf pair is mirrored ungated — a playoff row's shape does change (a degenerate one-entry pmf, same as buildTeamSeasonArtifact already publishes), proven by the new cross-builder equivalence case rather than assumed"
  - "PD-04 applied as written: actualRedRp/actualBlueRp are assigned directly (never conditionally spread) in buildEventArtifact's matches builder, so both keys are always present on a played row post-republish — the discriminator 08-11 depends on"
  - "PD-09's whitespace-ignored diff gate confirmed clean: raw diff on EventMatchSchema's range is 162 lines (the reindent), whitespace-ignored diff is 46 lines (the real content: header doc, two new field pairs plus doc comments, two refines) — no pre-existing field was retyped, reordered or removed"
  - "Doc corrections (Task 3) landed exactly the three falsified claims PD-08 named: EventMatchSchema's sidecar-parity header, EventUpcomingMatchSchema's 'primary simulation input' claim, and EventArtifactSchema's 'matches unchanged from the 04-01 tracer' claim — zero hedge-word framings left standing"

patterns-established:
  - "A published-schema plan with zero publish/republish side effects: every task verified via in-memory buildEventArtifact()/EventArtifactSchema.parse() fixtures, payloadBudget.test.ts asserted unmoved as the byte-level proof nothing shipped"

requirements-completed: []

coverage:
  - id: D-03
    description: "EventMatchSchema gains redRpPmf/blueRpPmf (D-03) — same field names, same type expression, same isValidPmf refine pair as EventUpcomingMatchSchema/TeamSeasonMatchSchema; buildEventArtifact fills both from prediction, ungated, via existing roundPmf/ROUNDING_RULE.pmf"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts — 'EventMatchSchema — redRpPmf/blueRpPmf' describe block, 8 cases"
        status: pass
      - kind: unit
        ref: "packages/harness/publish.test.ts — 'buildEventArtifact — redRpPmf/blueRpPmf on played matches' describe block, 5 cases"
        status: pass
    human_judgment: false
  - id: D-12
    description: "EventMatchSchema gains actualRedRp/actualBlueRp (D-12), identical type expression to TeamSeasonMatchSchema's own pair, three published states (absent/null/integer including real 0), never coerced; buildEventArtifact fills both directly through toIntegerRpOrNull"
    requirement: EVNT-07
    verification:
      - kind: unit
        ref: "packages/harness/pageArtifacts.test.ts — 'EventMatchSchema — actualRedRp/actualBlueRp' describe block, 6 cases"
        status: pass
      - kind: unit
        ref: "packages/harness/publish.test.ts — 'buildEventArtifact — actualRedRp/actualBlueRp on played matches' describe block, 5 cases"
        status: pass
    human_judgment: false
  - id: PD-02
    description: "One rule across three row builders: buildEventArtifact and buildTeamSeasonArtifact agree on all four fields for the same match/prediction"
    verification:
      - kind: unit
        ref: "packages/harness/publish.test.ts — cross-builder equivalence case, elimination match, degenerate one-entry pmf + real zero actual RP"
        status: pass
    human_judgment: false
  - id: PD-11
    description: "This plan changes no published byte — no R2 write/delete, no publish command run, payloadBudget.test.ts shows exactly the two accepted baseline failures and no other movement"
    verification:
      - kind: integration
        ref: "packages/harness/payloadBudget.test.ts — 2 failed (ledger #11, #15), 8 passed, both before and after this plan"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-08-31
status: complete
---

# Phase 8 Plan 2: Event-match RP distribution + actual RP (D-03/D-12) Summary

**`EventMatchSchema` gained `redRpPmf`/`blueRpPmf` (D-03) and `actualRedRp`/`actualBlueRp` (D-12) on played event-match rows, both filled by `buildEventArtifact` from data already in scope — zero new imports, zero published bytes, and a pre-republish artifact still parses unchanged.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-31T13:53:00Z
- **Completed:** 2026-08-31T18:08:56Z
- **Tasks:** 3
- **Files modified:** 5

## Baseline (recorded before Task 1, per plan's `<baseline>` block)

| Suite | Baseline | Post-plan |
|---|---|---|
| `pageArtifacts.test.ts` | 83 passed, 0 failed | 99 passed, 0 failed (+16) |
| `publish.test.ts` | 103 passed, 0 failed | 114 passed, 0 failed (+11) |
| `browserSafeSchemas.test.ts` | 6 passed, 0 failed | 6 passed, 0 failed (unchanged) |
| `rounding.test.ts` | 27 passed, 0 failed | 27 passed, 0 failed (unchanged) |
| `payloadBudget.test.ts` | 2 failed, 8 passed (ledger #11, #15) | 2 failed, 8 passed (unchanged — PD-11) |

**Six `<baseline>` grep counts, before → after (all match the plan's stated targets exactly):**

| Grep | Before | After |
|---|---|---|
| `^\s+(red\|blue)RpPmf: z\.array` in `pageArtifacts.ts` | 4 | 6 |
| `isValidPmf(row` in `pageArtifacts.ts` | 4 | 6 |
| `^\s+actual(Red\|Blue)Rp: z\.` in `pageArtifacts.ts` | 2 | 4 |
| `roundPmf(prediction` in `publish.ts` | 4 | 6 |
| `toIntegerRpOrNull(match` in `publish.ts` | 2 | 4 |
| `ROUNDING_RULE` key count in `rounding.ts` | 7 | 7 (unchanged, PD-05) |

`PAGE_ARTIFACT_SCHEMA_VERSION` stayed `1` throughout. Task 2's `<precondition>` was verified before that task's work began: `grep -c 'function toIntegerRpOrNull' packages/harness/publish.ts` returned `1`.

## Observed RED (PD-06 — quoted, not claimed)

**Task 1** (`pageArtifacts.test.ts`, Test 2, before the schema edit):
```
AssertionError: expected undefined to deeply equal [ 0.05, 0.1, 0.2, 0.3, 0.2, 0.1, 0.05 ]
 ❯ packages/harness/pageArtifacts.test.ts:602:41 (parsed.matches[0]!.redRpPmf).toEqual(redRpPmf)
```
```
pnpm typecheck: packages/harness/pageArtifacts.test.ts(602,31): error TS2339: Property 'redRpPmf' does not exist on type ...
```

**Task 2** (`pageArtifacts.test.ts`, Test 1, before the schema edit):
```
AssertionError: expected undefined to be 5
 ❯ packages/harness/pageArtifacts.test.ts:674:44 (parsed.matches[0]!.actualRedRp).toBe(5)
```
```
pnpm typecheck: packages/harness/pageArtifacts.test.ts(674,31): error TS2339: Property 'actualRedRp' does not exist on type ...
```

Both tasks additionally failed the same way in `publish.test.ts` (`redRpPmf`/`actualRedRp` `undefined` on the built artifact, matching TS2339 property-access errors) — 9 cases red for Task 1, 9 cases red for Task 2, before their respective implementations landed.

## Diff accounting (PD-09)

`git diff -w packages/harness/pageArtifacts.ts` (Task 1's reindent commit) shows the schema-shape conversion's whitespace-ignored diff is **46 lines** against a raw diff of **162 lines** — the difference (116 lines) is purely the object literal moving one indent level deeper. Inside `EventMatchSchema`'s range, the whitespace-ignored diff contains only: the header doc rewrite, the two new field declarations (`redRpPmf`/`blueRpPmf`) with their doc comments, the object literal's closing punctuation (`})`), and the two appended `.refine()` calls. No pre-existing field line changed once whitespace is ignored.

## New fields — contract table (for 08-05 and 08-11)

| Field | Type expression | Absence contract |
|---|---|---|
| `EventMatchSchema.redRpPmf` | `z.array(z.number()).optional()` | Absent = artifact predates field, OR algorithm (OPR/EPA) does not model RP. Never an empty array. |
| `EventMatchSchema.blueRpPmf` | `z.array(z.number()).optional()` | Same as `redRpPmf`. |
| `EventMatchSchema.actualRedRp` | `z.number().int().nullable().optional()` | Absent = artifact predates field. `null` = fact not derivable from available data. Present integer (incl. real `0`) = TBA's reported bonus RP. `null` never coerced to `0`. |
| `EventMatchSchema.actualBlueRp` | `z.number().int().nullable().optional()` | Same as `actualRedRp`. |

## `ROUNDING_RULE` dispositions (PD-05)

- **pmf pair:** reuses `ROUNDING_RULE.pmf` (5 decimals) unchanged through the existing `roundPmf` — the identical rounding path `EventUpcomingMatchSchema`/`TeamSeasonMatchSchema` already use. Documented in `rounding.ts`'s prose, immediately after the field-class table.
- **actual-RP pair:** integral by construction (`.int()`), published unrounded — no `ROUNDING_RULE` entry, matching `TeamSeasonMatchSchema.actualRedRp`/`actualBlueRp`'s own disposition. Documented in `rounding.ts`'s existing "integral by construction" enumeration, extended to name this plan's pair.
- **Confirmed zero keys added:** `ROUNDING_RULE` object still has exactly 7 keys before and after; `rounding.test.ts`'s exhaustive key-set assertion stayed green and unmodified (that file does not appear in this plan's diff).

## Cross-builder equivalence (PD-02's evidence)

A new `publish.test.ts` case builds ONE shared elimination match (`compLevel: "sf"`, `redRpEarned: 0`, `blueRpEarned: 0`) and ONE shared prediction (`redRpPmf: [1]`, `blueRpPmf: [1]` — the degenerate one-entry distribution a playoff match genuinely carries), passes both to `buildEventArtifact` and `buildTeamSeasonArtifact`, and asserts all four fields agree: `redRpPmf` equal, `blueRpPmf` equal, `actualRedRp` equal (both `0`, a real zero — not two `undefined`s coincidentally matching), `actualBlueRp` equal. This is 08-05's advance notice: **playoff rows change shape too** — a one-entry pmf and a real zero actual-RP pair, ungated on competition level, matching what `buildTeamSeasonArtifact` already publishes for the same match class.

## Task Commits

1. **Task 1 (TRACER): redRpPmf/blueRpPmf on played event matches (D-03)** — `a0eae5e0`
2. **Task 2: actualRedRp/actualBlueRp on played event matches (D-12)** — `57cd1b4e`
3. **Task 3: doc drift closure + cross-builder equivalence proof (PD-02, PD-08)** — `3c4202ec`

Task 1's tracer feedback gate: re-ran its full `<verify>` command (`pageArtifacts.test.ts`, `publish.test.ts`, `browserSafeSchemas.test.ts`, `rounding.test.ts`) immediately after committing — all green (234 passed) — before starting Task 2's expansion work.

## Files Created/Modified

- `packages/harness/pageArtifacts.ts` — `EventMatchSchema` converted to a refine-chained schema; gained `redRpPmf`/`blueRpPmf` (D-03) and `actualRedRp`/`actualBlueRp` (D-12); three doc corrections (its own header, `EventUpcomingMatchSchema`'s header, `EventArtifactSchema`'s doc)
- `packages/harness/pageArtifacts.test.ts` — 14 new cases across two new describe blocks (pmf pair, actual-RP pair)
- `packages/harness/publish.ts` — `buildEventArtifact`'s `matches` row builder gained four new field assignments (two lines mirroring the `upcoming` builder, two lines mirroring `buildTeamSeasonArtifact`'s played branch)
- `packages/harness/publish.test.ts` — 10 new cases across two new describe blocks, plus one cross-builder equivalence case
- `packages/harness/rounding.ts` — two prose extensions (pmf reuse, integral-by-construction enumeration); zero `ROUNDING_RULE` keys changed

## Decisions Made

See `key-decisions` in frontmatter. All were the plan's own recorded planner decisions (PD-01 through PD-11), executed as specified; no new decisions were made beyond the plan's own text. PD-02's "playoff row shape changes" expectation was the approved outline's own corrected assumption (not this plan's discovery) — the cross-builder equivalence case is this plan's proof of it.

## Deviations from Plan

None — plan executed exactly as written. All acceptance criteria (grep counts, diff-scope checks, whitespace-ignored diff, precondition check, cross-builder equivalence, doc-hedge sweep) passed on first verification after each task's implementation.

## Issues Encountered

None. The plan's own baseline numbers, precondition, and read_first line citations all matched the live repository state exactly (no drift between planning and execution).

## Restatement for 08-05 (per the plan's `<output>` requirement)

- **Nothing was published by this plan.** No R2 object was written or deleted, no publish command of any kind was run (`pnpm publish:seasons` and every other publish entry point untouched), and `docs/` does not appear in this plan's diff. `payloadBudget.test.ts` shows exactly the two pre-existing accepted signed overrides (ledger #11, #15) both before and after this plan, and no other movement.
- **The single republish that makes these four fields real is 08-05's, exclusively.** No second republish is authorized anywhere in this phase.
- **Projected byte figure, restated as a projection, not a measurement:** 342,292 bytes projected at `v1/event/2024gal/vpr@2.1.0+tuned-2026-08.json` against a 350,000-byte ceiling (7,708 bytes of headroom), computed 2026-08-30 from the live 327,172-byte artifact plus sampled real pmf arrays from a live published team artifact. This plan publishes nothing that could confirm it — it is explicitly NOT a measurement of a post-republish artifact. **A breach at any event during 08-05's run is a stop-and-report condition**, not something to absorb by trimming another field.
- Every field this plan adds is optional or nullable, so a schema-level pass alone cannot prove a post-republish artifact is POPULATED — that completeness assertion belongs to 08-05's sampled-event verification (a played `qm` row per season carrying all four fields).

## User Setup Required

None — no external service configuration required. No `.env` access of any kind occurred in this plan (verified: no task opened a network connection or referenced a credential).

## Next Phase Readiness

- `EventMatchSchema`'s four new fields are a complete, tested, documented contract — 08-05 can run the full republish against this schema with no further source change.
- 08-09 (Simulation tab), 08-11 (start-match picker + D-12 fallback baseline), 08-14 (rendered rank band) all sit strictly behind 08-05's republish per UI-SPEC's Data Dependencies gate; this plan does not unblock them early, and none of their consuming code exists yet in `apps/web/` (confirmed: `apps/web/` does not appear in this plan's diff).
- 08-11's D-12 precedence rule (TBA Ranking Score when present, summed per-match fallback when absent) now has a real, tested, key-presence-discriminable data source to read once 08-05 republishes.

## Self-Check: PASSED

All 5 modified files confirmed present on disk with the expected changes; all 3 task commits (`a0eae5e0`, `57cd1b4e`, `3c4202ec`) confirmed in `git log --oneline`.
