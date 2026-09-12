---
id: republish-epa-vs-statbotics-methodology-page
created: 2026-09-11
source: quick task 260911-r7e — the measurement fix landed, the republish that makes it public did not
resolves_phase:
priority: medium
---

# The published EPA-vs-Statbotics page understates our own 2022 accuracy by ~2.2 pp

`v1/methodology/epa-vs-statbotics.json` is stale. It still carries the figures produced by the
COLD arm of `compare:epa-statbotics` — the arm that cold-started every team in 2022 because 2022
was the first season of the default `--seasons 2022-2026` range, while the Statbotics column it was
differenced against held its real 2019/2020 carry-in.

This is a published inaccuracy **against ourselves**, not in our favour: the page tells visitors
our 2022 winner accuracy is 0.7576 against Statbotics' 0.7815 (−2.39 pp) when the model actually
achieves 0.7797 (−0.18 pp).

## What is already fixed

Quick task 260911-r7e (commits `75ab70bb`, `ef6c651b`, `54560831`) added `--warmup` and made
`compare:epa-statbotics` pass `--warmup 2016-2020`. **The code is correct; only the published
artifact is behind.**

Production artifacts were never wrong — `publish:seasons` has always replayed
`2016-2020,2022-2026`, so `v1/compare/{season}.json` and every team/event artifact were already
warm. This is scoped to the one methodology artifact.

## The fix

```
pnpm compare:epa-statbotics      # writes reports/epa-vs-statbotics/epa-vs-statbotics.json, now warm
pnpm publish:epa-comparison      # reads that report, writes the R2 artifact
```

Expected published values after the republish (measured under `epa@10.0.0+baseline`, 2026-09-11):

| Season | Statbotics | ours | Δ |
|--------|------------:|-----:|-------:|
| 2022 | 0.7815 | 0.7797 | −0.18 pp |
| 2023 | 0.7647 | 0.7636 | −0.11 pp |
| 2024 | 0.7627 | 0.7578 | −0.49 pp |
| 2025 | 0.7839 | 0.7802 | −0.37 pp |
| 2026 | 0.7978 | 0.7962 | −0.16 pp |

## Watch for

- The **page copy** may assert things the new numbers contradict. Before this task, 2023 showed as
  a SigmaScout accuracy win and 2026 as a Brier win; **neither survives warming.** Check
  `apps/web/src/components/methodology/epaComparisonContent.ts` for any hardcoded "we win 2026 on
  Brier" style claim and re-caption it in the same change as the republish, or the page will
  contradict its own table.
- `statboticsFetched` will likely be `false` again (the `/v3/year/{season}` endpoint returned an
  empty body on 2026-09-08 and the reference constants are dated 2026-09-04/07). That is handled —
  the page renders those cells `(dated)` — but do not mistake it for a failure.
- Must be run from a context with network access. Executor subagents' sandbox denies network Bash.

See `docs/models/epa-vs-statbotics.md`, section "Re-measured under `epa@10.0.0+baseline`".

---

## Page-copy check DONE 2026-09-11 — no copy change is needed

Checked ahead of the republish, since this todo warns that republishing alone would leave the page
contradicting its own table. **It would not.** The contradiction risk is already engineered out:

- **The head-to-head summary sentence is derived, not hardcoded.** `headToHeadSummarySentence()`
  (`epaComparisonContent.ts:151`) computes from `statboticsAheadCount` / `totalSeasons` off the
  artifact's own rows, and carries a doc comment stating the count is "ALWAYS derived from the
  artifact's own head-to-head rows (never a hardcoded number) — the page must not go stale against
  its own table." Under the warm figures it will render *"Statbotics had the higher winner accuracy
  in all 5 measured seasons."*
- **There is no hardcoded Brier claim anywhere.** `Brier` appears only as two `TableHead` labels and
  one neutral explanatory sentence (`epaComparisonContent.ts:140`); every Brier cell renders from
  data via `formatFourDecimals`.
- **The only hardcoded percentages are 73.5 / 75.2 / 74.0** (`epaComparisonContent.ts:121`). Those
  are quick task 260910-4x0's **2024 partition ablation** — eleven vs three vs one rated pieces —
  not the Statbotics head-to-head, and warming the comparison does not touch them.

**So the republish is a clean two-command operation** with no accompanying copy edit.

**One editorial consequence to expect, and it is the honest direction.** The page will move from
its current cold reading to *"Statbotics had the higher winner accuracy in all 5 measured seasons"*
— slightly worse-sounding for SigmaScout, because all five warm deltas are negative (−0.11 to
−0.49 pp). What improves dramatically is the magnitude: 2022 goes from **−2.39 pp to −0.18 pp**. The
page stops overstating our deficit by ~2.2 pp in exchange for losing a season-count talking point
that was an artifact of the cold arm and was never real.
