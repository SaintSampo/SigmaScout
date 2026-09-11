# Simulation architecture audit

**Audited 2026-09-10 against HEAD and against live R2 (`data.sigmascout.org`).**
Written to answer three questions: what are the simulation tab's inputs, what are its
outputs, and what would it take to move the pre-schedule simulation out of the published
sidecar and into the browser.

---

## 1. There is one tab and two engines

The Simulation tab (`apps/web/src/components/event/SimulationTab.tsx`) is a single panel
whose content is decided by one piece of state: `StartSelection`, which has exactly two
shapes (`StartMatchPicker.tsx:63`).

| Selection | Engine | Where the draws happen | Cost to the visitor |
|---|---|---|---|
| `{ kind: "preSchedule" }` — the picker's "Before schedule release" stop | **Baked** | Offline, in `pnpm publish:seasons` | Zero compute; one ~139–266 KB fetch |
| `{ kind: "match", matchKey }` — any qualification row | **Live** | Browser Web Worker, on Run press | ~97 ms end-to-end (measured) |

Both engines call the **same** function — `simulateRanks` in
`packages/core/algorithms/simulation/rankSimulation.ts` — and both produce the same
`SimResult` shape, which is why `decodePreScheduleResult` exists: it unpacks the baked
histograms *into* a `SimResult` so both paths feed one row builder
(`buildRankDistributionRows`). That single-row-builder rule is load-bearing; a second builder
would let the two views disagree about the same event while both looked plausible.

---

## 2. The live (per-match) engine

### Inputs

Everything comes from **one already-fetched artifact**:
`v1/event/{eventKey}/{algo}@{version}.json`. No second network call.

`buildSimulationInputs(artifact, startMatchKey)` (`apps/web/src/lib/simulationInputs.ts`)
turns that artifact plus a chosen start match into:

| Field | Source | Notes |
|---|---|---|
| `remainingMatches: SimMatchInput[]` | every `qm` row at/after the start index | `{redTeamKeys, blueTeamKeys, redRpPmf, blueRpPmf}`. A row with no usable pmf pair is **excluded**, never fabricated. |
| `baselines: SimTeamBaseline[]` | played `qm` rows strictly before the start, plus `artifact.teams` | `{teamKey, earnedRpSum, matchesPlayed}` — `earnedRpSum` is a TOTAL, converted from TBA's per-match-average Ranking Score by multiplying by `record.wins+losses+ties`. |
| `excludedMatchKeys` | the pmf-less remainder | disclosed, not absorbed |
| `incompleteBaselineTeamKeys` | prefix rows with `null`/absent actual RP | baseline is known-incomplete rather than silently depressed |
| `baselineSources` | per team | one of four: `ranking-score-with-record`, `ranking-score-with-appearances`, `summed-actual-rp`, `no-played-matches` |
| `isRewindStart` | any played row at/after the start | flips baseline construction from Ranking Score to summed-actual-RP |

Fixed constants: `SIMULATION_DRAWS = 1000`, `DEFAULT_SIMULATION_SEED = 20260830`,
`PROGRESS_CHUNK_DRAWS = 50`. The seed is fixed so the same event + same start match always
gives the same distribution.

### Transport

`useSimulationRun.start()` constructs the Worker lazily (inside the click handler — never at
module scope, never on mount, because Radix keeps every `TabsContent` mounted-but-hidden) and
posts a `SimulationRequest`:

```
{ type: "run", matches, baselines, draws: 1000, seed: 20260830 }
```

Randomness crosses as a **number**, not an rng function — a function isn't
structured-cloneable and would `DataCloneError` at `postMessage`.

`simulationProtocol.ts` validates shape and cost bounds (`MAX_SIMULATION_DRAWS = 10000`,
`MAX_SIMULATION_MATCHES = 500`), then runs `simulateRanks` in 50-draw chunks sharing one
`mulberry32` stream, emitting a `progress` message per chunk.

### Outputs

- `progress` → `{completedDraws, totalDraws}` → the determinate bar in `RunControl`
- `result` → `{rankHistograms: Map<teamKey, Int32Array>, draws, computeMs}` — per-rank **draw
  counts**, never probabilities, indexed `rank - 1`
- `error` → `{name, message}`, which the hook deliberately **discards** (the error state
  carries no payload field at all, so a message can never reach a screen)

`buildRankDistributionRows` then joins to the roster and emits one `RankDistributionRow` per
team: `medianRank` (continuous p50), `medianDisplay`, `p10`, `p90`, the raw `histogram`, and
`maxBinCount` (this row's own bar normalizer). Rows sort ascending by the **continuous**
median, ties broken by `teamKey`.

### Measured cost

From `08-13-SUMMARY.md`'s committed Playwright measurement (78 teams, 130 matches, 1000 draws,
real R2 bytes): **97 ms elapsed** main-thread, of which **21.3 ms** was the draw loop. The
other ~76 ms is Worker construction plus request/result transfer.

---

## 3. The pre-schedule (baked) engine

### Pipeline inputs

`buildPreScheduleSidecarForEvent` (`packages/harness/publish.ts:1657`) →
`buildPreScheduleArtifact` (`packages/harness/preSchedule.ts`).

| Input | Source |
|---|---|
| `roster` | match-derived when matches exist, `event_teams` otherwise; sorted — the sort **is** the published index space |
| `matchesPerTeam` | the real schedule's own when it exists, else Statbotics' 12 (10 for Champs divisions) |
| schedule template | `data/schedule-templates/` — Team 254's cheesy-arena balanced grids, **gitignored** (custom licence, not MIT); a 3-cell committed fixture grid covers CI only |
| `predict` closure | bound to the walk-forward **pre-event** state when the schedule has landed, **season-final** state when it hasn't (`pricedFrom`) |
| `fillRankingPoints` | the SigmaScout level-2 RP filler, so opr/epa get pmfs too (before 2026-09-09 this was VPR-only) |

K = `PRESIM_SCHEDULE_COUNT` = **20** synthetic schedules, each a seeded Fisher–Yates shuffle of
roster→template slots. Seeds are FNV-1a over `eventKey|algorithmVersion|shuffle|k` — no
platform RNG anywhere, so a republish is byte-identical.

### Pipeline outputs — the sidecar

`v1/presim/{eventKey}/{algorithmId}@{version}.json`, schema `PreScheduleArtifactSchema`
(`pageArtifacts.ts:1837`):

```
roster: string[]                       // the index space
schedules: [{ seed, matches: [{ r:[3], b:[3], rp:number[], bp:number[] }] }]  x 20
baked:    { draws, histograms: number[][] }   // one per roster team, in roster order
pricedFrom, matchesPerTeam, season, eventKey, + algorithm preamble
```

`r`/`b` are roster **indices**, not team keys. `rp`/`bp` are the same physical quantity, same
encoding and same `ROUNDING_RULE.pmf` precision as a real match's `redRpPmf`/`blueRpPmf`.

`baked` is 20 schedules × `PRESIM_DRAWS_PER_SCHEDULE` (50) = **1000 draws**, deliberately
matching the client engine's `SIMULATION_DRAWS` so the two views are the same kind of quantity
at the same resolution. Baselines for the bake are zero-for-everyone — which is exactly what
"before schedule release" means.

Four schema refinements (valid pmfs, in-range roster indices, unique roster, histogram
length/sum) are what make `MalformedRankHistogramError` unreachable in front of a visitor. The
client deliberately re-checks none of them.

The sidecar is **not a `PageKind`**. That's structural, not stylistic: the live Worker's
artifact writer is keyed on `PageKind`, so it cannot address, clobber, or delete a sidecar
mid-event. It also sits outside `payloadBudget`'s machine-readable gate.

### Client read path

Route `event.$eventKey.tsx:207` gates the fetch on `activeTab === "simulation"` — lazily, and
never inside `SimulationTab` itself (Radix would otherwise fetch on every event page load).
`fetchPreScheduleArtifact` returns **`null` on 404** rather than throwing, because an absent
sidecar is an ordinary permanent state (pre-2026 season, offseason event, cold-start first
event, RP-less algorithm). Every other non-OK status still throws.

`decodePreScheduleResult` then rebuilds `{rankHistograms, draws}` from `baked` alone. **The 20
priced schedules are downloaded and never read by the client.**

### Measured size (`2026mrcmp`, 66 teams, vpr@10.0.0, fetched live today)

| Component | Bytes | Share |
|---|---:|---:|
| `schedules` (20 × 132 matches × 2 pmfs) | 253,295 | **95.4%** |
| `baked.histograms` (66 × 66 ints) | 11,378 | 4.3% |
| `roster` | 641 | 0.2% |
| **Total** | **265,617** | |

`docs/publish-budget.md`'s presim table (from the 2026-09-06 retune republish, the same
generation still serving): 216 sidecars, median 138,710 B, p95 243,647 B, max 265,617 B.

---

## 4. Live status: the pre-schedule stop is currently dark

Verified against production today:

```
v1/presim/2026mrcmp/bpr@3.0.0.json                     -> 404
v1/presim/2026mrcmp/epa@7.0.0+baseline.json            -> 404
v1/presim/2026mrcmp/vpr@10.0.0+rolling-2026-09d.json   -> 200  (265,617 B, generation 7a2e4e5b, computed 2026-09-06)
manifest algorithms                                     -> opr 4.0.0 / epa 7.0.0 / bpr 3.0.0
```

Two independent reasons:

1. **Every sidecar in R2 is keyed to `vpr`**, which was retired from the published set on
   2026-09-09. The client only ever requests `{selected algorithm}@{manifest version}`, so
   those objects are unreachable orphans.
2. **Generation has been off since 2026-09-10**: `publish:seasons` runs with
   `--presim-from-season 9999` (commit `1a759198`), added while the simulation/swing rethink
   iterates. The last three republishes wrote zero sidecars.

So today the tab opens on `defaultStartMatchKey` (first unplayed row, or `qm1` on a finished
event) and only the live engine can produce anything.

The live engine itself **does** work on current bytes — spot-checked: `2026mrcmp` carries
132/132 qual rows with pmfs; `2024casf` carries 57/72, the 15 gaps being exactly `qm1`–`qm15`
(the Swing-Factor cold-start chain, already measured under quick task 260910-kco).

---

## 5. Moving the pre-schedule simulation into the browser

The headline: **95% of the sidecar is already the simulation's inputs, and the browser
already ships the engine that consumes them.** The baked block is the small part.

### Option A — ship the schedules, drop `baked` (small, mechanical)

Client fetches the same sidecar, decodes `r`/`b` against `roster` into `SimMatchInput[]`,
zero-baselines every team, and runs the existing Worker.

- **Payload**: −11 KB (−4%). Not the win.
- **Compute**: 20 schedules × 132 matches × 50 draws is the same 1000 total draws the live
  engine already does in ~21 ms. Essentially free.
- **What it buys**: reader-chosen draw counts, and visible schedule-to-schedule spread —
  currently averaged away inside `baked`, which pools all 20 schedules into one histogram.
- **What it costs**: first paint stops being zero-compute. Today the baked path renders a full
  rank table with no Worker at all.
- **Risk**: low. The decode is ~15 lines and every guarantee (`isValidPmf`, index range,
  roster uniqueness) is already enforced by `PreScheduleArtifactSchema` at fetch time.

### Option B — generate the schedules in the browser, ship only the pricing (large)

Client does the Fisher–Yates shuffle itself and prices each synthetic match.

- **Payload**: could drop to a few KB per event.
- **Blocker 1 — templates.** `data/schedule-templates/` is Team 254's licensed cache,
  gitignored and explicitly not redistributable. Shipping it to browsers is a licence
  question, not an engineering one. A browser-side balanced-schedule generator would be new
  work and would no longer reproduce the published pricing.
- **Blocker 2 — the RP model.** `predict()` → `rpPmfForMatch` needs, per alliance:
  `meanVector`, a T×T `varianceBlock`, `scoreMean`, `scoreVariance`, and a length-T
  `scoreCrossCovariance`, assembled by `RpMomentsAccumulator.momentsFor(roster, scoreMean,
  scoreVariance)` from per-team EWMA beliefs (half-life 6 matches). It then runs **4,000**
  joint draws per match through a Cholesky decomposition (`ml-matrix`) and the season's
  `predictThresholds` rules.
- **Blocker 3 — bundle.** `rankSimulation.ts` is deliberately a zero-import browser-safe leaf
  precisely to keep `ml-matrix` out of the bundle. Option B reverses that decision.
- **Blocker 4 — C-04.** The published contract is that every presim pmf comes from the *same*
  joint-covariance path real matches use. A browser reimplementation makes that a promise
  again instead of a structural fact.

Cost estimate: 2,640 synthetic matches × 4,000 joint draws ≈ 10.5M multivariate draws per
event — three to four orders of magnitude above what the rank draws cost. Not viable as-is.

### Option C — ship per-team RP parameters, price alliances cheaply in the browser

The middle path, and the only one that meaningfully shrinks the payload without
reimplementing the joint model: publish each team's threshold-variable beliefs + swing factor
(~T means, T variances, 1 swing ≈ tens of bytes per team, so ~2–5 KB for a 66-team event), and
have the browser build alliance moments and draw a **cheaper** approximation.

- Requires deciding what approximation is honest enough to publish under, since it would no
  longer be the same computation as a real match's pmf. That is a modelling decision, not a
  refactor.
- `swingFactor` is already published, but on **team-season** artifacts (season-final), not on
  event artifacts — an event page would need it added.

### Recommendation

If the goal is *payload*, Option A saves 4% and is not worth doing alone. If the goal is
*capability* — reader-chosen schedule count, visible schedule-to-schedule spread, no republish
needed to change draw behaviour — **Option A is the right move and is cheap**, because the
inputs are already on the wire and the engine is already in the bundle. Option C is the only
path to a genuinely small payload, and it needs a modelling decision first.

Whichever way this goes, two things should be settled first, because both currently block the
feature regardless of where it runs:

1. **Re-key or regenerate the sidecars.** Every one in R2 belongs to a retired algorithm.
2. **Decide the cold-start gate.** The measured fix filed under 260910-kco — one wide fallback
   variance for sub-two-observation teams — heals played rows, upcoming rows and the whole
   presim gate at once.

---

## 6. File map

| File | Role |
|---|---|
| `packages/core/algorithms/simulation/rankSimulation.ts` | the one Monte Carlo core; `mulberry32`, `drawCategorical`, `simulateRanks` |
| `packages/harness/preSchedule.ts` | pure sidecar builder; owns no pricing math |
| `packages/harness/scheduleTemplates.ts` | licensed template reader + CI fixture fallback |
| `packages/harness/publish.ts:1657` | per-event skip/price decisions, `pricedFrom` switch |
| `packages/harness/pageArtifacts.ts:1798,1837` | `preScheduleKey`, `PreScheduleArtifactSchema` |
| `apps/web/src/lib/simulationInputs.ts` | artifact + start match → `SimulationInputs` |
| `apps/web/src/lib/api/preSchedule.ts` | sidecar fetch; 404 → `null` |
| `apps/web/src/lib/preScheduleResult.ts` | `baked` → `SimResult` |
| `apps/web/src/workers/simulationProtocol.ts` | message contract, bounds, chunked progress |
| `apps/web/src/workers/simulation.worker.ts` | 3-statement Worker entry, no arithmetic |
| `apps/web/src/components/event/useSimulationRun.ts` | Worker lifecycle + run state machine |
| `apps/web/src/components/event/SimulationTab.tsx` | selection state, freshness signature, branch order |
| `apps/web/src/components/event/StartMatchPicker.tsx` | the two selection kinds |
| `apps/web/src/components/event/rankRows.ts` | `SimResult` → display rows |
| `apps/web/src/routes/event.$eventKey.tsx:207` | the lazy sidecar fetch gate |
| `scripts/measureRewindGap.ts` | the offline second consumer of `simulateRanks` |
