---
quick_id: 260917-jl1
status: complete
one_liner: "Bonus RP dots restyled per sketch 019 variant F: predicted likely draws as an actual earned dot, toss-up is hatched, an actual not earned is a small pip, every letter is one dark ink"
files_modified:
  - apps/web/src/styles/theme.css
  - apps/web/src/lib/bonusRp.test.ts
  - apps/web/src/lib/bonusRp.ts
  - apps/web/src/components/team/BonusRpDots.tsx
commits:
  - 6665b416: "feat(quick-260917-jl1): restyle bonus dot tiers per sketch 019 variant F (hash before the rebase onto main)"
  - 17a7975c: "docs(quick-260917-jl1): sweep stale bonus dot descriptions to match sketch 019 F (hash before the rebase onto main)"
key_decisions:
  - "Predicted likely shares the actual earned ground (30% alliance tint); Jacob found the 60% fill too dark"
  - "Predicted toss-up is a 135deg hatch of the 30% tint over the surface; Jacob chose 30% over the 45% the orchestrator's 1x capture favoured"
  - "Actual not earned is a 6px pip with font-size 0, so the letter stays in the DOM and the aria-label still names the bonus"
  - "One --color-text-primary letter on every non-unknown dot; six unused alliance fill and ink tokens deleted"
date: 2026-09-17
---

# 260917-jl1: bonus RP dots per sketch 019 variant F

Follow-up to 260917-06d. That task shipped three tiers as empty / 25% tint / 60% fill; on the live row
the tint and the fill were too hard to tell apart, and the fill was too dark. Sketch 019 explored five
alternatives, Jacob mixed two of them into variant F and approved the render. This task builds F.

## What changed

- `theme.css`: predicted likely uses the same `--alliance-*-soft` ground as `.bonus-dot--earned`.
  Predicted toss-up draws `repeating-linear-gradient(135deg, soft 0 2px, surface 2px 4px)`. Predicted
  unlikely is unchanged (outline with its letter). A bare `.bonus-dot--missed` rule shrinks the actual
  not earned dot to 6px with `margin: 0 4px`, keeping the 14px slot so rows do not reflow. One shared
  rule sets the letter to `--color-text-primary` on earned, missed and predicted dots. Deleted
  `--alliance-{red,blue}-fill`, `-fill-faint` and `-dot-ink` (no other consumer in apps/ or packages/).
  Recorded contrast: letter on the 30% ground 11.0:1 red, 11.5:1 blue.
- `bonusRp.test.ts`: new CSS text pins for the pip rule, the per side hatch, and likely sharing the
  earned ground. Each failed against the old CSS before the change.
- `bonusRp.ts`, `BonusRpDots.tsx`: doc comments describe the new look. No logic change: cutoffs,
  `bonusDotTier`, `data-tier` and the tooltip percentage are untouched.

## Verification

- `apps/web` vitest: 115 files, 1849 tests passed.
- Root and `apps/web` typechecks: clean.
- Root vitest in the worktree: 5304 passed, 3 failed, in `packages/harness/rpSeed.test.ts` and
  `sigmaSeed.test.ts`. Triaged by the orchestrator: a worktree artifact, not a regression. The fresh
  checkout has CRLF line endings (2570 in `publish.ts`, 0 in the main checkout) and those tests match
  `\n}\n` against the file text. The same two files pass 13/13 in the main checkout.
- Browser check by the orchestrator against live data (team 254, 2026, dev server from the worktree):
  likely and earned compute to the same `rgba(..., 0.3)` ground, toss-up computes to the gradient, the
  pip measures 6x6 and keeps `aria-label="Energized: not earned"`, every letter computes to
  `rgb(15, 23, 42)`. The rendered rows match the approved sketch.

## Found along the way

- The local visual verification recipe (empty `VITE_ARTIFACT_ORIGIN`) no longer works: `vite.config.ts`
  now reuses that value as the proxy target, so an empty value proxies to nowhere and every artifact
  request returns 502. Working alternative: run vite with the default origin and have Playwright
  re-fulfil `https://data.sigmascout.org/**` responses with an `access-control-allow-origin` header.
- The two harness structural tests above fail on any CRLF checkout. Not fixed here (out of scope).

## Deviations from Plan

None.
