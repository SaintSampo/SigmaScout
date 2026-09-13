# Quick Task 260913-jkp: Sigma columns removed; SPR Total shows a joined Total ± Sigma box - Context

**Gathered:** 2026-09-13
**Status:** On hold. Waiting on (1) the sketch 011 winner and (2) quick task 260913-it4 landing.

<domain>
## Task Boundary

Developer request, verbatim: "delete all sigma columns. now, anywhere total is displayed for SPR,
display a combined box with sigma after total, seperated by a +/- glyph. do this for the teams list,
the total on every team page, and the insight, breakdown, and alliance tabs on every event page."

Where Sigma renders today (verified 2026-09-13):
- Teams list: `sigmaColumn` in `apps/web/src/components/teams-table/columns.tsx` (fed by `rowModel.ts` `sigmaScore`/`sigmaTier`).
- Team page: `SigmaScoreTile` in `apps/web/src/components/team/SeasonHeader.tsx`.
- Event tabs (Insights, Breakdown, Alliances): no Sigma at all. The live event artifact's `teams[].metrics`
  carries only total/phaseAuto/phaseTeleop/phaseEndgame (checked on 2026alhu, spr@3.0.0+baseline).

"Sigma" means the published Sigma Score metric (`SIGMA_METRIC_KEY = "sigma"`, SPR only). It is NOT
`spread`, which must never render (developer rule 2026-09-09).

</domain>

<decisions>
## Implementation Decisions

### Event-tab Sigma source
- **Pipeline route, and wait.** Publish Sigma inside the event artifact's team standings (publish.ts, plus
  the Worker's live event path so a live tick does not drop it), then republish. Do NOT fetch the
  ~200 KB Teams artifact from event pages; an event page is ~20 KB on the wire.
- Hold the WHOLE task, teams list and team page included, until quick task 260913-it4 (tearing out
  Swing Score and the retired VPR) lands. It rewrites publish.ts, apps/worker/src/scheduled.ts,
  swingMetric.ts (becoming consistencyMetric.ts), rowModel.ts, columns.tsx, and AlliancesTab.tsx.

### Box design
- Two joined boxes: Total in Total's own tier colour, Sigma in Sigma's own (inverted) tier colour, ± between.
- **Sketch 011 winner: A, split pill** (developer, 2026-09-13). One rounded shape cut in two with no gap.
  Left half = Total in `metric-tier--{totalTier}`, radius 5px on the LEFT corners only. Right half = Sigma
  in `metric-tier--{sigmaTier}`, radius 5px on the RIGHT corners only, text is a "±" glyph (opacity ~0.7,
  small right margin) followed by the Sigma value to 2 decimals. Both halves keep the shipped tier tokens and
  008-C's inset-ring Common; when both are Common the two rings meet at the seam as a divider (accepted in
  the sketch). Reference CSS: `.jA` rules in `.planning/sketches/011-total-sigma-joined-box/index.html`.
- A team with no published Sigma (OPR, EPA, or an SPR team with no Sigma entry) renders the plain single
  Total box exactly as today; no empty right half.

### Alliances Combined Total
- ± √(3 × ΣSigma²) over the three picks, the Match Band formula (`sigmaMatchBandVariance` convention).
- Open: the combined band has no percentile. The sketch renders that half untiered (plain slate).

### Claude's Discretion
- Column header copy (sketch uses "Total ± Sigma"); fallback for a stale `sort=sigmaScore` URL (resolve
  to Total); the Teams bubble chart's Sigma axis is not a column and stays unless told otherwise.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/sketches/011-total-sigma-joined-box/README.md`
- `.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md` (tier palette, 008-C Common)
- `packages/harness/sigmaScore.ts` (`SIGMA_METRIC_KEY`, `sigmaMatchBandVariance`)
- `packages/harness/publish.ts` (teams row and team-season artifacts already carry `sigma`; event standings do not)

</canonical_refs>
