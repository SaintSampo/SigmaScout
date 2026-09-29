# 260928-p8i rollout record (2026-09-28)

Code: main at 71857252 (SPR 9.0.0, shape 17). Jacob approved: "ship steps 1-4", the presim rookie rule, and pushing everything on main.

1. **Live-event check.** No event was running: the last offseason events ended by 09-27, and the next start 10-02. So the shape-17 deploy/seed gap could not cost a fold.
2. **Ingest: FAILED, then skipped.**
   - `pnpm rebaseline --skip-deploy --skip-prune` stopped in ingest: TBA returns HTTP 404 for `/event/2026cascc/matches`. The event is in TBA's `/events/2026` list, but its matches endpoint 404s.
   - Before the failure, the ingest re-upserted the 3757 team rows. Every event it reached returned 304 Not Modified. The corpus sha256 moved from 36ab99dd... to 3d2b8fb8..., from those team rows only.
   - Every later rebaseline will fail on this event until TBA fixes it or the ingest tolerates a per-event 404 (follow-up).
3. **Publish.**
   - `pnpm rebaseline --from publish --skip-deploy --skip-prune` published generation b2bfe488-09b6-41bb-9205-4c581c624dd0: 109159 objects, 3.95 GB, and 211 presim sidecars (spr 8.0.0 had 46).
   - All four seed files applied, cursors last (rows written: opr 15956, epa 25132, spr 25248, cursors 50).
   - The run then died in a network fetch at the start of verify.
4. **Worker.** `npx wrangler deploy` ran from apps/worker right after `seed-spr.sql` landed, with the tree clean except docs/publish-budget.md. Version f5402d4c-5e24-49cf-826f-5432f105f356, every-minute schedule.
5. **Verify.** `pnpm rebaseline --from verify --skip-prune` reports live generation b2bfe488, with opr@6.0.0, epa@13.0.0 and spr@9.0.0. It found 47 live windows, 1 open (probe-only).
6. **D1 read-back.** All three league rows are on generation b2bfe488 at shape 17. The spr row carries `sigmascoutRpPopulation` for season 2026, and the row is 773 bytes.
7. **Districts.** `pnpm publish:districts` exited 0. It published 14 districts for 2026. Every season's "now" bake census reports baked 0: at "now" every event is already played, so there is nothing to bake. The carry's coverage shows at as-of instants, where G5 was checked.
8. **Content with an Origin header.** The live manifest reads generation b2bfe488 with spr 9.0.0. `v1/presim/2026joh/spr@9.0.0+baseline.json`, `v1/compare/2026.json` and `v1/team/frc254/2026/spr@9.0.0+baseline.json` all return 200, at the published sizes.
9. **Owed.**
   - `pnpm rebaseline --from prune` after 6 hours, i.e. after 2026-09-29T05:40Z.
   - The ingest's handling of TBA 404s.
