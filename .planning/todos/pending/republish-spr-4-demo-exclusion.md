---
id: republish-spr-4-demo-exclusion
created: 2026-09-13
updated: 2026-09-14
source: stray-team-scope-keys-in-live-d1 (closed 2026-09-13); republish, D1 seed and Worker deploy done by quick task 260913-rh5
priority: low
---

# Remaining: delete the orphaned spr@3.0.0 generation and the stale OPR/EPA presim sidecars

Quick task 260913-rh5 did steps 1-3 and 5 on 2026-09-14:
- **Publish:** generation `2dcc057f`.
- **D1 seed:** all three algorithms on `2dcc057f`, 0 placeholder or demo rows.
- **Worker:** `fcc7ca73`.
- **Budget block:** commit `0a6af726`.

Two R2 deletions are left. The auto-mode classifier blocked both ("Cloud Storage Mass Delete"), so
Jacob runs them or approves them.

1. **spr@3.0.0+baseline**, 36,532 objects, 1.52 GB. Nothing references it: the live manifest names
   spr 4.0.0. Preview it with
   `pnpm cleanup:r2-generations --generation spr@3.0.0+baseline`, then add `--execute`. Its 6h
   RECENT_WRITE guard clears at 2026-09-14T00:41Z, because the generation was last written at
   18:41Z.
2. **427 stale presim sidecars:** `v1/presim/*/opr@4.0.0+baseline.json` (213) and
   `epa@10.0.0+baseline.json` (214). They date from generation 174d585f, before 260913-it4 stopped
   OPR/EPA publishing ranking points. Nothing requests them: the Simulation tab and its sidecar query
   are SPR-only. Run `tsx --env-file=.env reports/260913-rh5/pruneNonSprPresim.ts`, which previews by
   default. Pass `--execute` to delete, then re-list. The script is gitignored, local only. The prune
   tool can't do this, because it deletes whole id@version generations and these two versions are
   live.
