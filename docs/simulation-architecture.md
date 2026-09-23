# Simulation architecture audit

**Audited 2026-09-10 against HEAD and against live R2 (`data.sigmascout.org`).**
Written to answer three questions: what are the simulation tab's inputs, what are its
outputs, and what would it take to move the pre-schedule simulation out of the published
sidecar and into the browser.

**Re-verified 2026-09-12** against `https://data.sigmascout.org`: sections 1, 3, 4, and section
5's first settle-first item. Sections 2, 5 (Options A/B/C, the cost estimate, the
recommendation) and 6 otherwise still carry the 2026-09-10 audit.

**2026-09-13:** as of quick task 260913-it4 the rank simulation runs under SPR only, because OPR and
EPA publish no ranking-point odds. Sections below that describe pmfs on every algorithm predate it.

**Re-verified 2026-09-23** against HEAD (quick task 260923-3w9, a code read, not a live fetch
against R2). Section 3's schema description and size tables were two generations stale, still
quoting 388 to 394 KB per sidecar from before quick task 260912-2ur dropped the priced `schedules`
block from the published body. They are corrected below from `PublishedPreScheduleArtifactSchema`
and from `docs/publish-budget.md`'s 2026-09-21 measured budget. Section 4's byte table carries the
same stale figures and is now labelled historical for the same reason, with a pointer to section
3 for current sizes. Section 5 is rewritten as a closed question: Jacob decided on 2026-09-23 that
the simulation stays client-side in both directions, not moved into the sidecar and not moved into
a server-side Worker (quick task 260923-1tu). Section 6's file map was checked against HEAD with
Glob; one file no longer exists and its row is dropped.

---

## 1. There is one tab and two engines

The Simulation tab (`apps/web/src/components/event/SimulationTab.tsx`) is a single panel
whose content is decided by one piece of state: `StartSelection`, which has exactly two
shapes (`StartMatchPicker.tsx:63`).

| Selection | Engine | Where the draws happen | Cost to the visitor |
|---|---|---|---|
| `{ kind: "preSchedule" }` — the picker's "Before schedule release" stop | **Baked** | Offline, in `pnpm publish:seasons` | Zero compute. One fetch, median 6,855 B, p95 16,005 B, max 23,831 B across all 214 published sidecars (2026-09-21 generation, see section 3). The 139 to 266 KB and 388 to 394 KB figures once quoted here described the sidecar before quick task 260912-2ur dropped the priced `schedules` block. They describe nothing currently on R2. |
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

`buildPreScheduleSidecarForEvent` (`packages/harness/publish.ts:1259`) →
`buildPreScheduleArtifact` (`packages/harness/preSchedule.ts`).

| Input | Source |
|---|---|
| `roster` | match-derived when matches exist, `event_teams` otherwise; sorted — the sort **is** the published index space |
| `matchesPerTeam` | the real schedule's own when it exists, else Statbotics' 12 (10 for Champs divisions) |
| pairing structure | `packages/harness/generatedSchedules.ts` — generates a fresh balanced structure per schedule, seeded from `eventKey`, `algorithmVersion`, a `generate` salt and `k`; needs no files |
| `predict` closure | bound to the walk-forward **pre-event** state when the schedule has landed, **season-final** state when it hasn't (`pricedFrom`) |
| `fillRankingPoints` | the SigmaScout level-2 RP filler, so opr/epa get pmfs too (before 2026-09-09 this was VPR-only) |

K = `PRESIM_SCHEDULE_COUNT` = **1,000** synthetic schedules. Each schedule is its own generated
structure plus a seeded Fisher-Yates shuffle of the roster onto its slots. Structure k is shared
by every event with the same roster size and matches per team (seeded over `generate`, the roster
size, matches per team and `k`, and memoized), and the shuffle and baked seeds are per event.
Seeds are FNV-1a — no platform RNG anywhere, so a republish is byte-identical.

### Pipeline outputs: the sidecar

`buildPreScheduleArtifact` (`packages/harness/preSchedule.ts`) returns the BUILDER shape,
`PreScheduleArtifactSchema` (`pageArtifacts.ts:2345`), which still carries the full priced
`schedules` block in memory: 1,000 synthetic schedules, each `{ seed, matches: [{ r:[3], b:[3],
rp:number[], bp:number[] }] }`. `r`/`b` are roster indices, not team keys, and `rp`/`bp` are the
same physical quantity, encoding and `ROUNDING_RULE.pmf` precision as a real match's
`redRpPmf`/`blueRpPmf`. This block exists only inside the pipeline process, read directly by
`scripts/measureFieldAveragedRanks.ts`. It never reaches R2.

`buildPreScheduleSidecarForEvent` (`packages/harness/publish.ts:1259`) writes
`v1/presim/{eventKey}/{algorithmId}@{version}.json` through the WIRE shape,
`PublishedPreScheduleArtifactSchema` (`pageArtifacts.ts:2411`). Since quick task 260912-2ur that
schema's transform drops `schedules` from the body and replaces it with `scheduleCount`. The
published body carries:

```
roster: string[]                                    // the index space
baked:  { draws: number, histograms: number[][] }   // one per roster team, in roster order
scheduleCount: number                                // schedules averaged into baked (1,000)
schemaVersion, generation, computedAt, algorithmId, algorithmVersion,
eventKey, season, pricedFrom, matchesPerTeam
```

`baked.draws` is `scheduleCount x PRESIM_DRAWS_PER_SCHEDULE`, currently 1,000 x 50 = **50,000**.
That total is larger than, and deliberately unlike, the client engine's `SIMULATION_DRAWS`
(1,000). `publish.ts`'s own comment on `PRESIM_DRAWS_PER_SCHEDULE` states the difference is
intentional. The baked path samples over every schedule a team might get, while the live path
simulates the one schedule that actually exists, so the two are answering different questions at
different resolutions rather than the same question at matching resolution. Baselines for the
bake are zero for everyone, which is exactly what "before schedule release" means.

`PRESIM_SCHEDULE_COUNT` was raised from 20 to 1,000 because at 20 schedules two identical runs
moved the worst team's rank by 10.61 places from sampling noise alone, and at 1,000 that movement
drops to 1.17, below what an integer rank display can even show. Raising it was affordable only
because sidecars became aggregate-only after 260912-2ur.

Four schema refinements on the builder shape (valid pmfs, in-range roster indices, unique roster,
histogram length and sum) run before the transform to the wire shape, so
`MalformedRankHistogramError` is unreachable in front of a visitor by the time a body is written.
The client deliberately re-checks none of them.

The sidecar is **not a `PageKind`**. That's structural, not stylistic: the live Worker's
artifact writer is keyed on `PageKind`, so it cannot address, clobber, or delete a sidecar
mid-event. It also sits outside `payloadBudget`'s machine-readable gate.

### Client read path

Route `event.$eventKey.tsx:188` gates the fetch on `activeTab === "simulation"` — lazily, and
never inside `SimulationTab` itself (Radix would otherwise fetch on every event page load).
`fetchPreScheduleArtifact` returns **`null` on 404** rather than throwing, because an absent
sidecar is an ordinary permanent state (pre-2026 season, offseason event, cold-start first
event, RP-less algorithm). Every other non-OK status still throws.

`decodePreScheduleResult` then rebuilds `{rankHistograms, draws}` from `baked` alone. Nothing
else in the published body is read: `roster` supplies the team-key index, `baked` supplies the
histograms and draw count, and `scheduleCount` is parsed by
`PublishedPreScheduleArtifactSchema` and then never referenced by any client code.

### Measured size

**Current: 2026-09-21 generation `8caca9d2`, from `docs/publish-budget.md`'s machine-written
budget block.** 214 presim sidecars, median 6,855 B, p95 16,005 B, max 23,831 B. This is a
code-read figure, not a fresh live fetch, matching the 2026-09-23 re-verification note above. The
`publish.ts` comment beside `PRESIM_SCHEDULE_COUNT` separately records individual sidecars around
24 KB, consistent with that max.

**Historical, superseded by the table above.** Before quick task 260912-2ur (2026-09-12) dropped
the priced `schedules` block from the published body, sidecars were two to three orders of
magnitude larger. The 2026-09-06 retune republish measured 216 sidecars, median 138,710 B, p95
243,647 B, max 265,617 B, with one measured object's component split at `schedules` 95.4%,
`baked.histograms` 4.3%, `roster` 0.2%. A live GET against `2026mrcmp`'s three then-published
algorithms on 2026-09-12 measured 393,507 B, 392,566 B and 388,484 B; of the third, only 12,275 B
(3.2%) was ever read by the client. Neither figure describes any object currently on R2.

---

## 4. Live status: the pre-schedule stop is live on all three published algorithms

Verified against production on 2026-09-12, by unauthenticated GET against
`https://data.sigmascout.org`, with the response body **parsed as JSON and its fields counted**
— not by reading an HTTP status alone. That distinction matters here: a status-only check has
misled on this project before (see the sentinel incident below), and a reader of this section
needs to know which kind of check this was.

**This table was not re-fetched for the 2026-09-23 re-verification (code read only, no live R2
access).** Its byte figures are the same superseded pre-260912-2ur numbers already covered in
section 3, kept here only as the record of that day's live verification, not as current sizes.
Section 3 carries the current published sizes.

| key | bytes (2026-09-12, historical) | roster | schedules | baked.draws | histograms |
|---|---:|---:|---:|---:|---:|
| `v1/presim/2026mrcmp/opr@4.0.0+baseline.json` | 393,507 | 66 | 20 | 1000 | 66 |
| `v1/presim/2026mrcmp/epa@10.0.0+baseline.json` | 392,566 | 66 | 20 | 1000 | 66 |
| `v1/presim/2026mrcmp/bpr@3.0.0+baseline.json` [pre-rename] | 388,484 | 66 | 20 | 1000 | 66 |

All three carry `pricedFrom` = `pre-event-walk-forward` and `computedAt` =
`2026-09-12T01:06:14.953Z`. The live algorithms manifest resolves `opr 4.0.0+baseline`,
`epa 10.0.0+baseline`, `bpr 3.0.0+baseline` — the same triple these three sidecars are keyed
under — so every sidecar is reachable under the client's **own** key. State that explicitly:
reachability-under-the-client's-own-key is the property that was broken before (below), not mere
existence somewhere in the bucket.

(The epa version this section named before the 2026-09-12 re-verification is superseded: the
published epa was `10.0.0` at that point, not `7.0.0`. Neither figure is claimed current as of
2026-09-23; see `docs/publish-budget.md`'s machine-written block for what is currently live.)

### How it was dark, and why that is worth keeping

The stop being live in 2026-09-12 does not erase why it was dark from 2026-09-09 through
2026-09-11. Both reasons are kept here, labelled as history, because deleting them to make this
page read cleanly would trade one stale record for a lost lesson.

1. **The vpr-keyed orphans.** Every sidecar in R2 belonged to `vpr`, retired from the published
   set on 2026-09-09, so the objects existed but were unreachable under any key the client would
   request. This is exactly the failure the reachability sentence above rules out for the
   generation being described, which is why the two belong on the same page.
2. **The `--presim-from-season 9999` sentinel.** The sentinel was **committed** in
   `package.json`'s `publish:seasons` script — not passed as a per-run CLI override. A cutoff
   above every season in the corpus made the `season >= preScheduleFromSeason` gate false for
   every season, so three republishes wrote zero sidecars. `09-RESEARCH.md`'s Pitfall 1 asserted
   no such literal existed in the tree and that re-enabling was a republish rather than a code
   change; following that reading would have spent a full forty-five-minute R2 write pass and
   printed no `presim:` line while looking green. The 09-10 remediation changed the argument to
   `2026` (matching `DEFAULT_PRESCHEDULE_FROM_SEASON`) and added a drift tripwire in
   `packages/harness/publish.test.ts` that fails loudly if the cutoff is ever parked past the
   latest season the same script publishes. The transferable lesson: **a run that exits clean and
   prints nothing about the artifact class it was supposed to write is not evidence that it wrote
   anything.**

The tab's pre-schedule stop resolves for the selected algorithm on a 2026 event, and the
live per-match engine continues to work alongside it.

The live engine itself **does** work on current bytes, spot-checked as of the 2026-09-10 audit
and not re-verified since. `2026mrcmp` carries 132/132 qual rows with pmfs, and `2024casf`
carries 57/72, the 15 gaps being exactly `qm1` through `qm15` (the per-robot consistency
cold-start chain, already measured under quick task 260910-kco).

---

## 5. Moving the simulation between browser and server: closed both directions

**Closed by Jacob on 2026-09-23**, quick task 260923-1tu
(`.planning/quick/260923-1tu-workers-paid-rearchitecture-audit-find-c/260923-1tu-FINDINGS.md`,
section 3, "Things the audit says NOT to do"). The simulation stays exactly where it is, in the
browser, on both stops. It is not moved into the published sidecar, a question already closed
earlier as won't do on 2026-09-19, see
`.planning/todos/completed/price-the-preschedule-simulation-in-the-browser.md`. It is also not
moved into a server-side HTTP Worker, the question this section closes.

**Why not server-side.** The pre-schedule stop is already fully baked offline, and the sidecar
is a median 6,855 B, per section 3. The per-match run is parameterized by a visitor's own click,
a chosen start match and a Run press, and costs about 21 ms of draws, per section 2's measured
cost. Neither stop can be precomputed once and reused the way an event page can, because the
per-match run's input is the visitor's own choice, not something the pipeline can enumerate ahead
of time without pricing every possible start match of every event. Serving it from an HTTP Worker
would add a request-path Worker where none exists today, since the only live Worker is the cron
poller and the read-serving layer is plain static JSON with no Worker in the request path at all.
It would bill a request per Run press and replace the roughly 290 lines of existing Web Worker
plumbing (`apps/web/src/workers/simulationProtocol.ts`, `apps/web/src/workers/simulation.worker.ts`,
`apps/web/src/components/event/useSimulationRun.ts`) with a fetch hook doing the same work more
slowly. The Workers Paid plan bought 2026-09-22 removed CPU and subrequest pressure that argued
for moving other compute off the client elsewhere in this system, see the same findings document,
section 2, item C1. It gives no reason to move this particular compute onto the server, because
this compute was never CPU-constrained on the client in the first place.

### Historical record: Options A, B and C

Evaluated 2026-09-10 through 2026-09-19, before the question closed. Kept as the record of what
was considered, not as a live recommendation.

- **Option A, ship the priced schedules and let the browser draw.** Foreclosed by the schedule
  template licence (`data/schedule-templates/LICENSE`, Team 254, 2014) until the schedule
  generator produced pairing structures of SigmaScout's own rather than the licensed grids. Once
  unblocked, judged not worth it, about a 4% payload saving, against 260912-2ur's decision to
  drop the `schedules` block outright instead.
- **Option B, generate the schedules in the browser and let the browser draw.** Would need the
  browser to reproduce `packages/harness/generatedSchedules.ts`'s seeded generator and to run the
  full joint-covariance RP model, a Cholesky decomposition via `ml-matrix` and 4,000 joint draws
  per match, client-side. Estimated at about 10.5 million multivariate draws per event, three to
  four orders of magnitude above the rank draws the browser already runs. Not viable as evaluated.
- **Option C, ship per-team RP parameters and price alliances cheaply in the browser.** The
  smallest possible payload, a few KB per event, but needs a new, less exact approximation judged
  honest enough to publish under. `FieldAveragedPreScheduleArtifactSchema` in
  `packages/harness/pageArtifacts.ts` explores this shape, `perTeamPmf`, no `baked` block, no
  `schedules`, but it is not wired into `pnpm publish:seasons`. Only
  `scripts/measureFieldAveragedRanks.ts` and its own test exercise it. Not adopted.

Both settle-first items this section once listed as open are resolved. The sidecars were re-keyed
under the correct algorithm ids in the 2026-09-12 publish, section 4. The cold-start wide-fallback
variance fix shipped under quick task 260910-kco.

---

## 6. File map

| File | Role |
|---|---|
| `packages/core/algorithms/simulation/rankSimulation.ts` | the one Monte Carlo core; `mulberry32`, `drawCategorical`, `simulateRanks` |
| `packages/harness/preSchedule.ts` | pure sidecar builder; owns no pricing math |
| `packages/harness/generatedSchedules.ts` | the rules-based pairing-structure generator |
| `packages/harness/publish.ts:1259` | per-event skip/price decisions, `pricedFrom` switch |
| `packages/harness/pageArtifacts.ts:2234,2345,2411` | `preScheduleKey`, `PreScheduleArtifactSchema` (builder shape), `PublishedPreScheduleArtifactSchema` (wire shape) |
| `apps/web/src/lib/simulationInputs.ts` | artifact + start match → `SimulationInputs` |
| `apps/web/src/lib/api/preSchedule.ts` | sidecar fetch; 404 → `null` |
| `apps/web/src/lib/preScheduleResult.ts` | `baked` → `SimResult` |
| `apps/web/src/workers/simulationProtocol.ts` | message contract, bounds, chunked progress |
| `apps/web/src/workers/simulation.worker.ts` | 3-statement Worker entry, no arithmetic |
| `apps/web/src/components/event/useSimulationRun.ts` | Worker lifecycle + run state machine |
| `apps/web/src/components/event/SimulationTab.tsx` | selection state, freshness signature, branch order |
| `apps/web/src/components/event/StartMatchPicker.tsx` | the two selection kinds |
| `apps/web/src/components/event/rankRows.ts` | `SimResult` → display rows |
| `apps/web/src/routes/event.$eventKey.tsx:188` | the lazy sidecar fetch gate |

Every row above was checked against HEAD with Glob on 2026-09-23. One file named in the prior
version of this map, `scripts/measureRewindGap.ts`, no longer exists and its row is dropped;
`scripts/measureFieldAveragedRanks.ts` is the current offline consumer of `simulateRanks` outside
the pipeline itself, referenced in section 5's Option C entry above.
