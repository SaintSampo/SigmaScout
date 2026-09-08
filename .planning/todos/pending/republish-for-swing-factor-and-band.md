---
id: republish-for-swing-factor-and-band
created: 2026-09-08
source: quick task 260908-5wd — the pipeline and the read side are shipped; the republish that makes them live is not
resolves_phase:
priority: high
---

# The Swing Factor / band fields are built but NOT published yet

`203a2bea` teaches the pipeline to compute and publish four SigmaScout-layer fields for EVERY
algorithm; `53b4bf87` teaches the site to read them. **No artifact in R2 carries them yet.** The
site is correct in the meantime — it falls back through the algorithm's own variance and then the
browser computation — but OPR and EPA still show no band on a team page until this runs.

## What to run

```
pnpm publish:seasons
```

(`tsx --env-file=.env packages/harness/publish.ts --seasons 2016-2020,2022-2026 --include-offseason`)

Long-running — hours. Background it and verify by object counts and WAL/row activity, not by a
quiet log (see `.planning/todos/`'s sibling notes and the retune-republish skill).

## Why it did not run on 2026-09-08

A `tune.ts --stage joint --origin 2026` was live in this checkout (another session's VPR work),
with 26 node processes up. Starting a multi-hour republish into that contention was the wrong
call. **Check for both a running publish AND a running tune before starting:**

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*publish*' -or $_.CommandLine -like '*tune*' }
```

## Verify after it lands

1. An OPR event artifact carries `redSwingBandVariance` on played matches:
   `curl -s "https://data.sigmascout.org/v1/event/2026casnv/opr@4.0.0+baseline.json" | grep -c redSwingBandVariance`
2. An OPR TEAM artifact carries it too, and a team page match shows the same number as the event
   page for that match — that identity is the whole point, and it holds by construction because
   both rows are built from one shared `PredictionRecord`.
3. A team artifact carries a top-level `swingFactor`, and the team tile shows it INSTEAD of the
   algorithm's own `spread` (BPR publishes a `spread` of 12.46 for frc254; the tile should show
   the Swing Factor, not that).
4. The `/teams` artifact carries `swingFactor` per row.

## Then delete the bridges

Three pre-republish fallbacks exist only until every artifact carries the new fields, and each
says so in its own comment:

- `apps/web/src/components/event/eventMatchAxis.ts` — the `?? row.redScoreVarianceOwn ?? red`
  chain collapses to the published field alone.
- `apps/web/src/components/team/MatchTable.tsx` — `swingBandSd`'s second argument goes away.
- `apps/web/src/components/team/SeasonHeader.tsx` — the browser-computed branch goes, and with it
  `apps/web/src/lib/swingFactor.ts` and `apps/web/src/lib/allianceBand.ts` entirely.

## Known gap this does NOT close

**Live-updated matches carry no band at all**, and never have. `apps/worker/src/scheduled.ts`'s
`buildEventMatchRow` (line 463) emits no `redScoreVarianceOwn` and now emits no swing band either,
so during a live event every match the Worker folds loses its band until the next full publish.
This predates the task and is not a regression from it.

Closing it is a real design change, not a mirror edit: the Worker holds per-team ALGORITHM state
in D1, not the residual history a Swing Factor needs. It would need a new per-team accumulator
persisted alongside that state, with its own shape bump and migration. Worth doing before relying
on bands during a live event; not worth rushing into a live-serving component.
