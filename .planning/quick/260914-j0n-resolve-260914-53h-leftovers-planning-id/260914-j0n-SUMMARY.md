---
quick_id: 260914-j0n
slug: resolve-260914-53h-leftovers-planning-id
date: 2026-09-14
status: complete
follows: 260914-53h
commits: 53 (260914-j0n) commits, 178a41d6 .. d6c060db
---

# 260914-j0n: resolve every 260914-53h leftover

The user asked to "fully resolve any leftovers" from 260914-53h. This task did that repo-wide, in 9 executor tasks over three waves.

## What changed

- **Rankings-point notes and verification doc (W1-1):**
  - The rankingPoints `untrackedGate` notes for 2018, 2019, 2023, 2024 and 2025 no longer tell readers to run the undefined `pnpm rp:conservative-branch`. They are internal notes, never published.
  - `docs/models/sigma1-rp-verification.md` is renamed to `docs/models/rp-verification.md` with `git mv`. Its dead script pointers now say the script was deleted.
  - Planning ids are gone from 19 runtime error and log strings, including the `publish.ts` pre-schedule logs and the `stateProbe` `rp=0` warning. That warning still contains `rp=0` and `ABLATED ARM`, which a test checks.
- **Test fixtures (W1-2):** the `publish.test.ts` fixtures use `spr`, not `vpr`, and the `vpr`-named locals are renamed. The misplaced `stateSnapshot.test.ts` banner is fixed.
- **Measurement scripts (W1-3):** 78 strings lost their planning ids across six scripts, mostly the `verifySubsetPublish.ts` notes. `docs/models/field-averaged-presim.md` was hand-edited to keep matching `renderDoc`; it was not regenerated.
- **Test titles and messages (W2-1..W2-5):** about 724 test titles and 30 assertion, log and error strings no longer carry quick-task, phase, plan or decision ids. Each batch passed a strings-only guard (only literal text changed), the dupes check and baseline test counts.
  - Kept on purpose: `Test N` enumeration labels, E1-E6 state labels, and fixture or asserted dates, which are data.
- **Retired id in e2e (W3-1):** the retired premier id `vpr` is gone from 21 e2e specs, `support/simulation.ts` and the web simulation fixture; all now use `spr`. Also fixed: `measureAwardPredictability.ts`'s two printed `5n8` lines and the provenance comments in `verifySubsetPublish.ts`.

## Verification

- **Full root vitest:** 235 test files passed, 5,277 tests passed, 1 skipped. That is 2 files fewer than after 53h because peer commit a7017b45 deleted `RpCalibrationSection.test.tsx` and `rpCalibrationCards.test.ts`.
- **Typechecks and build:** root tsc, web tsc and worker tsc all have 0 errors, and `vite build` succeeds.
- **Playwright listing:** `playwright test --list` is unchanged at 304 tests in 20 files.
- **Leftover greps outside `.planning/`:** `consistencyByTeam`, `rp:conservative-branch` and `sigma1-rp-verification` return nothing, and `vpr`/`sigma1` in `apps/web/e2e` returns nothing.
- **Sealed SPR files:** untouched.
- **Live e2e against https://sigmascout.org, desktop:** 26 passed and 11 failed before the change. After it, 29 passed and 8 failed: the three vpr-caused failures are fixed.
  - The remaining failures, plus 32 on phone-390 and pixel-10, are the suite lagging behind the site: heading em dash, banner wordmark, empty-cell glyph, column reorder, tab strip. One is a VPR-era model property that no longer holds under SPR.
  - They are recorded with the full list in `.planning/todos/pending/e2e-suite-stale-against-live-site.md`. They are out of this task's scope because they need UI triage, not a string cleanup.

## Not changed

- Comments elsewhere that still carry planning ids but do not sit next to an edited string. Example: e2e header comments like "G-13 (07-UAT.md)" and "D-27". This task's scope was strings, titles, and only the comments directly next to them.
- `apps/web/src/routes/__fixtures__/compare-*.json` still contain `vpr` rows. They are frozen captured fixtures.
