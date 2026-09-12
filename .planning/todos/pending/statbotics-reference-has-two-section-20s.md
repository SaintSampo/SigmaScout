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
