---
id: retire-vpr-8-generation-r2
created: 2026-09-05
source: the 9.0.0 Rule-A promotion bump, 2026-09-05 — publish-budget.md's own warning: "a re-baseline that also bumps an algorithm's code version orphans the prior generation in R2"
priority: high
---

# Delete pass: reclaim the orphaned vpr@8.0.0 generation from R2

The 2026-09-05 Rule-A promotion bumped `SIGMA1_CODE_VERSION` 8.0.0 -> 9.0.0 and
republished everything under `vpr@9.0.0+rolling-2026-09c`. `pnpm publish:seasons` has no
cascading delete, so every `vpr@8.0.0+*` page object (and the epa/opr objects from the
superseded generation, if any keys moved) is still sitting in R2 unreferenced by the
manifest — not site-breaking (readers resolve only the manifest's current version), but a
real, measured multi-GB chunk of the 10 GB free tier.

Run the recorded version-retirement procedure — `docs/publish-budget.md`'s "Delete pass"
sections, the routine `--supersedes-live` invocation — after confirming the 9.0.0
generation is verified live (verify:subset clean, one generation). Record the reclaimed
bytes in publish-budget.md's dated log, same as the 2026-09-04 delete pass entry
(bdaca510) did for the epa@2.0.0 + vpr@7.0.0 generations.

Must run from the main context (network). Prior passes took minutes.

## CLOSED 2026-09-05, same evening — pass run and verified

Census 55/60 present (generation 17966b1d, identified by content) -> 19,261 deletes issued
-> post-census 0/60 on the same stratified sample; the earlier `8.0.0+rolling-2026-09` name
censused 0/60 (already clean, nothing to do). Live-manifest guard confirmed
`9.0.0+rolling-2026-09c` live at run time; `verify:subset` 35/35 on generation f4f8f379
immediately after. ~1.0 GB reclaimed (estimated — see the dated Delete pass entry in
docs/publish-budget.md for the honest estimation basis). R2 holds one full generation again.
