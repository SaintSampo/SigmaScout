# Quick Task 260903-krp: origin-based season labelling in score.ts - Context

**Gathered:** 2026-09-03
**Status:** Ready for planning

<domain>
## Task Boundary

`packages/harness/score.ts` still encodes the retired fixed tune/holdout split:

```ts
export type SeasonLabel = "tune" | "holdout";
export const TUNE_SEASONS = [2022, 2023, 2024] as const;
export const HOLDOUT_SEASONS = [2025, 2026] as const;
export function seasonSplit(season: number): SeasonLabel {  // THROWS outside 2022-2026
```

`seasonSplit` is called from `aggregateScores` (`score.ts:183`), and `aggregateScores` is imported
by `tune.ts`, `cli.ts`, `promote.ts`, `publish.ts` and `eventScopeDiagnostic.ts`. **So every
scoring path throws on 2019 or 2020.**

The corpus now holds 2019, 2020, 2022-2026, and all seven seasons have registered breakdown and
RP modules (quick task `260903-4fs`). The data and the parsers exist; only this guard stops them
being scored. **This is the single blocking item for `retune-sigma1-rolling-origin` and therefore
for the entire promote -> republish -> re-measure chain.**

Replace the fixed split with origin-based labelling.

</domain>

<decisions>
## Implementation Decisions — LOCKED

### D-1 — Delete the tune/holdout vocabulary; do not re-vocabularize it

`SeasonLabel`, `TUNE_SEASONS`, `HOLDOUT_SEASONS` and `seasonSplit` all go. This is
`rolling-origin-hyperparameter-tuning`'s **D-5**, which established that since only origin seasons
are ever displayed, a per-slice label distinguishing tune from holdout has nothing left to say.

`headlineEligible` **stays** and becomes the single honest flag. It remains meaningful at the
ScoreSlice level even though it is constant within a published Compare artifact, because
`aggregateScores` also scores selection-only seasons (2019, 2020) that the tuner needs and Compare
never shows.

### D-2 — The rule: a season is headline-eligible if AT LEAST TWO prior seasons are being scored

Derived from the corpus actually in play, **never from a new hardcoded year list** — replacing one
hardcoded range with another would miss the entire point.

Two, not one, because `rolling-origin-hyperparameter-tuning`'s **D-4** ruled that a single-season
prior is too thin to carry a headline claim. That rule is preserved; only its inputs changed.

### D-3 — D-4's specific verdict on 2023 is SUPERSEDED by the corpus backfill

D-4 concluded "2023 is not headline-eligible" because, on a 2022-2026 corpus, 2023's only prior
season was 2022. The backfill changed the inputs: 2023 now has 2019, 2020 and 2022 before it.

Under D-2 the origin set is therefore:

| season | prior seasons in corpus | origin / headline-eligible |
|---|---|---|
| 2019 | none | no |
| 2020 | 2019 only — thin | no |
| 2022 | 2019, 2020 | **yes** |
| 2023 | 2019, 2020, 2022 | **yes** |
| 2024 | + 2022, 2023 | **yes** |
| 2025 | ... | **yes** |
| 2026 | ... | **yes** |

**Headline seasons go from 2 (the retired holdout pair) to 5**, and to 6 when 2027 plays. Record
this in the code comment — it is the backfill's payoff and the reason D-4's verdict moved.

Note the pleasant consequence: the displayed Compare set under D-5 (origins only) is 2022-2026,
which is exactly what Compare displays today. **The visible season list does not change.** Only the
labelling and its honesty do.

### D-4 — The live site MUST keep working against 5.0.0 artifacts

There are 32 unpushed commits and pushing `main` triggers a Cloudflare Pages deploy
(`.github/workflows/deploy.yml`). Published artifacts still carry **5.0.0** data including
`seasonLabel`, and **nothing is republished by this task**.

So the client must render correctly BOTH against today's live artifacts (which HAVE `seasonLabel`)
and against the post-republish shape (which will NOT). Make the client's read tolerant — treat the
field as optional and degrade gracefully — rather than assuming either shape.

`apps/web/src/components/compare/MethodologyNote.tsx` is the only client module reading
`seasonLabel`; its own header notes `AccuracyTable.tsx` deliberately reads neither field. Its
tune-vs-holdout prose loses its subject and needs rewriting for the new scheme, but it must not
crash or render nonsense against a live 5.0.0 artifact in the meantime.

### Claude's Discretion

- The shape of the eligibility helper and where it lives.
- How `report.ts`'s two-tone styling (`holdout-row`/`tune-row` at :81, `bar-holdout`/`bar-tune` at
  :188, `SEASON_LABEL_TEXT` at :89/:264) is re-expressed — it should key on `headlineEligible`
  alone now.
- MethodologyNote's replacement prose, subject to D-4's tolerance requirement.

</decisions>

<specifics>
## Specific Ideas

**Consumers to update** (grep-verified, excluding tests and fixtures):

- `packages/harness/score.ts` — the definitions, and `:230-231` where slices are built
- `packages/harness/artifact.ts:51-53` — `ScoreSliceSchema`
- `packages/harness/pageArtifacts.ts:1219-1220` — `CompareSliceSchema` (the PUBLISHED shape)
- `packages/harness/report.ts` — :81, :82, :89, :188, :264
- `packages/harness/tune.ts` — :62 and :340 are COMMENTS referencing the retired predicate; correct
  the prose, there is no live call
- `apps/web/src/components/compare/MethodologyNote.tsx` — see D-4

**Do NOT** run a tuning search, a publish, a promote, or a full harness replay. This task removes a
blocker; it does not exercise what it unblocks.

**Watch for a false green.** `apps/web/src/routes/__fixtures__/compare-*.json` are byte-pinned in
tests and carry the 5.0.0 shape with `seasonLabel`. If a schema change makes those fixtures fail to
parse, that is a REAL signal about the live artifacts, not a fixture to quietly regenerate. Regenerating
them to match a shape nothing has published yet would hide exactly the compatibility break D-4 exists
to prevent.

**Known test-run traps** (project memory): `timeout <n> pnpm <cmd>` swallows output and exits 0 —
never use it. Run `npx vitest run` from the REPO ROOT; from `apps/web` it collects a much smaller
file set and has hidden a red suite before.

</specifics>

<canonical_refs>
## Canonical References

- `.planning/todos/pending/rolling-origin-hyperparameter-tuning.md` — D-1 through D-5, especially
  D-4 (thin-prior rule) and D-5 (display only origin seasons; delete rather than re-vocabularize)
- `.planning/todos/pending/extend-corpus-2019-2020.md` — the backfill that changed D-4's inputs
- `packages/harness/tune.ts:20-70` — the shipped rolling-origin selection machinery and its gates
- `.github/workflows/deploy.yml` — why D-4's compatibility constraint binds

</canonical_refs>
