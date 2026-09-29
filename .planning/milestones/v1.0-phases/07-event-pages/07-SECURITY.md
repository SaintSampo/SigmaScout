---
phase: 07-event-pages
audited: 2026-08-30
auditor: gsd-security-auditor
asvs_level: 1
block_on: high
verdict: SECURED
threats_total: 188
threats_closed: 188
threats_open: 0
threats_open_nonblocking: 0
blocking_set_size: 63
blocking_set_closed: 63
register_authored_at_plan_time: true
implementation_files_modified: 0
files_written_by_auditor: 0
---

# Phase 7: Event Pages — Security Audit

**Verdict: SECURED** — `threats_open: 0`

Every threat in the register whose severity is at or above the `block_on: high` threshold has a
mitigation present in the code as it exists now, and the highest-risk ones are additionally
confirmed against live production state rather than against source alone.

---

## Register corrections — a durable trap for whoever greps this register next

Two counting errors were found *before* any verification began. Both are recorded here rather
than only in the audit reply, because both will recur for the next reader of this register.

### 1. Threat count: 192 → 188

The tasking brief stated **192** threat ids. Parsing the `<threat_model>` register tables
directly across all 20 PLAN.md files yields **188** unique `T-07-*` ids. The 188 enumerable
rows are what this audit covers.

### 2. Blocking set: 55 → 63 — caused by bold severity values

The brief stated the blocking set was **55** (1 critical + 54 high). **It is 63** (2 critical +
61 high).

`07-19-PLAN.md` and `07-20-PLAN.md` write their severity cells in bold — `**critical**`,
`**high**` — while the other eighteen plans write them bare. Any parse that matches on a literal
`high`/`critical` cell value silently drops **8 rows**, including:

> **`T-07-19-01` — the phase's SECOND critical threat** (`enumerateRetiredKeys` → `deleteObject`,
> the ~18,400-object production R2 deletion). A naive severity grep does not see it at all.

The eight rows hidden by bolding are `T-07-19-01` (critical) and `T-07-19-02` through
`T-07-19-07` and `T-07-20-01` (high).

**Normalize `*` out of the severity cell before ranking anything in this register.** All 63 were
audited here.

### 3. Two unranked rows

`T-07-11-SC` and `T-07-14-SC` carry severity `n/a`. Under fail-closed rules an *open* unranked
threat counts as critical. Both are CLOSED (see Supply Chain below), so neither escalated.

---

## Coverage limits — depth is NOT uniform

This register is large. Claiming even depth across 188 rows would be worse than stating the
truth. Three tiers:

| Tier | Rows | What "verified" means here |
|------|------|-----------------------------|
| **A — individually verified** | 63 blocking + 2 unranked SC + ~45 medium/low | Mitigation located in the cited file by grep/read; many additionally confirmed at ASVS L2/L3 depth (correct boundary, no bypass path) or against live production HTTP responses |
| **B — cluster-verified** | 11 XSS-family + 11 supply-chain | Closed by a single control proven to cover *all* entry points (a repo-wide injection-sink sweep; a whole-phase dependency diff) rather than row by row |
| **C — classified, not individually verified** | ~80 medium/low | Severity and disposition recorded; covered only indirectly by the full test suite (2,058 passing) and by the shared structural controls above. **The cited file was not opened for each of these.** |

> **No blocking-severity threat sits in Tier C.** Tier C is entirely medium and low severity.

---

## PROCESS FINDING — the evidence trail is missing

**Zero of the 20 SUMMARY.md files contain a `## Threat Flags` section.** Not one contains the
word "Threat" or "Security" anywhere at all.

```
grep -ln 'Threat Flags' 07-*-SUMMARY.md   →  0 files
grep -c  'Threat\|Security' 07-*-SUMMARY.md → 0 for all 20
```

Executors never recorded dispositions as they went, so **no summary can testify that a
mitigation landed**. Every closure in this document was therefore established against
implementation files, git history, live production HTTP, or test execution — never against a
summary's claim.

This is worth fixing at the process level. Not because a mitigation was missed (none was), but
because the next phase's auditor will have to reconstruct all of this from scratch for exactly
the same reason.

---

## Blocking set — 63/63 CLOSED

### Critical (2/2)

| ID | Component | Evidence |
|----|-----------|----------|
| T-07-17-01 | `v1/manifest/algorithms.json` — unconditional manifest write | Live `GET https://data.sigmascout.org/v1/manifest/algorithms.json` returns 3 entries (`opr`, `epa`, `vpr`); the transitional 4-entry manifest was collapsed as designed. Client `PUBLISHED_ALGORITHM_IDS = ["opr","epa","vpr"]` (`packages/harness/publishedAlgorithms.ts:24`) and `DEFAULT_ALGORITHM = "vpr"` (`apps/web/src/lib/searchParams.ts:37`) both resolve against it. `manifest:algorithms` now read-back-verifies before declaring success (WR-01 fix, `scripts/publishAlgorithmsManifest.ts:282-287`). |
| T-07-19-01 | `enumerateRetiredKeys` → `deleteObject` | Four independent guards, all present and non-bypassable from the CLI, plus the CR-01 intent gate. Detail below. |

### T-07-19-01 — the four guards, verified line by line

All in `scripts/deleteRetiredAlgorithmObjects.ts`:

| Guard | Line | Verified property |
|-------|------|-------------------|
| `--retired-id` required, no default | 437-439 | Throws before anything runs. `--version` likewise at 441-443 |
| `RefusedLiveAlgorithmIdError` | 178 | Exact `includes` over the imported `PUBLISHED_ALGORITHM_IDS` string array, evaluated **before enumeration begins**. Never a prefix or substring test |
| `KeySegmentMismatchError` via `assertKeySegment` | 202-204 | Applied to **every** enumerated key, before the function returns, before the first delete |
| `EnumerationOutOfBoundsError` | 206 | Checked against `RETIRED_KEY_COUNT_BOUNDS = {min: 15_000, max: 25_000}` |

Two bypass paths were specifically checked and are closed:

- The `bounds` parameter is a documented test-only override. **`runDeletePass` (line 491) does
  not pass it**, so every production invocation is checked against the real exported constant.
  Verified by reading the call site, not assumed from the doc comment.
- The `compare` page kind is never enumerated — the loop builds only `teams`/`events`/`event`/`team`
  (lines 191-198), so the algorithm-agnostic key is structurally unreachable.

**CR-01 fix present and correct** — line 511:

```ts
if (!options.execute || options.dryRun || options.censusOnly) {
```

Destruction is now opt-in. `--retired-id`/`--version` alone — the "reasonable first invocation"
the code review identified as deleting ~19,261 objects — now routes to the census-only path.
`parseCliOptions` gives `execute` no default (line 449).

---

## Production-state evidence (external, not source-only)

The deletion actually happened, and it hit only the retired prefix. Verified live during this
audit with per-request cache-busting and `Cache-Control: no-cache`:

```
200  v1/teams/2024/vpr@2.0.0+tuned-2026-08.json
404  v1/teams/2024/sigma1@2.0.0+tuned-2026-08.json
200  v1/event/2024vabrb/vpr@2.0.0+tuned-2026-08.json
404  v1/event/2024vabrb/sigma1@2.0.0+tuned-2026-08.json
200  v1/events/2024/vpr@2.0.0+tuned-2026-08.json
404  v1/events/2024/sigma1@2.0.0+tuned-2026-08.json
404  v1/team/frc9970/2024/vpr@2.0.0+tuned-2026-08.json   (orphaned demo team, deleted)
```

`reports/publish/07-19-census-after.json`: enumerated **19,261**; sampled 60;
**present 0, absent 60**.

This closes **T-07-19-06** — the threat that `deleteObject`'s 404-as-success contract makes the
tool structurally unable to testify about its own effect — with evidence external to the
deleter, exactly as the mitigation specified.

**Generation uniformity.** The observable signature of an interrupted or narrowed-range resume
(**T-07-17-02**) is absent. Every sampled key across all five seasons and all four
algorithm-scoped page kinds, plus the manifest itself, returns the identical
`generation: 882249ad-be97-419d-b929-042aa17afb41`:

```
v1/teams/2022/…  v1/teams/2026/…  v1/events/2023/…
v1/event/2023cur/…  v1/event/2026dal/…  v1/team/frc254/2024/…
v1/manifest/algorithms.json
```

**Worker liveness** (**T-07-19-03 / T-07-19-04**). `apps/worker/wrangler.toml:61` sets
`LIVE_ALGORITHM_IDS = "vpr"`, which the live manifest names — so the
`EmptyLiveAlgorithmTierError` condition (`apps/worker/src/scheduled.ts:264`) cannot fire, and
the ordering threat (deploy-before-collapse) landed correctly. The 2026-08-29 CPU-budget outage
fix is present and **hard-fails rather than silently skipping** a live-relevant entry
(`apps/worker/src/liveWindows.ts:199-200`, `LiveWindowShapeError` on a non-finite bound).

---

## Secrets handling — CLOSED on BOTH boundaries

Covers **T-07-03-05, T-07-04-03, T-07-05-02, T-07-17-05, T-07-19-07**.

`.claude/CLAUDE.md` is explicit that passing `scripts/secrets-boundary.test.ts` is **not**
evidence the transcript-side boundary was honored — that is precisely how the Phase 4 R2 token
leaked while every git-side protection passed. Both sides were therefore verified independently.

### Source-path controls (all present)

- `deleteRetiredAlgorithmObjects.ts`, `deleteOrphanedDemoTeamObjects.ts`,
  `verifySubsetPublish.ts`, `publishAlgorithmsManifest.ts` — comment-filtered counts of
  `process.env`, `signRequest` and `.env` are all **0**. Credentials reach R2 only through the
  shared `r2Client`.
- `packages/harness/r2Client.ts:33-43` reads `process.env` exactly once; its missing-credential
  error names the **variables**, never a value. No error path interpolates a header or secret
  (`putObject`'s throw at :208-210 carries key, status and statusText only).
- `packages/ingest/tbaClient.ts` — the key flows only into the `X-TBA-Auth-Key` header.
- `packages/ingest/rankingsLive.test.ts` — the single `console.` occurrence is a **comment
  stating the rule**; zero console calls on the executed path.
- `apps/worker/src/artifactWriter.ts:76-78` — an active runtime scrub: `ArtifactSecretLeakError`
  refuses any R2 write whose serialized body contains `env.TBA_API_KEY`.
- `.env` untracked and gitignored (`.gitignore:5-7`); `data/*` (:9) and `reports/` (:13)
  gitignored, so tee'd ingest logs and the delete log cannot reach a commit even by accident.

### Empirical sweep

Values were loaded into shell variables and compared with `grep -cF`. **Only match counts were
ever emitted.**

| Surface | Credential match count |
|---------|------------------------|
| Phase-07 git diff (4.6 MB, `ebe90c51..HEAD`) | **0** |
| All phase-07 commit messages | **0** |
| All 20 phase-07 planning documents | **0** |
| **88 session transcripts** modified since 2026-08-27 | **0** |
| **50 phase-era transcripts** scanned for a direct `.env` read (`Read` tool / `cat` / `head` / `tail` / `less`) | **0** |
| Files tracked under `reports/` | none tracked |

> **The Phase 4 failure mode did not recur.** No live credential value appears in any phase-07
> transcript, and no phase-era executor performed a direct `.env` read.

Two caveats, disclosed rather than omitted; neither changes the verdict:

1. The value comparison uses the credentials currently in `.env`. A secret that leaked *and* was
   rotated within the phase would be invisible to it. The rotation-independent mechanism scan
   (0 direct `.env` reads across 50 phase-era transcripts) covers that gap.
2. Two `.env`-touching commands do exist in the scanned tree, but both belong to **the audit
   session's own subagents**, not to phase-07 execution: one `cat .env | wc -l` (contents go to
   `wc`; only a line count reaches the transcript) and one `cat apps/web/.env*` against a
   nonexistent path. The value scan confirms neither placed a secret in a transcript.

---

## Publish pipeline (`packages/harness/publish.ts`)

| ID | Control | Evidence |
|----|---------|----------|
| T-07-08-01 | `rank`/`record`/`rp` never model-derived | Filled only by `eventTeamRankingFields(params.rankings?.get(...))`. `buildEventTeamsStanding` (`:1206-1221`) emits no standings fields at all — only `teamKey`, `teamNumber`, `nickname`, `metrics` |
| T-07-08-02 | Parse-through-schema before return | `buildEventArtifact` contains **exactly one** `return`, and it is `return EventArtifactSchema.parse(candidate);` |
| T-07-08-03 | No publisher-side variance recomputation | Read straight off `prediction.redScoreVarianceOwn`/`blueScoreVarianceOwn`; only `roundTo` applied. Zero arithmetic constructs in the function body — the 2 grep hits are comment lines |
| T-07-08-05 | No `picks` truncation, no fabricated `record` | `picks: [...sel.picks]` copied whole; the three `.slice`/`.length` hits touch `name` and `startDate` only. `eventTeamRankingFields` is all-or-nothing with explicit `!== null` guards, so a real `0` survives |
| T-07-09-01 | Percentiles ranked against the season pool | `sortedPoolsByMetric(` has **exactly 2** non-test call sites (`:1715`, `:2135`), both passing `teamsThisSeason`. Corroborated on production data: 2023cur (78 teams) spans 0.2–99.9, not the 0–100 an event-roster pool would force |
| T-07-09-03 | As-of-event fallback confined to its one case | Explicit `state !== undefined`; no `??`, no truthiness shorthand |
| T-07-16-01 | Manifest id cannot disagree with the object key | `buildAlgorithmsManifest` uses `id: promoted.id` read from the same version file `applyPromotedOverrides` pins — no literal at the construction site |

**Production field census** (real published bytes, cache-busted, `no-store`):

| Event | teams | rank | record | rp | percentile | range | alliances |
|-------|-------|------|--------|-----|-----------|-------|-----------|
| 2023cur | 78 | 78 | 78 | 78 | 1014 / 1014 | 0.2–99.9, 0 null | 8 |
| 2024casj | 42 | 42 | 42 | 42 | 714 / 714 | 0–100, 0 null | 8 |
| 2026dal | 75 | 75 | 75 | 75 | 1125 / 1125 | 0–100, 0 null | 8 |

This closes **T-07-10-01, T-07-10-04, T-07-10-05, T-07-10-06 and T-07-17-04** against real
published bytes rather than presence checks — including T-07-10-06's specific fear that 07-05's
forced rankings pass silently 304-skipped and shipped two permanently empty columns. It did not.

---

## Third-party data trust (TBA boundary)

- **T-07-03-01** — `tbaAllianceResponseSchema` (`packages/ingest/schemas.ts:234`) is `.parse()`d
  at the fetch boundary (`packages/ingest/cli.ts:550`), with
  `picks: z.array(z.string()).min(1)`, `status: z.unknown().optional()`, `declines` required,
  and **no `.default()` anywhere in the schema**.
- **T-07-03-02** — `packages/ingest/alliances.ts:58` collapses `undefined`, `null` and `""` to a
  single `null`. No synthesized `Alliance {n}` label.
- **T-07-03-03** — comment-filtered count of any fourth-pick / backup concept across
  `schemas.ts`, `alliances.ts` and `cli.ts`: **0**. A 4th team is `picks[3]`, exactly as TBA
  sends it.
- **T-07-03-04** — all five counters present (`populatedCount`, `nullBodyCount`,
  `emptyAlliancesCount`, `cacheHitCount`, `notFoundCount`) at `cli.ts:523-525` and `:438-448`,
  preserving the closed-sum invariant.
- **T-07-04-01** — `normalizeEventRankings` (`packages/ingest/rankings.ts:116-125`) asserts
  `sort_order_info[0].name === "Ranking Score"` and throws `RankingScoreSortOrderError`
  **before** reading `sort_orders[0]` at line 143. Guard and read live in one function, so no
  caller can perform one without the other. This also discharges **T-07-05-10** (`transfer` →
  07-04): the transferee's control was located and read, not taken on trust.
- **T-07-04-02** — `record.wins` / `.losses` / `.ties` passed through verbatim
  (`rankings.ts:132-134`). `rankings.ts` remains a pure module with no I/O and no corpus
  import, so a match-derived tally is not merely forbidden but unreachable.
- **Post-plan RP fix** — non-integer self-reported RP degrades to `null` at the ingest boundary
  (`packages/ingest/normalize.ts:132`) **and** again as defence-in-depth at publish
  (`packages/harness/publish.ts:133`).

---

## Client-side rendering of third-party strings

The entire XSS family — **T-07-03, T-07-03-10, T-07-07-04, T-07-08-06, T-07-10-12,
T-07-11-01, T-07-12-01, T-07-13-01, T-07-14-01, T-07-15-04, T-07-20-06** — rests on one claim:
React escapes text nodes and no raw-markup sink exists. Verified as a sweep covering **all**
entry points, not a spot-check:

```
dangerouslySetInnerHTML | .innerHTML | outerHTML | insertAdjacentHTML
| document.write | eval( | new Function(

  across apps/web/src/, packages/, apps/worker/src/   →   0 matches
```

URL sinks are the only other vector, and both are guarded:

- `apps/web/src/components/event/EventHeader.tsx:24-27` — `tbaEventUrl` returns `undefined`
  unless `isValidEventKey` passes. `EVENT_KEY_PATTERN = /^\d{4}[a-z0-9]+$/` admits no `/`,
  `..`, `?`, `#` or percent-escape.
- `apps/web/src/components/team/SeasonHeader.tsx:95` — `robotImageUrl` is constrained by
  `z.string().url()` at the schema layer (`pageArtifacts.ts:716`).
- **T-07-15-02** (reverse tabnabbing) — both `target="_blank"` links carry `rel="noopener"`.

Route input validation (**T-07-01, T-07-02, T-07-04, T-07-18-02**): `EventSearchSchema` with
`.catch()` fallbacks, `isValidEventKey` gating the query's `enabled` before any fetch fires
(`routes/event.$eventKey.tsx:123, 133`), `EventArtifactSchema.parse` raising
`ArtifactValidationError` (`lib/api/event.ts:41-48`), and the `REGISTERED_EVENT_TABS` narrowing
**retained** at line 56 rather than deleted as 07-18 made it temporarily redundant.

---

## Deployed Worker

- **D1 query construction** (`apps/worker/src/stateStore.ts`) — fully parameterized. The only
  dynamic SQL is the placeholder count `s.scopeKeys.map(() => "?").join(",")` and a literal
  `scope_kind = 'league'`; every value passes through `.bind()`. `MAX_SCOPE_KEYS_PER_READ`
  bounds the `IN (...)` fan-out with a named error rather than an unbounded statement. Closes
  **T-07-19-12** and the D1 half of **T-07-17-08**.
- **Generated seed SQL** (`packages/harness/stateSnapshot.ts`) — `escapeSqlString` doubles
  single quotes, the correct and complete escape for SQLite string literals, applied to every
  interpolated value in `sqlRowTuple` and to the leading `DELETE`. All values originate from the
  Zod-parsed corpus.
- **TBA boundary** — `tbaMatchListSchema.parse` (`scheduled.ts:706`), `tbaEventSchema.parse`
  (`:767`).
- **R2 write path** (`artifactWriter.ts:71-88`) — schema parse → secret scrub → budget check →
  exactly one `put` with `max-age=60`. Zero puts are issued if validation throws.
- **D1 identity** (**T-07-19-10**) — `database_name` / `database_id` tracked in
  `wrangler.toml:90-91`; read-back-by-`GROUP BY` documented at `docs/worker-operations.md:141`.
  Undo seeds `seed-{opr,epa,sigma1,vpr}.sql` present on disk for **T-07-19-05**.

---

## Supply chain — 11 SC rows, all CLOSED

Every `*-SC` row is `accept` on the premise "this phase installs no new external packages."
Verified against the whole-phase diff (`ebe90c51..HEAD`):

- `pnpm-lock.yaml` — **unchanged**, absent from the diff entirely.
- The only `package.json` edits are `scripts` entries. The `dependencies` and `devDependencies`
  blocks are byte-identical.
- Every credentialed script added uses the approved `tsx --env-file=.env` form.

Closes `T-07-02-SC`, `-03-SC`, `-04-SC`, `-05-SC`, `-06-SC`, `-07-SC`, `-08-SC`, `-09-SC`,
`-10-SC`, and the two unranked `T-07-11-SC` / `T-07-14-SC`.

---

## Test evidence

| Suite | Result |
|-------|--------|
| `secrets-boundary`, both delete scripts, `publishAlgorithmsManifest`, `browserSafeSchemas` | 5 files, **46 passed** |
| `alliances`, `rankings`, `corpusCensus`, `corpus/db`, `digest` | 5 files, **136 passed** |
| Worker: `stateStore`, `artifactWriter`, `liveWindows`, `readScopedStateSql`, `liveAlgorithmTier`, `tbaPoll` | 6 files, **72 passed** |
| **Full suite** | **2,058 passed · 1 skipped · 2 failed** (124 files) |

### The two failing tests are a mitigation working as designed, not a defect

Both failures are in `packages/harness/payloadBudget.test.ts`:

```
teams: maxBytes (3705194) should be <= budgetMaxBytes (3500000)
team page maxBytes (675943) exceeded the absolute ceiling (600000)
```

Both are **pre-existing, documented, accepted** entries in the `.planning/WINDOWS.md` ledger —
**#11** and **#15** — each recording explicitly:

> *"ceiling still deliberately not raised; payloadBudget.test.ts left red pending a developer
> decision"* (#11)
> *"Neither ceiling raised"* (#15)

That is exactly what **T-07-09-05**, **T-07-10-10** and the three "gate made green by widening"
threats (**T-07-16-06, T-07-18-06, T-07-19-09**) required: the ceiling was **not** moved to make
the gate pass. T-07-10-10's own mitigation text even names this precedent — *"this repo already
carries a live instance of that temptation resolved the other way."*

The `event` page kind — the one this phase actually grew — measures **327,261 bytes against its
350,000 ceiling** and passes. Neither failing kind is an event-page artifact.

**Standing process risk, not a threat gap:** a permanently-red test file masks any *new*
regression landing in that same file. Worth resolving on its own schedule.

---

## Observations (non-blocking)

1. **`--probe` bypasses the live-id refusal.** `runProbe`
   (`scripts/deleteRetiredAlgorithmObjects.ts:354`) calls `assertKeySegment` but never
   `RefusedLiveAlgorithmIdError`, so `--probe --retired-id vpr` would PUT-then-DELETE under a
   live algorithm id. Blast radius is nil in practice because
   `PROBE_EVENT_KEY = "__07-19-delete-probe__"` cannot collide with a real event key
   (`/^\d{4}[a-z0-9]+$/`). Adding the refusal check to the probe path would make the guard
   uniform across both entry points.

2. **`T-07-08-01`'s literal grep criterion is now stale.** The plan required *zero*
   metric-source references inside `buildEventTeamsStanding`; there are 2, because 07-09 (PD-02)
   subsequently made `metricsByTeam` a **required parameter** of that function. The threat is
   closed by a stronger property — the function emits no `rank`, `record` or `rp` at all — but
   the plan's own grep would now report a false failure to anyone re-running it.

3. **`T-07-10-02`'s generation-differs leg is procedural, not mechanical.**
   `scripts/verifySubsetPublish.ts`'s Check 12 is explicitly *"informational only (never a
   per-entry failure)."* The cache-busting query parameter and `cache: "no-store"` are
   mechanical; the third control is a human comparison against a recorded `<baseline>`.

4. **`T-07-17-02`'s narrowed-`--seasons` cold-start hazard is undocumented in code.** No warning
   exists in `packages/harness/publish.ts` or under `docs/`. The effective control is that
   `package.json`'s `publish:seasons` hardcodes `--seasons 2022-2026 --include-offseason`, so an
   operator cannot narrow the range through the sanctioned entry point.

5. **Demo teams on event rosters — a recorded developer decision, not a loose end.** Code review
   raised this as WR-02. It was resolved by explicit developer decision on 2026-08-30, recorded
   under "Scope clarification" in
   `.planning/todos/completed/exclude-offseason-demo-teams-SUMMARY.md`. The accurate scope
   statement is: **excluded from the model and from every TEAM-scoped published surface;
   retained as unrated roster rows in event-scoped artifacts.** Demo keys `frc9970`–`frc9999`
   are excluded from all three algorithms' ratings (with 428 fully-demo alliances dropped as
   non-contests), from `team/{teamKey}/{year}`, `teams/{year}`, search, team rankings, and the
   Worker's incremental fold path. They deliberately remain as rows in an event artifact's own
   `teams[]`, carrying the `rank` and `record` TBA itself publishes, with an **empty `metrics`
   object** — so they hold no rating and cannot distort any prediction. The stated reason is
   that an event's team list is a record of who was physically on the field, and removing them
   would put this site's event rank column in disagreement with TBA's published rankings and
   leave gaps in the rank sequence. Confirmed live during this audit
   (`v1/event/2024vabrb/...` publishes `frc9975` with `metrics: {}`). Not a security threat and
   not a register row — recorded here so a future reader does not rediscover it as a regression.

6. **Ledger hygiene item is already actioned.** `WINDOWS.md` entry **#14** (2024orbb/2025orbb
   non-integer self-reported RP) was flagged by `07-VERIFICATION.md:123` as still marked `open`
   despite its fix having landed. Re-checked directly against the current tree: it is now
   `status: resolved` with `resolved_at: 2026-08-29T00:00:00.000Z`, corrected in commit
   `7b90e849` *("chore(07): mark WINDOWS.md #14 resolved (ledger hygiene)")*. The underlying fix
   is present and verified at `packages/ingest/normalize.ts:132` and
   `packages/harness/publish.ts:133`, with the corpus re-ingested from 30 non-integer rows to 0.
   **No action outstanding.**

7. **Filed-but-unfixed defect** (register-adjacent, correctly handled):
   `.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md` — a fully-disqualified
   alliance's `0` score being fitted as genuine performance. Correctly filed rather than
   silently patched inside an unrelated phase.

---

## Unregistered flags

**None.**

No SUMMARY.md declares any (see the process finding above), so this conclusion rests on mapping
the phase's post-plan changes against the register directly. Every one maps to an existing
threat:

| Post-plan change | Maps to |
|------------------|---------|
| Non-integer self-reported RP degraded to `null` (`normalize.ts`, `publish.ts`) | T-07-04-02, T-07-04-05 |
| Demo-team exclusion `frc9970`–`frc9999` (`demoTeams.ts`, `opr.ts`, `epa.ts`, `sigma1/index.ts`, `publish.ts`, Worker fold path) | T-07-08-01; scope recorded per Observation 5 |
| Worker outage fix (`liveWindows.ts`, `manifests.ts`) | T-07-19-03, T-07-19-04 |
| New published field: alliance `record` | T-07-08-05 |
| New published field: extended rankings | T-07-07-01 |
| G-1..G-13 UAT UI fixes, incl. `touch-action` and `overflow-x: clip` (`Ribbon.tsx`, `__root.tsx`) | No new trust boundary; the repo-wide injection-sink sweep covers every component touched |

---

## Accepted risks log

All 53 `accept`-disposition rows are recorded in their originating plans' `<threat_model>`
blocks with a stated premise. The premises re-derived against the **current** tree rather than
inherited:

- **T-07-02-06** (NULL-overwrite via `upsertEventRanking`) — re-derived by 07-04 as its plan
  required; exactly one call site remains, in `packages/ingest/cli.ts`.
- **T-07-02-08 / T-07-03-11 / T-07-04-08 / T-07-05-11** (identifier and event-key interpolation)
  — column identifiers come from module-private `readonly` literal tuples; event keys come from
  the corpus's own `events` table, never from user, file or network input.
- **T-07-03-12** (stale alliance row) — `upsertEventAlliance` overwrites every non-key column on
  conflict, so a *changed* alliance self-corrects and only a *removed* one persists. Premise
  holds.
- **T-07-17-07 / T-07-19-11 / T-07-10-08** (Cloudflare free-tier exhaustion) — bounded by the
  measured object counts recorded in `docs/publish-budget.md`.
- **T-07-17-03** residual — the un-run accuracy re-measure under `--include-offseason` is routed
  forward as a real standing finding at
  `.planning/todos/pending/remeasure-accuracy-record-offseason-inclusion.md`, and named in both
  `docs/publish-budget.md` and `docs/worker-operations.md:117`. Not a passing mention.

---

## Auditor conduct

No implementation file was modified; no file was written by the auditor. No `.env` file was
read, printed, echoed, or interpolated at any point. Credential values were loaded into shell
variables solely for `grep -cF` comparison, and **only match counts were ever emitted** — no
credential appears in this document, in any command issued during the audit, or in any log line
the audit produced.

---

_Audited 2026-08-30 · ASVS Level 1 · block_on: high · gsd-security-auditor_
