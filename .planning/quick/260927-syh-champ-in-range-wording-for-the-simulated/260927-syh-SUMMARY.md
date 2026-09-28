---
quick_id: 260927-syh
status: complete
date: 2026-09-27
---

# Quick Task 260927-syh: champ In range wording, zero award profile in the bake, district republish

## Changes

**Wording (commit 8b15c30e).** The champ tab now reads:
- In range: "this team's median predicted points sit at or above the predicted cutoff, which already counts the slots DCMP award winners take"
- Out of range: "this team's median predicted points sit below the predicted cutoff"

The District Locks tab keeps "if every team earned its median predicted points…". `StatusChips` takes a `definitions` prop. Both are pinned: the copy test (including a no dash check) and a champ render test.

**Publisher (commit 2e413731).** `ZERO_AWARD_PROFILE` lives in core now, and the browser and the bake read the same constant. The bake prices an unprofiled roster team with no decorations instead of refusing the event. The team is named in `zeroProfileTeams`, and the publisher logs it. The `missing-award-profiles` skip reason is gone. A test shows the filled bake is identical to a bake handed explicit zero profiles.

## Republish

- `publish:districts` covered 2016 to 2020 and 2022 to 2026.
- It published 119 objects: every `v1/district/*.json` plus the season indexes, with 0 errors.
- The live 2026fnc artifact reads generation 2026-09-28T01:02:40Z.
- It produced 0 sidecars. Every district event at this instant is already played, so no census reported a skip.
- The bake change cannot move a published number until an unplayed event exists, which means the 2027 season.

## Verification

- Full suite: 298 files, 6950 tests passed, 1 skipped.
- Root, web, e2e and worker typechecks: 0 errors each.
- CI Test and Pages deploy passed for 2e413731.
- The live champ tab shows the new wording and ~217 for FNC at the end of the district season. The live district tab shows the old wording.
- Live e2e: 289 of 289 passed.

## Found along the way (not fixed)

- **The award profile skip never actually fired in 2026.** The publisher profiles every roster team from TBA's rookie year, so only a team with no TBA rookie year could trip it. frc3669 broke only the browser, because the district artifact carries profiles for district teams only.
- **The ranking point filler refused every candidate early in the season.** An as-of 2026-03-01 dry run considered 150 events: 23 were bake candidates, and all 23 were skipped with `no-ranking-point-filler` ("the all-or-nothing ranking-point filler rejected this roster"), so 0 were baked. At 2026-04-04, 2 were baked and 1 was skipped the same way. As a result, almost no presim sidecar reaches the site during a real season. This is worth a `/gsd-debug` before the 2027 season.
