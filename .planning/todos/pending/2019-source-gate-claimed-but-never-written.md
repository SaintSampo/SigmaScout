---
id: 2019-source-gate-claimed-but-never-written
created: 2026-09-12
source: salvaged from `2017-2019-deficit-diagnosis` when that todo was deleted (its deficits are gone); the finding itself dates to quick task 260907-057 and has never been fixed
priority: medium
---

# `2019.ts` cites a source gate in `reconciliation.test.ts` that does not exist

**Size: extra-small.** One `describe` block of about 25 lines, mirroring one that is already in the
same file. No decision is owed, nothing is blocked on it, and it needs no measurement.

This is an instance of this project's named founding failure mode — a file header asserting a
protection the code does not provide — sitting inside the very test file whose job is to catch that
class of thing.

## What is claimed

`packages/core/algorithms/breakdown/2019.ts`'s file header, under "Roll-up avoidance (BD-1)":

> `autoPoints` is NUMERICALLY IDENTICAL to `sandStormBonusPoints` in every observed row. Reading
> `autoPoints` instead of the sandstorm field would be a duplicate, not an independent component —
> AND reconciliation would still PASS, because the two values are equal. **The comment-stripped
> source gate in `reconciliation.test.ts`** (asserting `autoPoints`/`teleopPoints`/`totalPoints`
> appear nowhere outside a comment in this file) **is the only thing that can catch this particular
> substitution** — the corpus proof alone cannot.

That is a correct and well-argued piece of reasoning about a test that was never written.

## What exists at HEAD

`packages/core/algorithms/breakdown/reconciliation.test.ts` has five `describe` blocks (lines 264,
322, 334, 420, 462). Exactly two perform a comment-stripped source scan, and **neither reads
`2019.ts`**:

- `"2026 field-rename assertion (T-02-07)"` (line 420) reads `2026.ts` and asserts zero
  non-comment occurrences of `foulCount`/`techFoulCount`.
- `"2018 Scale/Switch split source gate (D-1)"` (line 462) reads `2018.ts` and asserts zero
  non-comment occurrences of seven forbidden roll-up/Force fields, paired with a positive assertion
  that both split pairs are present in `components`.

The string `2019.ts` appears in that test file exactly once — inside a comment (line 468) — and
never as a path passed to `readFileSync`.

## The second, worse half — which the deleted todo did not record

The 2018 gate's own doc comment states that 2019 is already covered:

> "This is the identical class of hazard `2019.ts`'s `autoPoints`/`sandStormBonusPoints`
> numeric-identity roll-up **gets from this file's 2026 field-rename assertion above**…"
> — `reconciliation.test.ts:466-471`

It does not. The 2026 assertion reads `2026.ts` and only `2026.ts`. So **two** file headers now
assert the same non-existent protection, and the second one was written by someone who had the
correct implementation open in front of them. A reader who checks `2019.ts`'s claim by following the
pointer lands on a comment that confirms it, and stops.

## The work

Add a `describe("2019 roll-up source gate (BD-1)")` block to
`packages/core/algorithms/breakdown/reconciliation.test.ts`, copying the mechanics of the 2018 gate
at line 462 verbatim (same comment-stripping, same `readFileSync` of a sibling path, same
per-field loop with the field name in the assertion message).

- File read: `2019.ts`
- Forbidden fields: `autoPoints`, `teleopPoints`, `totalPoints` — exactly the three `2019.ts`'s
  header names, and no more. `teleopPoints` is separately load-bearing: the header records that it
  equals `hatchPanelPoints + cargoPoints + habClimbPoints`, so reading it beside the three parts
  would double-count.
- Pair it with a positive assertion, as the 2018 gate does — that `componentMapForSeason(2019)`'s
  `components` contains the sandstorm entry the header says must be read instead of `autoPoints`.

**Confirm it fails before keeping it.** Temporarily substitute `autoPoints` for the sandstorm field
in `2019.ts` and check that the new gate goes red while the corpus reconciliation stays green — that
contrast is the entire point of the test and is what the header claims.

**Then fix the two prose claims** so they describe what the file does: `2019.ts`'s header (which may
simply stop being wrong once the gate exists) and `reconciliation.test.ts:466-471`'s
"gets it from the 2026 assertion" sentence, which is wrong either way and must be repointed at the
new block.

## Provenance

`2017-2019-deficit-diagnosis` was deleted on 2026-09-12 because the deficits it existed to close no
longer exist — measured on live `bpr@3.0.0`, 2017 is **+0.36pp** and 2019 is **0.00pp** against the
unchanged `STATBOTICS_REFERENCE_FALLBACK`, where that todo recorded VPR at -4.19pp and -4.61pp. Its
diagnosis (2017 a calibration failure, 2019 a discrimination failure) was measured against
`vpr@10.0.0+rolling-2026-09e`, a retired algorithm. This gate was the one live finding inside it and
is transferred here so it is not lost with the file. See git history for the original.
