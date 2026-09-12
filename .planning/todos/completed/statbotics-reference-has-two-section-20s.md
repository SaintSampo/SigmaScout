---
id: statbotics-reference-has-two-section-20s
created: 2026-09-12
source: EPA agent handoff 2026-09-11, re-confirmed by session audit 2026-09-12
priority: low
---

# `statbotics-breakdown-reference.md` has two sections numbered 20

Confirmed at HEAD on 2026-09-12:

| line | heading |
|---|---|
| 2183 | `## 19. The season-aggregate quantities, EXHAUSTIVELY (L-01)` |
| 2307 | `## 20. Residual gaps — named, not guessed` |
| 2334 | `## 20. backend/src/data/avg.py — where every Year aggregate is WRITTEN (added 2026-09-11)` |

The second 20 was appended on 2026-09-11 and took the number already in use.

## The work

Renumber the appended section to 21.

**Every hand-written citation of a section number in this document must be updated in the same
change, not as a follow-up.** That is the only part of this that is not cosmetic: the numbers are
written by hand, nothing validates them, and a renumber that leaves a citation pointing at the old
number converts a visible duplicate into an invisible wrong reference. Sweep the whole document —
and anything citing into it — before committing, rather than fixing the heading alone.

Trivial, but it has now been carried verbally across three sessions without being written down,
which is the actual reason this file exists.

---

## Resolution — 2026-09-12, quick task 260912-2vg, commit 66572a4b

The `avg.py` heading is now `## 21.`; `## 20.` appears exactly once.

The sweep this file insisted on found **16** hand-written citations, and they split — which is
why a find-and-replace would have been wrong in both directions:

- **12 moved to 21** (they mean `avg.py`): `epa-divergences.md:103`;
  `epa-statbotics-gap.md:651, 887, 933, 1197`; `epa.ts:391, 1346, 1614`;
  `epaWeekOne.ts:11, 55, 126`; `epaWeekOne.test.ts:283`.
- **4 stayed at 20** (they mean Residual gaps): reference `40, 53, 2305`;
  `epa-statbotics-gap.md:1189`.

Provenance block B's scope list (reference line 53) stays five sections long deliberately —
section 21 declares its own `Provenance: VERBATIM`, so it does not belong in a list of the
file's secondhand prose.

`.planning/` artifacts citing section 20 were left alone on purpose: they record what was true
when written.

**One content defect surfaced and NOT fixed here** (it is a correction, not a renumber):
§20's residual gap #1 still says the writer of the 21 `Year` columns "was not fetched and this
task cannot name it without guessing". §21 *is* that writer, fetched and verbatim.
`epa-statbotics-gap.md:1189` already strikes that gap as RETRACTED; the reference's own copy
does not.
