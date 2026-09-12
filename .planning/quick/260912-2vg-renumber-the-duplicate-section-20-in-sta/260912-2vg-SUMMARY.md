---
id: 260912-2vg
title: Renumber the duplicate section 20 in statbotics-breakdown-reference.md to 21 and sweep all citations
status: complete
date: 2026-09-12
commits:
  - 66572a4b
files_touched:
  - docs/models/statbotics-breakdown-reference.md
  - docs/models/epa-divergences.md
  - docs/models/epa-statbotics-gap.md
  - packages/core/algorithms/epa.ts
  - packages/core/algorithms/epaWeekOne.ts
  - packages/core/algorithms/epaWeekOne.test.ts
---

# 260912-2vg — SUMMARY

## What shipped

`docs/models/statbotics-breakdown-reference.md` no longer has two sections numbered 20. The
`avg.py` section appended on 2026-09-11 is now **§21**; **§20** remains "Residual gaps". Verified:
`## 20.` appears exactly once, `## 21.` exactly once, and no `## N.` heading number repeats
anywhere in the 2,397-line file.

## The part that was not cosmetic

The todo's whole reason for existing was that a bare heading fix would convert a *visible*
duplicate into an *invisible* wrong reference, because the numbers are hand-written and nothing
validates them. A full-repo census found **16** citations of section 20 — and they split, so a
find-and-replace would have been wrong in both directions:

**12 moved to 21** (all mean `avg.py` / the week-1 aggregate finding):

| file | lines |
|---|---|
| `docs/models/epa-divergences.md` | 103 |
| `docs/models/epa-statbotics-gap.md` | 651, 887, 933, 1197 |
| `packages/core/algorithms/epa.ts` | 391, 1346, 1614 |
| `packages/core/algorithms/epaWeekOne.ts` | 11, 55, 126 |
| `packages/core/algorithms/epaWeekOne.test.ts` | 283 |

**4 stayed at 20** (all mean "Residual gaps"): reference lines 40, 53 and 2305, and
`epa-statbotics-gap.md:1189`.

Each site's existing spelling was preserved — `§21` where the file wrote `§20`, `section 21`
where it wrote `section 20`.

## Two judgement calls, recorded

1. **Provenance block B's scope list (reference line 53) still reads "sections 6, 7, 9, 10 and
   20" and still says "those five sections".** That is correct, not an oversight: block B scopes
   the file's *secondhand* prose, and §21 declares its own `Provenance: VERBATIM`. It does not
   belong in that list.

2. **`.planning/` artifacts were deliberately left alone.** `.planning/quick/*/PLAN.md` and
   `*/SUMMARY.md`, `.planning/STATE.md` row 121, and `.planning/todos/completed/` all cite
   section 20. They are records of what was true when written; rewriting them would falsify the
   record. "Anything citing into it" was read as live code and live docs.

## Surfaced, NOT fixed — needs a decision

§20's **residual gap #1** still reads: how the 21 `Year` aggregate columns are computed is
unknown, "the writer was not fetched and this task cannot name it without guessing", and it is
"the single most valuable remaining fetch".

**§21 is that writer**, fetched and transcribed verbatim. `epa-statbotics-gap.md:1189` already
strikes this gap as RETRACTED (quick task 260911-pon); the reference document's own copy never
got the same treatment. So the reference now contains a self-contradiction one section wide.

This is a content correction rather than a renumber, so it was left out of scope rather than
folded in silently. It is a one-paragraph fix in the style §20 already uses for its own
"Closed by this task" block.

## Verification

- `## 20.` count = 1, `## 21.` count = 1, no duplicate heading numbers in the file
- Re-grep of the live tree: every surviving `section 20` / `§20` means Residual gaps
- Root `tsc --noEmit` clean; `apps/web/tsconfig.json` `tsc --noEmit` clean (both run — root alone
  is known not to cover `apps/web`)
- `npx vitest run packages/core/algorithms/epaWeekOne.test.ts` — 41/41 passed

The diff is exactly 13 insertions and 13 deletions across 6 files: one heading plus twelve
citations. All source-file edits are comment-only, so the typechecks and tests are regression
guards, not evidence the renumber is right — the greps are.
