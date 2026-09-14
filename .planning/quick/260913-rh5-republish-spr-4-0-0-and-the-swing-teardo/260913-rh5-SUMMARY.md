---
phase: 260913-rh5-republish-spr-4-0-0-and-the-swing-teardo
plan: 01
status: complete
completed: 2026-09-14
key-decisions:
  - "Republish now rather than wait for the concurrent 260913-qyn, which will need its own republish (Jacob, AskUserQuestion)"
  - "Ingest 2026 matches, rankings and alliances before publishing so this weekend's offseason results ship"
  - "R2 deletions left to Jacob after the auto-mode classifier blocked them; not worked around"
---

# Quick task 260913-rh5: republish, with the pre and post steps

**Live: generation `2dcc057f`, spr@4.0.0+baseline, D1 seeded, Worker `fcc7ca73`. Two R2 deletions are
still owed, blocked by the permission classifier (todo `republish-spr-4-demo-exclusion`).**

Everything ran in the main context. Executor subagents have no network access, so no planner or
executor was spawned.

## What shipped

- **spr@4.0.0+baseline:** demo teams and TBA placeholder keys are excluded.
- **260913-it4:** OPR/EPA publish no ranking-point odds and no match band.
- **260913-jkp:** Sigma columns.
- **260913-m45:** per-match Sigma on SPR metric-history rows.
- **260913-nvn:** upload queue at concurrency 48. The first real run showed 0 retries.

## Steps

1. **Ingest** (`pnpm ingest --year 2026`): 346 requests, 32 fresh. It added 128 matches: 2026mogw
   35, 2026mifli1 46, 2026mifli2 47. The corpus went from 186,404 to 186,532 matches. Rankings and
   alliances for 2026 were refreshed too, 320 requests each.
2. **Publish** (`pnpm publish:seasons`, from clean HEAD `534502c8`):
   - generation `2dcc057f-be4c-4a00-9749-00412e23994d`
   - 108,976 objects, 3,903,651,039 bytes, 214 presim sidecars
   - 23m28s, against 1h55m for the previous run
   - empty stderr, 0 retries
   - `--write-budget` rewrote the budget block; `payloadBudget` and `publishBudget` tests pass 19/19;
     committed `0a6af726`
3. **D1 seed**, one file per invocation. Rows written: opr 15,900, epa 25,137, spr 25,166, about
   66k in total. The reset was at 00:00Z, so this sits within the day's cap. Read back with
   `GROUP BY` placeholder/demo rows:

   | | opr | epa | spr |
   |---|---|---|---|
   | Before | 0 | 2 | 32 (3.0.0) |
   | After | 0 | 0 | 0 (4.0.0) |

   All three are on generation `2dcc057f`.
4. **Worker deploy** (`npx wrangler deploy`, clean `apps/worker` and `packages`): version
   `fcc7ca73-ed26-4e4f-80db-d4215c63821c`. Two ticks came back `ok` at cpu 2 and 1 ms, with no events
   live. The tail was stopped by PID.
5. **Content checks against data.sigmascout.org:**
   - The manifest names spr 4.0.0.
   - 2026casnv: SPR carries the match band and RP pmfs. OPR/EPA carry neither.
   - frc2481/2026 history rows: SPR 66/66 carry `metrics.sigma`, OPR/EPA 0.
   - frc3538/2024 SPR is 262,087 B, under the 500,000 B limit.
   - Teams 2019/2026 have no demo or placeholder keys for any algorithm.
   - 2026mifli2 serves 47 matches.
6. **`verify:subset`:** 65 entries, 4 failing, generation uniformity 1.
   - All 4 failures are one stale expectation: 2024casf opr/epa `rpPmf` "expected at least one played
     qm row carrying BOTH redRpPmf and blueRpPmf".
   - 260913-it4 removed OPR/EPA RP odds on purpose (`094667e9`) and never updated the verifier table.
     This is not a publish defect. The verifier was left unedited.

7. **R2 cleanup, 2026-09-14 ~01:30Z.** The classifier blocked the first attempt. It ran once Jacob
   explicitly gave permission ("removed everything old and stale for me").
   - **427 stale opr/epa presim sidecars** (213 opr, 214 epa, generation 174d585f, from before it4):
     deleted. The re-list shows 0 non-SPR presim objects, 428 SPR kept.
   - **spr@3.0.0+baseline:** `pnpm cleanup:r2-generations --execute`, 36,532 deleted, 0 failures,
     152.6s. The post-census finds 0 remaining, `Live unchanged: true`.
   - **Bucket:** 146,273 objects / 5.44 GB before, 109,314 objects / 3.92 GB after.
   - **Kept on purpose:** `fixtures/2026cmptx`, which the Worker fixture server uses.

## Not done

- ~~Three stale D1 `event_cursor` rows~~ DONE 2026-09-14 with Jacob's explicit permission. The
  August freshness-rig cursors for 2026cmptx, 2026azscor and 2026scsc were deleted (3 changes). The
  read-back shows only `__scheduler_meta__` remaining.
- **Push:** Jacob pushes. Pages is manifest-driven, so the web needs no push for this data.
- **`verify:subset`:** the 2024casf opr/epa rpPmf expectation needs updating for it4.
- **260913-qyn:** that session's own republish is still ahead.
