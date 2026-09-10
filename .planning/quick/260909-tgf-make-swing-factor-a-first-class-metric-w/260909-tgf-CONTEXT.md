# Quick Task 260909-tgf: Swing Factor as a first-class metric with rarity tiers - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Task Boundary

Make Swing Factor a first-class metric with rarity tiers:

1. Publish it as a **synthetic metric** on every algorithm (opr, epa, bpr), so it
   picks up the existing percentile/tier/sort/grid machinery rather than staying a
   bare top-level `swingFactor` field.
2. **Percentile it conditioned on the team's scoring ability**, so strong robots are
   not automatically high-swing.
3. **Invert the tier direction** — lower swing (more consistent) is better, so low
   swing must earn Legendary.

Ends at green tests plus a local-artifact visual check. The R2 republish is
explicitly OUT of scope for the executor (see Decisions).

</domain>

<decisions>
## Implementation Decisions

These were settled with the developer before planning. They are LOCKED — do not
revisit, re-litigate, or "improve" them.

### D1 — Normalization: residual vs. a fitted rating curve

Percentile the team's **gap from an expected-swing curve**, not its raw Swing Factor
and not a ratio.

- Fit expected swing as a function of the team's scoring ability across the season
  pool for that (algorithm, season) pair.
- A team's conditioned value is its **residual**: actual swing minus expected swing
  at its own rating.
- Percentile that residual against the same season pool the existing percentile pass
  uses (`percentiles.ts`'s `sortedPoolsByMetric`) — never a visible subset.

Rationale: this answers "swingier than robots of its caliber" directly.

REJECTED and why, so nobody re-proposes them:
- **Coefficient of variation** (`swing / rating`) — unstable at low ratings; a team
  rated 2.0 with swing 3.0 produces a wild ratio, so weak teams dominate both tails.
- **Rating-decile strata** — creates visible discontinuities at bucket edges; two
  near-identical teams can land in different tiers.

The specific functional form of the fit (log-space linear, isotonic, LOESS, etc.) is
Claude's discretion — see below — but the *residual* framing is not.

### D2 — Direction: lower swing is better, always

The developer's words: "more consistent is always always better."

This makes Swing Factor **the first lower-is-better metric in the project**.
`percentileAgainstSortedPool` (`publish.ts`) is strictly monotone — higher value,
higher percentile — and there is no inversion concept anywhere in the pipeline or in
`apps/web/src/lib/tiers.ts` today. The plan must introduce one.

Prefer a **declared per-metric direction** over a hardcoded special case for swing, so
the next lower-is-better metric does not need a second mechanism. Whatever shape it
takes, it must be impossible for a future metric to silently default to the wrong
direction — an explicit declaration beats an inferred one.

NOTE, and write this down in the code: `packages/core/algorithms/sigma1/swing.ts`
documents the opposite framing — Alliance 8 deliberately *wants* a high-swing robot.
That framing is now **overridden for tier purposes** by developer decision. Record the
override at the tier site so nobody "fixes" it back to two-sided later.

### D3 — Display sites: season-header tile and teams-table column ONLY

Tier box renders in exactly two places:

- `apps/web/src/components/team/SeasonHeader.tsx` — the Swing Score tile
- `apps/web/src/components/teams-table/columns.tsx` — the sortable `swingScore` column

**NOT** on `MetricValue.tsx`'s `± X` superscript. A tier ring on a superscript is
visual noise, and that superscript repeats per-metric where swing is one number per
team. Leave that render path alone.

### D4 — Republish is NOT part of this task

The tier is publish-time data, so nothing renders on the live site until seasons are
republished to R2. That republish is the **developer's** step, run from the main
context after this task lands.

The executor MUST NOT attempt it. Executor subagents are network-sandboxed and every
network Bash call is denied, including `pnpm publish:seasons` — an attempt will fail
confusingly rather than usefully.

### D5 — Stage commits by explicit path

Another session is editing this checkout concurrently. At plan time the working tree
carried unrelated modifications to `apps/web/src/components/event/EventMatchTable.tsx`,
`apps/web/src/components/team/MatchTable.tsx`, and `apps/web/src/styles/theme.css`.

**Never `git add -A` or `git add .`** Stage each commit with explicit paths so this
task cannot absorb another session's work.

### Claude's Discretion

- The functional form of the expected-swing fit (D1 says *residual*; it does not say
  *how*). Pick something robust to outliers and cheap to compute once per
  (algorithm, season). State the choice and its rationale in the code.
- The metric key/name Swing Factor is published under, and its label.
- The exact shape of the direction declaration (D2).
- Whether the per-team artifact carries the residual, the percentile, or both.
- Test structure and placement.

</decisions>

<specifics>
## Specific Ideas

Key files identified during scoping — the planner should verify rather than trust
these line numbers, but the structure is confirmed:

- `packages/harness/swingFactor.ts` — the estimator. Its header documents the
  deliberate "level 1 = algorithm / level 2 = SigmaScout feature" layering, and
  explicitly says this is NOT part of any algorithm. Promoting it to a metric
  **crosses that boundary**, so the header must be rewritten to describe a synthetic
  metric injected at publish time rather than left silently contradicting the code.
- `packages/harness/pageArtifacts.ts` — `TeamMetricSchema` (`value` / `spread` /
  `percentile` / `tier`), `TEAM_METRIC_TIERS`, `publishedTierForPercentile`, and the
  positional teams-table encoding. `encodeTeamMetricEntry` **throws** if handed a
  metric carrying `percentile` — the teams row publishes `tier` only.
- `packages/harness/publish.ts` — the percentile passes (`withPercentiles`,
  `withEventPercentiles`, `withPublishedTiers`) built on
  `percentileAgainstSortedPool`.
- `apps/web/src/lib/tiers.ts` — `tierForPercentile`, which delegates cuts to
  `publishedTierForPercentile` so client and pipeline cannot disagree. Preserve that
  single-source property through the direction change.
- `apps/web/src/components/team/SeasonHeader.tsx` — `SwingScoreTile`, currently
  reading `artifact.swingFactor`.
- `apps/web/src/components/teams-table/rowModel.ts` — maps `swingFactor` onto
  `swingScore`.

Tier cuts are unchanged: Common [0,50) / Rare [50,75) / Epic [75,95) / Legendary
[95,100]. Only what feeds the percentile changes.

</specifics>

<canonical_refs>
## Canonical References

- `.claude/skills/sketch-findings-sigmascout/` — the rarity-tier palette and its
  accessibility constraints. **Load this before touching any UI**, per the project's
  own skill blurb.
- `.claude/skills/sketch-findings-sigmascout/references/colour-and-tiers.md` — the
  tier names, cuts, and key-row copy.
- `.claude/CLAUDE.md` — project instructions, including the secrets-handling rules.

</canonical_refs>
