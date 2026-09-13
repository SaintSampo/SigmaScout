---
phase: quick-260912-tay
plan: 01
status: complete
completed: 2026-09-12
commits:
  - 6e347064
  - e92f0efb
  - 42c15377
  - 51ae80d3
  - 92dbbbed
  - 386899b7
key_files:
  created:
    - scripts/pruneR2Generations.ts
    - scripts/pruneR2Generations.test.ts
    - packages/harness/r2ClientList.test.ts
  modified:
    - packages/harness/r2Client.ts
    - packages/harness/r2ClientRetry.test.ts
    - scripts/verifySubsetPublish.ts
    - docs/publish-budget.md
    - package.json
---

# Quick Task 260912-tay: Clean R2 by census-driven deletion of every orphaned generation

**R2 went from 16.52 GB to 4.34 GB, back inside the 10 GB free tier.** A second full bucket listing proves it, not a sample and not an exit code.

## Result

| | Before | After |
|---|---:|---:|
| Objects | 337,614 | 109,744 |
| Bytes | 16,519,445,447 (16.52 GB) | 4,340,713,711 (4.34 GB) |
| Orphaned generations | 11 (227,870 objects, 12.18 GB) | 0 |
| Live generations | 3 (109,610 objects) | 3 (109,610 objects, byte-identical) |
| Unversioned objects | 134 | 134 (untouched) |

**Deleted, all 11:** `vpr@11.0.0+rolling-2026-09g`, `vpr@11.0.0+rolling-2026-09e`, `vpr@10.0.0+rolling-2026-09e`, `vpr@2.1.0+tuned-2026-08`, `vpr@10.0.0+rolling-2026-09d`, `epa@1.1.0+baseline`, `vpr@5.0.0+tuned-2026-08`, `opr@3.1.0+baseline`, `epa@5.0.0+baseline`, `vpr@8.0.0+rolling-2026-09b`, `epa@6.0.0+baseline`. There were seven vpr versions (10.05 GB), not the "five, ~8.1 GB" in the original caveat.

**Live and untouched:** `opr@4.0.0+baseline` (36,536 objects / 1,168,015,270 bytes), `epa@10.0.0+baseline` (36,537 / 1,640,857,030), `spr@3.0.0+baseline` (36,537 / 1,518,019,743). Object and byte counts are identical in both listings.

## Why a new tool

The existing `deleteRetiredAlgorithmObjects.ts` could not do this job, and the listing proved it. That tool deletes a set of keys predicted from the corpus and then checks 60 of them. It recorded "nothing orphaned" on 2026-09-04, 09-05, 09-10 and 09-11, and every one of those claims was false. For example, it recorded `epa@5.0.0` as deleted, but its 2016–2018 keys (11,002 objects) were still present, because that pass covered only 2019–2026.

`scripts/pruneR2Generations.ts` (alias `pnpm cleanup:r2-generations`) takes the opposite approach:

1. List the whole bucket through a new signed `listObjects` in `r2Client.ts`.
2. Parse each key's `{id}@{version}` generation exactly.
3. Classify each generation against the live manifest, fetched fresh.
4. Delete one key at a time, only from the generations named explicitly.
5. List the bucket again and require zero remaining and unchanged live counts.

Every guard fails closed before the first DELETE: live, typo, recent write, live-set floor, manifest cross-check against `PUBLISHED_ALGORITHM_IDS`, unknown key shape, and exact selection. `deleteObject` also gained transient retry.

## How the run went (Task 2, main context)

1. **Preflight.** No publish was running. A one-page listing proved the request signing works. The full census matched the earlier measurement exactly, and the preview selected exactly 227,870 objects.
2. **Commit `42c15377`, before any deletion.** The census found a key shape the tool didn't expect: `v1/team/frc58 //2019/...`. Three 2019wiwi elimination matches in the corpus list the team as `"frc58 /"`, and `artifactKey` does not validate team keys. The guard would have refused five vpr generations over it. The team shape is now anchored from the end; selection is still exact.
3. **Execute run 1** was killed from outside after about 36,550 deletes. It left no stack trace, and other node processes survived. Nothing was harmed, because deletes are idempotent.
4. **Run 2** refused with `NOT_IN_CENSUS` on `epa@6.0.0`, which run 1 had already emptied. That is the guard working as designed.
5. **Run 3** was detached through `Start-Process` and covered the 10 remaining generations: 191,320 deleted, 0 failures, 771 s, `ok: true`.
6. **Separate listing afterwards:** 0 orphaned generations, and live counts identical.
7. **Live origin checks:** the manifest is unchanged. Live keys return 200 with JSON at generation `2c22394b`. One sample key from each of the 11 deleted generations returns 404.

## vpr absence entries (Jacob's follow-up)

`verifySubsetPublish.ts` now asserts that the FINAL vpr generation, `11.0.0+rolling-2026-09g`, is gone:
- **15 event entries,** derived from the sigma1 controls. The existing `9.0.0` layer is kept.
- **1 team entry,** frc4206/2024.

All 16 keys were present in the pre-delete listing, so the assertions are not vacuous. FAIL labels on absence entries now carry `@version`.

**Live results:**
- **Event level:** `65 entries checked, 0 failing`
- **`--algorithm vpr`:** `30 entries checked, 0 failing`
- **`--team-only`:** `8 team entries checked, 1 failing`. The one failure is the pre-existing defect below, and the new vpr team entry passes.

## Found, reported, NOT fixed (out of scope)

1. **Pre-existing verifier defect.** The team-level entry `FAIL frc9969/2024/spr: bonusRpAbsence: zero playoff rows observed` can never pass. The entry is designed with `expectPlayoffRows: 0`, and check 13 (`71212940`, 2026-08-28) fails any team with zero playoff rows. The object is byte-identical before and after the deletion, so this task did not cause it.
2. **Corpus data quirk.** The team key `"frc58 /"` appears in 2019wiwi ef2m1, ef5m1 and qf3m1, so every publish writes a team page at a broken URL, `v1/team/frc58 //2019/`.
3. **Unversioned objects** (134, ~13.8 MB: district, compare, districts, `fixtures/2026cmptx`, methodology, manifest) were left in place.

## Deviations

- **Executor model.** Both executors ran on opus rather than the configured sonnet, because a bug in production-deletion code deletes live data.
- **Extra fix commit `42c15377`,** described above.
- **Deletion took three runs** instead of one, described above.
- **Three more dated corrections in `docs/publish-budget.md`** than planned: 2026-09-04, 09-05, and 09-11's "first time since". The orchestrator checked each against the census timestamps and the live set at the time.
- **Team-level expectation.** The planned team result was 8/0. It is 8/1 because of the pre-existing defect, recorded rather than changed.

## Verification

- Offline: 120 tests passed across r2Client, the prune tool, the identity sweep and the delete tool, plus 52 across the Task 3 set. `npx tsc --noEmit` is clean.
- Proof files in this directory:
  - `260912-tay-census-before.json`
  - `260912-tay-census-after.json`
  - `260912-tay-prune-report.json` (run 3)
  - `260912-tay-spotchecks.txt`
- Full key lists: `reports/r2-prune/` (gitignored).
