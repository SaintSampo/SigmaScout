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

Renumber the appended section to 21, and check whether anything cross-references "section 20" of
this document — a stale pointer into the wrong section is the only way this becomes more than
cosmetic.

Trivial, but it has now been carried verbally across three sessions without being written down,
which is the actual reason this file exists.
