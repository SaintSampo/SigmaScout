---
quick_id: 260927-syh
mode: quick
---

# Quick Task 260927-syh: champ In range wording, zero award profile in the bake, district republish

Jacob asked for these after 260927-6bf. Executed inline, with no planner or executor subagents.

1. **Champ tab wording.** Add `CHAMP_LEDGER_STATUS_DEFINITIONS`, so In range and Out of range are defined against the predicted cutoff. `StatusChips` takes a `definitions` prop and the champ tab passes the new set. The district tab keeps its current wording. Pin the copy and a champ render test. The copy must contain no hyphen or dash characters.
2. **Publisher.** Move `ZERO_AWARD_PROFILE` into core (`ledgerSimulation.ts`) and re-export it from the web module. `bakeDistrictEvent` fills unprofiled roster teams with it instead of skipping the event with `missing-award-profiles`. It names them in `zeroProfileTeams`, and the publisher logs them. The refusal test becomes a test that the filled bake matches a bake with explicit zero profiles.
3. **Verification.** Run the full suite and four typechecks, push, then check the deploy.
4. **Republish.** Run `pnpm publish:districts` (2016 to 2020 and 2022 to 2026) detached with a log. Then verify the live artifact generation, the wording on both tabs, and the live e2e suite.
