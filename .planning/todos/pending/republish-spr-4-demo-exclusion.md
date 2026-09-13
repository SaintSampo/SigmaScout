---
id: republish-spr-4-demo-exclusion
created: 2026-09-13
source: stray-team-scope-keys-in-live-d1 (closed 2026-09-13) — spr@4.0.0+baseline is in code, not live
priority: medium
---

# Republish so spr@4.0.0+baseline (demo exclusion) and the placeholder guard go live

`packages/core/algorithms/spr.ts` is at **4.0.0+baseline**: SPR now applies the Off-Season Demo
Team exclusion OPR/EPA already had, and `demoTeams.ts` treats TBA placeholder keys (`frc`, `frc0`,
`frc58 /`) as demo robots. The live manifest still names spr 3.0.0, and live D1 still holds spr
3.0.0 rows, including `frc`/`frc0` for epa and spr and 30 `frc9970`-`frc9999` rows for spr.

## Order matters

1. `pnpm publish:seasons` (the standard full run). SPR's version changed, so every spr key is new
   and the spr@3.0.0 generation is orphaned. OPR/EPA keep their versions and overwrite in place.
   Their 2016/2019 offseason values move slightly (placeholder byes no longer folded). No scored
   OPR/EPA prediction moves.
2. Re-import the D1 seed (`reports/publish/seed-*.sql`). See the D1 seed-import auth memory:
   `--file` needs `.env`'s token, and about 4 seed passes a day trips the row-write cap. Then
   confirm by content that no `algorithm_state` team row has a placeholder or `frc99[7-9][0-9]`
   `scope_key`, except `demo-pseudo-unregistered`.
3. Only then deploy the worker (`npx wrangler deploy` on a clean tree). The worker writes artifacts
   under its code version, so deploying first would write spr@4.0.0 pages with no base generation.
4. `pnpm cleanup:r2-generations --generation spr@3.0.0+baseline` preview, then `--execute`.
5. Transcribe the publish summary into `docs/publish-budget.md` (manual step).
