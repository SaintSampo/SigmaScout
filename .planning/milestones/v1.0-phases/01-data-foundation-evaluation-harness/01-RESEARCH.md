# Phase 1: Data Foundation & Evaluation Harness - Research

**Researched:** 2026-08-12
**Domain:** TBA API v3 ingestion + local normalized corpus + walk-forward evaluation harness (OPR baseline) — offline Node/TypeScript pipeline, no UI, no deployment
**Confidence:** MEDIUM-HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** The primary human-facing output of a harness run is a **self-contained HTML report** with embedded charts (score tables per algorithm per season, calibration plots). — Reversibility: reversible
- **D-02:** A **machine-readable JSON artifact** is produced underneath the HTML report from day one — EVAL-05 later requires the Compare page to display exactly these numbers, so the JSON is the canonical output and the HTML renders from it. — Reversibility: costly — the JSON schema becomes the contract the Phase 8 Compare page consumes; changing it later touches the site and the harness.
- **D-03:** Calibration curves are both rendered as charts in the HTML report and stored as binned data in the JSON artifact.
- **D-04:** Reports include a clearly-labeled **static reference row of Statbotics' published per-season accuracy** from day one, so every report shows the target before our EPA reimplementation exists (Phase 2).
- **D-05:** Ingestion stores each match's **full raw score_breakdown JSON as-is**; Phase 1 normalizes only totals, winner, and RP awards. Per-season component extraction is deferred until a model or UI tab needs it (Phase 3 RP rules, Phase 7 Breakdown tab). Nothing should ever need re-fetching from TBA because we kept raw payloads. — Reversibility: reversible — normalization can be extended over stored raw data at any time.
- **D-06:** Offseason events are **ingested and flagged**, excluded from ratings and accuracy scoring by default. Rationale: keeps eval clean while enabling Phase 4's live freshness test against fall 2026 offseason events. — Reversibility: reversible
- **D-07:** **Surrogate appearances are excluded from ratings entirely** — a surrogate team's participation does not update that team's rating and does not count toward its record. (Note for researcher/planner: this leaves a modeling question of how to treat the surrogate's slot in the alliance observation for the other five teams — e.g., predict with the surrogate's current rating but skip its update. Resolve at research/planning time within this decision's constraint: no rating update, no record impact for the surrogate.)
- **D-08:** Replayed matches keep **only the final (replay) result** as the canonical outcome, with a flag noting a replay occurred; the original result is not stored as a scoreable record.
- **D-09:** **Fixed split: 2022–2024 are tune seasons, 2025–2026 are holdout.** The optimizer may only ever see 2022–2024; headline accuracy claims come exclusively from 2025–2026, which no optimization loop touches. — Reversibility: costly — changing the split after tuning has run invalidates published holdout claims; a widened split can only be adopted with a fresh tuning run and re-stated claims.
- **D-10:** The **headline metric is winner accuracy** (what the FRC community intuitively compares), with Brier score always reported alongside it. Calibration curves guard against the overconfidence that accuracy alone hides.
- **D-11:** **All matches count in accuracy scoring — quals and elims** — reported separately and combined. Elims predictions are visible on the site, so they must be measured.

### Claude's Discretion

- Local corpus storage format (SQLite vs JSON files vs other) — research/planning picks based on query patterns and tooling.
- OPR solver details, harness CLI shape, module layout, testing framework specifics.
- Exact handling of the surrogate slot in alliance observations (within D-07's constraint).

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DATA-01 | Pipeline ingests TBA API v3 teams, events, and matches for 2022–2026 using ETag conditional requests | TBA client pattern (`X-TBA-Auth-Key`, `If-None-Match`/`ETag`) documented below with SQLite-backed ETag cache schema; base URL and header confirmed against TBA's own source/blog |
| DATA-02 | Pipeline correctly handles TBA data quirks: surrogate matches, match replays, missing score breakdowns, and offseason events (excluded or flagged, never silently ingested) | TBA `alliances.{color}.surrogates`/`.dqs` field names confirmed against TBA's own model source; replay handling researched (TBA exposes **no** replay flag — pipeline must synthesize one); offseason via `event_type` enum (confirmed: `OFFSEASON = 99`) |
| EVAL-01 | Harness replays any 2022–2026 season walk-forward, with every prediction made strictly before that match's outcome is folded into the model, for every algorithm | Predict-before-update pure-function contract + Proxy-based runtime leak guard (satisfies success criterion 4) documented in Code Examples |
| EVAL-02 | Harness reports Brier score and winner accuracy per algorithm per season | Brier/accuracy formulas and aggregation-by-season/comp-level (D-11) documented below |
| EVAL-03 | Harness produces calibration curves per algorithm (predicted probability vs observed frequency) | Reliability-diagram binning approach documented; stored as binned JSON (D-03) |
| EVAL-04 | Hyperparameter tuning uses an explicit tune/holdout season split; headline accuracy claims come from holdout seasons only | D-09's fixed split (2022–2024 tune / 2025–2026 holdout) — Phase 1 has no tuner yet (OPR has no hyperparameters), but the harness's season-labeling/report structure must carry the split forward for Phase 3 |
| ALGO-01 | OPR is computed per team per season as a no-variance baseline | Ridge-regularized least-squares OPR, computed walk-forward at season scope (not per-event) to avoid the identifiability pitfall early in an event; `ml-matrix` recommended over hand-rolling |

</phase_requirements>

## Summary

Phase 1 builds two things that never touch a UI: (1) a TBA API v3 ingestion pipeline that normalizes teams/events/matches for 2022–2026 into a local SQLite corpus while explicitly flagging surrogates, replays, missing score breakdowns, and offseason events, and (2) a walk-forward evaluation harness that scores OPR (the first baseline algorithm) with Brier score, winner accuracy, and calibration curves, structurally preventing outcome leakage. Everything runs offline in Node.js — there is no Worker, no Cloudflare deployment, and no Sigma1 in this phase.

The single most important architectural decision carried from the project's own research (`ARCHITECTURE.md`) is that the algorithm's `predict()`/`update()` functions must live in a shared, framework-agnostic module (`packages/core`) imported by *both* the harness (this phase) and the future live Worker (Phase 4) — this is what makes "predict before update" a structural guarantee rather than a discipline. This phase should build that module even though only OPR and the harness consume it today, because retrofitting it later is exactly the kind of two-implementations-drift failure named in the project's failure log.

Two TBA-specific findings materially change the ingestion design from a naive implementation: first, TBA's `Match` model exposes `alliances.{red,blue}.surrogates` and `.dqs` as explicit team-key arrays (confirmed against TBA's own source, not inferred) — surrogate detection does **not** require the historical workaround of inferring it from match-count patterns. Second, and more surprising: **TBA does not expose an explicit "this match was replayed" flag in the public API schema.** A replay simply overwrites the same match key's score data. This means D-08 ("flag noting a replay occurred") cannot be satisfied by reading a field — the pipeline must *synthesize* the flag itself by detecting when an already-scored match (one with `actual_time`/`score_breakdown` already recorded from a prior ingestion run) receives changed score data on a later poll, and record that as `replayed: true` while overwriting to keep only the final result. This is the load-bearing design decision for DATA-02 and should be called out explicitly to the planner.

**Primary recommendation:** Node 24 + TypeScript + `better-sqlite3` for the corpus, a `packages/core` module holding `predict()`/`update()` for OPR with a Proxy-wrapped "future match" object that throws on any attempt to read outcome fields before `update()` is called (this is the literal mechanism that satisfies success criterion 4's "any attempt to read a match's result before predicting it fails"), `ml-matrix` for the OPR least-squares solve (ridge-regularized, computed at season scope to dodge the early-event identifiability pitfall), and a hand-rolled inline-SVG report generator (no client-side charting library needed for a static, self-contained HTML file).

## Architectural Responsibility Map

This project's compute topology (per `.planning/research/ARCHITECTURE.md`) is not the standard browser/SSR/API/CDN/DB stack — it's Offline Pipeline / Online Incremental Worker / Static Serving. Phase 1 lives entirely in the first tier, but its most important output is a **shared module** designed to be reused unchanged by the second tier in Phase 4.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TBA ingestion (teams/events/matches, ETag caching) | Offline Pipeline (Node/CI) | — | No freshness requirement in Phase 1; the incremental Worker-side poller (Phase 4) is a *different* code path that reuses the same TBA client shape but not this phase's bulk backfill logic |
| Local normalized corpus (SQLite) | Offline Pipeline (Node, local file) | — | Pipeline-local state; not yet served to a Worker or frontend — DATA-03/04/05 (R2/KV/Worker topology) land in Phase 4 |
| Algorithm core: `predict()`/`update()` contract | Shared/isomorphic (`packages/core`) | Offline Pipeline (harness) now, Online Worker (Phase 4) later | Must be importable unchanged by both the harness today and the live Worker later (ARCHITECTURE.md Pattern 1 & Anti-Pattern 2) — designing it Worker-agnostic (no Node-only APIs, no Cloudflare bindings) now avoids a Phase 4 rewrite |
| OPR baseline algorithm | Shared/isomorphic (`packages/core/algorithms/opr.ts`) | Offline Pipeline (compute) | Same `predict()`/`update()` shape as future Sigma1; the ridge least-squares solve is cheap enough it *could* run in a Worker later, but Phase 1 only ever runs it offline |
| Walk-forward evaluation harness | Offline Pipeline (Node/CI) | — | No CPU-time budget to respect; explicitly excluded from ever running in a Cloudflare Worker (ARCHITECTURE.md Anti-Pattern 3) |
| HTML/JSON report artifact | Offline Pipeline (Node) | — | Consumed by a human today (D-01); the JSON becomes the literal data contract the Phase 8 Compare page reads (D-02, EVAL-05) — treat its schema as versioned from day one |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.15.0 (installed, confirmed on dev machine) | Pipeline runtime | Matches project's "24.x LTS" constraint exactly `[VERIFIED: node --version on dev machine]` |
| TypeScript | 5.9.3 | Language, `strict: true` | Matches CLAUDE.md's "TypeScript 5.x" directive. **Note:** npm's `latest` dist-tag is now `7.0.2` (a from-scratch native/Go compiler rewrite, GA'd recently) — see State of the Art below for why 5.9.x is still the safer pick for this phase `[VERIFIED: npm view typescript versions]` |
| tsx | 4.23.12 | Run `.ts` pipeline scripts directly | Matches CLAUDE.md's "4.23.x"; current npm `latest` `[VERIFIED: npm view tsx version]` |
| Zod | 4.4.3 | Runtime schema validation for TBA responses + the JSON artifact schema | Matches CLAUDE.md's "4.4.x"; current npm `latest` `[VERIFIED: npm view zod version]` |
| Vitest | 4.1.10 | Unit tests: OPR math, Brier/calibration math, walk-forward leak guard, TBA normalization | Matches CLAUDE.md's "4.1.x"; current npm `latest` `[VERIFIED: npm view vitest version]` |
| better-sqlite3 | 13.0.3 | Local normalized corpus (teams/events/matches + raw `score_breakdown`, per D-05) | Synchronous, embedded, zero-server SQLite binding — the standard choice for a Node CLI/pipeline that needs relational queries (chronological cross-event match ordering, per-team joins) without running a database process `[ASSUMED — package name from training knowledge, not from an authoritative source this session; existence/version confirmed `[VERIFIED: npm view better-sqlite3 version]`, but see Package Legitimacy Audit]` |
| `@types/better-sqlite3` | 9.6.0 | TypeScript types for better-sqlite3 (it ships no bundled types) | `[VERIFIED: npm view better-sqlite3 types (empty) + npm view @types/better-sqlite3 version]` |
| ml-matrix | 6.15.0 | Least-squares solve for OPR (ridge-regularized normal equations) | Pure-JS matrix library with `solve`/pseudo-inverse; avoids hand-rolling a numerically-sensitive linear solver (see Don't Hand-Roll) `[ASSUMED — discovered via training knowledge, not an authoritative source; existence/version confirmed `[VERIFIED: npm view ml-matrix version]`]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:util` `parseArgs` (built-in) | Node 24 | Harness CLI argument parsing (`--season 2024 --algorithm opr`) | No dependency needed — Node's built-in `parseArgs` (stable since Node 20) covers this phase's simple flag set; don't add `commander`/`yargs` for a handful of flags |
| `node:test`/none | — | — | Not used — Vitest is the project's chosen test runner (already fixed) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SQLite (better-sqlite3) | Plain JSON files per year/event | JSON files are simpler to `git diff` but make "give me all of team 254's matches across 2022–2026 in chronological order" an O(files) scan instead of an indexed query — the walk-forward harness needs exactly that query pattern repeatedly. SQLite wins for this phase's access pattern; revisit only if the corpus format needs to be human-diffable in PRs |
| ml-matrix | Hand-rolled Gaussian elimination | OPR's normal-equation solve needs to stay numerically stable as team count grows into the hundreds per season; a library with a tested, regularized solver avoids reproducing known numerical-stability bugs |
| Hand-rolled inline SVG report | A charting library (e.g., a Node-canvas renderer, or Vega-Lite headless) | The report has exactly two chart shapes (per-season score bars, a calibration reliability diagram) and must be a **single self-contained HTML file** (D-01) with no external script tags. A charting library either pulls in a native-canvas dependency (fragile on Windows CI) or a heavy declarative-spec renderer for two simple, deterministic shapes. Hand-rolled SVG-via-template-string is the pragmatic choice here — see Architecture Patterns |
| better-sqlite3 | `node:sqlite` (Node's built-in experimental SQLite module) | Node 22+ ships an experimental built-in `node:sqlite`. It would remove a dependency entirely, but as of Node 24 it is still flagged experimental and its API surface is less battle-tested than better-sqlite3's. Worth a spike if the team wants zero native-module risk, but better-sqlite3 remains the safer default for a phase this foundational |

**Installation:**
```bash
# Repo root — pnpm not installed on this dev machine; enable via corepack (bundled with Node 24)
corepack enable
corepack prepare pnpm@latest --activate

pnpm add better-sqlite3 zod
pnpm add -D typescript@5.9.3 tsx vitest @types/better-sqlite3 @types/node ml-matrix
```

**Version verification:** All versions above were checked via `npm view <package> version` against the live npm registry on 2026-08-12 (see per-row tags). `better-sqlite3` requires Node `>=22` (`[VERIFIED: npm view better-sqlite3 engines]`) — satisfied by the installed Node 24.15.0. It reports `gypfile: false` and no separate `binary` field, consistent with modern N-API-prebuild packaging rather than a `node-gyp`-at-install-time build — lower native-module install risk than older versions, but this should still be spot-checked on the actual CI runner OS during Wave 0 (see Common Pitfalls).

## Package Legitimacy Audit

| Package | Registry | Age (latest version) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|----------------------|-----------|--------------|---------|-------------|
| better-sqlite3 | npm | published 2026-08-05 | ~9.7M/wk | github.com/WiseLibs/better-sqlite3 | SUS (`too-new`) | **Flagged only by the "recent publish date" heuristic** — this is an established, extremely widely-used package (9.7M weekly downloads, long-lived official repo). Approved for use, but planner must add `checkpoint:human-verify` before the install task per protocol |
| @types/better-sqlite3 | npm | published 2026-08-01 | ~4.3M/wk | github.com/DefinitelyTyped/DefinitelyTyped | SUS (`too-new`) | Same false-positive pattern (DefinitelyTyped, official). Approved; `checkpoint:human-verify` before install |
| ml-matrix | npm | published 2026-08-05 | ~1.6M/wk | github.com/mljs/matrix | SUS (`too-new`) | Same pattern (official `mljs` org repo, 1.6M weekly downloads). Approved; `checkpoint:human-verify` before install |
| zod | npm | published 2026-05-04 | ~254M/wk | github.com/colinhacks/zod | OK | Approved — already established in project STACK.md |
| vitest | npm | published 2026-07-06 | ~90M/wk | github.com/vitest-dev/vitest | OK | Approved — already established in project STACK.md |
| typescript | npm | published 2026-07-08 (5.x line) | ~260M/wk | github.com/microsoft/TypeScript | OK | Approved — recommend pinning to `5.9.3` explicitly rather than `^5` to avoid an accidental bump to the `7.x` line (see State of the Art) |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `better-sqlite3`, `@types/better-sqlite3`, `ml-matrix` — all three are flagged solely by the legitimacy tool's "package's most recent version was published very recently" heuristic, not by any download/repo/postinstall red flag. The planner should still insert a `checkpoint:human-verify` task before installing each, per protocol, but this is expected to be a fast rubber-stamp given the download counts and official repos documented above.

*`better-sqlite3` and `ml-matrix` were selected from this researcher's training knowledge as the standard choices for their respective problems (embedded SQLite binding; pure-JS matrix solver), not discovered via an authoritative doc source this session — they are tagged `[ASSUMED]` per the package-name provenance rule even though the registry confirms they exist and are heavily used.*

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  OFFLINE PIPELINE (Node.js, this phase — no CPU budget constraint)   │
│                                                                       │
│  ┌───────────────┐   ┌──────────────────┐   ┌────────────────────┐  │
│  │ TBA client     │──▶│ Zod validation +  │──▶│ SQLite corpus      │  │
│  │ (ETag-cached   │   │ quirk normalizer  │   │ (teams, events,    │  │
│  │  fetch, one    │   │ (surrogate/replay/│   │  matches + raw     │  │
│  │  run per year) │   │  offseason flags) │   │  score_breakdown)  │  │
│  └───────────────┘   └──────────────────┘   └──────────┬─────────┘  │
│                                                          │            │
│                                    chronological read    ▼            │
│                                        (by actual_time,               │
│                                     interleaved across events) │
│                                                          │            │
│  ┌────────────────────────────────────────────────────┐│            │
│  │ WalkForwardSimulator — owns the ONLY reference to    ││            │
│  │ future matches; reveals one at a time                │◀┘           │
│  │                                                        │            │
│  │  for each match (chronological):                      │            │
│  │    prediction = core.predict(state, leakProofMatch) ──┼──▶ predictions
│  │    state = core.update(state, matchResult)            │   (recorded │
│  │                                                        │    BEFORE  │
│  └────────────────────────────────────────────────────┘    update)   │
│                                                          │            │
│                                                          ▼            │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ Scoring: Brier score + winner accuracy + calibration bins,     │  │
│  │ split by season × comp_level(quals/elims/combined) × tune-vs-  │  │
│  │ holdout (D-09/D-11)                                            │  │
│  └───────────────────────────┬─────────────────────────────────┘  │
│                               │                                       │
│                               ▼                                       │
│              ┌────────────────────────────┐                          │
│              │ JSON artifact (canonical,   │──▶ (Phase 8 Compare page,│
│              │ versioned) + self-contained │     future — not built   │
│              │ HTML report rendered from it│     this phase)          │
│              └────────────────────────────┘                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/
├── core/                         # Shared, framework-agnostic — reused unchanged by Phase 4's Worker
│   ├── algorithms/
│   │   ├── types.ts              # AlgorithmModule<S> interface: initState/predict/update
│   │   └── opr.ts                # OPR predict()/update(), no variance
│   └── scoring/
│       ├── brier.ts              # Brier score, winner accuracy
│       └── calibration.ts        # Reliability-diagram binning
├── ingest/
│   ├── tbaClient.ts              # ETag-aware fetch, X-TBA-Auth-Key header
│   ├── schemas.ts                # Zod schemas for Team/Event/Match (TBA response shapes)
│   └── normalize.ts              # surrogate/replay/offseason/missing-breakdown flagging
├── corpus/
│   ├── schema.sql                # SQLite DDL: teams, events, matches, http_cache
│   └── db.ts                     # better-sqlite3 wrapper, typed queries
└── harness/
    ├── replay.ts                 # WalkForwardSimulator — chronological, leak-proof
    ├── report.ts                 # JSON artifact + self-contained HTML (inline SVG) generator
    └── cli.ts                    # `pnpm harness --season 2024 --algorithm opr`
```

This mirrors `.planning/research/ARCHITECTURE.md`'s recommended repo layout but scoped to what Phase 1 actually needs — no `worker/` or `apps/web/` directories yet.

### Pattern 1: Predict-before-update via a Proxy-wrapped, outcome-stripped match object

**What:** `predict()` receives a match object that has literally had its outcome fields stripped and replaced with Proxy traps that throw on access. This is what makes success criterion 4 ("any attempt to read a match's result before predicting it fails rather than returning data") a runtime-testable fact, not just a type-level convention (TypeScript types alone can be bypassed with a cast; a runtime guard cannot).

**When to use:** Every call site where `predict()` is invoked inside the harness's `WalkForwardSimulator`.

```typescript
// Source: original design, following the predict/update contract recommended in
// .planning/research/ARCHITECTURE.md Pattern 1 — the Proxy mechanism itself is
// this researcher's own construction, built to satisfy success criterion 4 literally.
interface UpcomingMatch {
  matchKey: string;
  compLevel: "qm" | "ef" | "qf" | "sf" | "f";
  redTeams: string[];
  blueTeams: string[];
  // NOTE: deliberately no score/winner/rp fields on this type at all
}

interface MatchResult extends UpcomingMatch {
  winner: "red" | "blue" | "tie";
  redScore: number;
  blueScore: number;
  redRpEarned: number;
  blueRpEarned: number;
}

const FORBIDDEN_KEYS = new Set(["winner", "redScore", "blueScore", "redRpEarned", "blueRpEarned"]);

function toLeakProofUpcoming(result: MatchResult): UpcomingMatch {
  return new Proxy(result, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && FORBIDDEN_KEYS.has(prop)) {
        throw new Error(
          `Outcome leakage: attempted to read "${prop}" on match ${target.matchKey} before predict() completed`
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as UpcomingMatch;
}

// The regression test that proves criterion 4:
// expect(() => (leakProofMatch as any).winner).toThrow(/Outcome leakage/);
```

### Pattern 2: `WalkForwardSimulator` owns the only reference to future matches

**What:** A driver class holds the full chronological match list privately; algorithm code never receives the array, only one `Proxy`-wrapped match at a time via `predict()`, followed immediately by the real `MatchResult` via `update()`.

**When to use:** The harness's `replay.ts` — this is the single call site through which every algorithm (OPR now, EPA/Sigma1 later) is evaluated.

```typescript
// Source: original design, following ARCHITECTURE.md's "harness owns the only
// reference to future matches" recommendation.
class WalkForwardSimulator {
  #matches: MatchResult[]; // private — never exposed directly

  constructor(chronologicalMatches: MatchResult[]) {
    this.#matches = chronologicalMatches;
  }

  run<S>(algorithm: AlgorithmModule<S>, teams: string[]) {
    let state = algorithm.initState(teams);
    const predictions: { match: MatchResult; prediction: Prediction }[] = [];
    for (const result of this.#matches) {
      const prediction = algorithm.predict(state, toLeakProofUpcoming(result));
      predictions.push({ match: result, prediction });
      state = algorithm.update(state, result);
    }
    return predictions;
  }
}
```

### Pattern 3: Chronological ordering across concurrent events uses `actual_time` with an explicit fallback chain

**What:** TBA's `Match` object exposes `time` (scheduled), `predicted_time`, and `actual_time`, but `actual_time` is not guaranteed present for every historical match (particularly older or offseason events). Sort key must fall back deterministically: `actual_time ?? predicted_time ?? time`, and if all three are absent, fall back to `(event.start_date, comp_level play-order, match_number)` — never leave the sort undefined, since an undefined sort order silently reintroduces the leakage risk Pitfall 3 warns about (a match could get processed "out of order" relative to true chronology).

**When to use:** Building the single chronological match list the `WalkForwardSimulator` replays across an entire season (matches from concurrent Week 3 events, for example, must interleave correctly).

```typescript
// Source: original design — TBA field names confirmed via TBA's own model source
// (see Sources); the fallback-chain necessity is this researcher's own reasoning,
// not sourced from TBA docs, since TBA does not document a guaranteed-present
// ordering field.
function matchSortKey(m: RawTbaMatch, eventStartDate: string): number {
  const t = m.actual_time ?? m.predicted_time ?? m.time;
  if (t != null) return t * 1000;
  // Deterministic fallback: event start date + comp-level play order + match number
  const COMP_LEVEL_ORDER = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
  return (
    Date.parse(eventStartDate) +
    COMP_LEVEL_ORDER[m.comp_level] * 1_000_000 +
    m.match_number * 1_000
  );
}
```

### Pattern 4: OPR computed walk-forward at season scope, ridge-regularized

**What:** OPR is traditionally a batch least-squares solve (`M^T M x = M^T s`) over an alliance-participation matrix. Solved per-event with too few matches, the system is rank-deficient (Pitfall 2's identifiability trap: early in an event, the design matrix has fewer independent rows than teams). Two mitigations, both applied together: (1) pool a team's matches across **all events attended so far this season**, not just the current event, so the design matrix accumulates rows faster; (2) add a small ridge penalty (`M^T M + λI`) so the solve stays well-posed even when still rank-deficient early in the season (predictions naturally shrink toward the league-average score in that regime — a defensible cold-start behavior, not a bug).

**When to use:** `packages/core/algorithms/opr.ts`'s `predict()`/`update()` pair.

```typescript
// Source: OPR formula per TBA's own "Math Behind OPR" blog post (cited in
// .planning/research/PITFALLS.md Sources); ridge regularization and
// season-scope pooling are this researcher's own recommendation to resolve
// the identifiability pitfall for a walk-forward (not batch) computation —
// not found stated this way in the TBA blog post itself.
import { Matrix, SingularValueDecomposition } from "ml-matrix";

function solveRidgeOpr(
  observations: { teams: string[]; allianceScore: number }[],
  teamIndex: Map<string, number>,
  lambda = 3
): Map<string, number> {
  const n = teamIndex.size;
  const M = Matrix.zeros(observations.length, n);
  const s = Matrix.columnVector(observations.map((o) => o.allianceScore));
  observations.forEach((obs, row) => {
    for (const team of obs.teams) M.set(row, teamIndex.get(team)!, 1);
  });
  const MtM = M.transpose().mmul(M).add(Matrix.eye(n).mul(lambda));
  const Mts = M.transpose().mmul(s);
  const x = new SingularValueDecomposition(MtM).solve(Mts);
  const result = new Map<string, number>();
  for (const [team, idx] of teamIndex) result.set(team, x.get(idx, 0));
  return result;
}
```

### Anti-Patterns to Avoid

- **Solving OPR per-event only:** Reintroduces Pitfall 2 (unidentifiable model) every single event's first few matches. Always pool season-to-date observations.
- **Reading `winner`/scores off the raw `MatchResult` inside `predict()`:** Even with the Proxy guard in place, don't design algorithm code that "cheats" by reaching into a closure-captured array of all matches instead of the object `predict()` was actually handed. The guard only protects the object it wraps.
- **Treating a missing `score_breakdown` as `0`:** Per `.planning/research/PITFALLS.md` Pitfall 5, missing must mean "unknown" (nullable in the schema, explicit `hasScoreBreakdown: boolean` flag), never silently coerced to zero — a zeroed breakdown would corrupt any later per-component model (Phase 3).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Least-squares / ridge regression solve | A custom Gaussian-elimination or gradient-descent solver | `ml-matrix`'s `SingularValueDecomposition`/`solve` | Numerical stability (ill-conditioned matrices, especially early-season with few observations) is a well-known hard problem; a hand-rolled solver is exactly the kind of thing that "looks done but isn't" until a specific team's row makes it diverge |
| Embedded relational storage with indexed cross-table queries | A hand-rolled JSON-file index/cache layer | `better-sqlite3` | SQLite's query planner and indexing already solve "give me team X's matches across all events, sorted by time" — reimplementing that over flat files reproduces a database, badly |
| Zod schema validation for third-party JSON | Manual `if (typeof x.foo !== "string") throw` checks scattered through the ingestion code | Zod schemas as the single source of truth for TBA response shape (already the project's fixed stack choice) | The project's own failure log names "docs described a model that had been deleted" — a schema that fails loudly on TBA drift is exactly the guard against silent corpus corruption |
| Statbotics per-season accuracy numbers (for D-04's reference row) | Manually eyeballing/copy-pasting numbers from the Statbotics blog into a hardcoded report constant | Statbotics' own REST/Python API (`epa_acc`/`epa_mse` fields exist on their `Year` model — confirmed via their SDK docs) fetched once and cached alongside the corpus | Hardcoded numbers silently go stale and can't be re-verified; an API-fetched, cached value is auditable and matches this project's own "no silently stale docs" failure-log lesson. **Exact endpoint URL was not confirmed this session (see Open Questions) — a first pipeline task should resolve it** |

**Key insight:** Everything in this phase that touches numerical correctness (least-squares, Brier score, calibration binning) or third-party data shape (TBA JSON, Statbotics JSON) has a well-known library or schema-validation answer. The only genuinely bespoke code this phase should write is the *domain* logic — the quirk-normalization rules and the leak-proof walk-forward driver — because those are specific to this project's decisions (D-05 through D-11), not solved problems elsewhere.

## Common Pitfalls

### Pitfall 1: TBA exposes no replay flag — a naive re-fetch silently overwrites without a trace

**What goes wrong:** D-08 requires keeping "only the final result... with a flag noting a replay occurred." A naive implementation that just upserts-by-match-key on each ingestion run will correctly keep the final score, but silently lose the fact that a replay happened, because TBA's schema (confirmed via TBA's own model source — see Sources) has no `replayed` boolean anywhere.

**Why it happens:** It's a reasonable assumption that "replay" would be a documented field, since it's clearly a real event in FRC competition. It isn't, in the public API schema.

**How to avoid:** The corpus's `matches` table must record, per match key, whether a *previously ingested* row for that key had its score-bearing fields (`winning_alliance`, `red_score`, `blue_score`, `score_breakdown_raw`) change on a subsequent ingestion run *after* that match had already been marked complete (`actual_time` set / `post_result_time` set). When detected, set `replayed = true` and overwrite with the new values — this is a diff-on-upsert, not a plain upsert.

**Warning signs:** A team's win/loss record derived from the corpus doesn't match TBA's website for an event that had a known field-fault replay (rare, but real — check at least one historical event known to have had one, if a test fixture can be found).

**Phase to address:** This phase — DATA-02's success criterion explicitly requires the flag to exist and be non-silent.

---

### Pitfall 2: TypeScript's npm `latest` is now 7.0.x — a native-Go rewrite with **no compiler API**

**What goes wrong:** `npm view typescript version` returns `7.0.2` as of this research (confirmed live against the registry). TypeScript 7.0 is a from-scratch native/Go port shipping as the `typescript` package's `latest` dist-tag — but per multiple independent sources (InfoQ, TypeScript's own devblog, community migration guides — cross-checked, not single-sourced), **7.0 does not ship a compiler API**. Tools that depend on that API (`typescript-eslint`, `ts-morph`, custom AST transformers) do not work against a bare 7.0 install; Microsoft ships a separate `@typescript/typescript6` compatibility package (a `tsc6` binary + the 6.0 API) for tooling that still needs it.

**Why it happens:** `npm install -D typescript` with no version pin, or a `^5` semver range that a lockfile refresh later bumps, would silently jump a project onto 7.x and break any API-dependent tooling added in a later phase (most plausibly ESLint's TypeScript plugin, which is not part of Phase 1's scope but very likely to be added once `apps/web` exists in Phase 2+).

**How to avoid:** Pin `typescript` to `5.9.3` explicitly (not `^5`, not `latest`) in this phase's `package.json`. Phase 1's own tooling (tsx, Vitest) transpiles via esbuild, not the TS compiler API, so this pin doesn't cost anything functionally — it's purely a forward-compatibility safeguard for later phases.

**Warning signs:** A `pnpm add -D typescript` (unpinned) run after this phase silently installing 7.x; any future ESLint setup failing with "cannot find compiler API" style errors.

**Phase to address:** This phase (the `package.json` is created here) — but the *decision itself* (stay on 5.x vs. adopt 7.x project-wide) should be confirmed with the user, since it's a project-wide tooling choice, not Phase-1-scoped. See Open Questions.

---

### Pitfall 3: `better-sqlite3` is a native module — verify the actual CI/dev machine before assuming zero friction

**What goes wrong:** Even though `better-sqlite3` v13 reports `gypfile: false` (suggesting it ships prebuilt N-API binaries rather than requiring a `node-gyp` compile step — a positive signal `[VERIFIED: npm view better-sqlite3 gypfile]`), native modules are historically the single most common source of "works on my machine, fails in CI" bugs, especially crossing Windows dev machine → Linux CI runner.

**Why it happens:** Prebuilt-binary coverage can lag behind the very newest Node minor versions, and this project is on Node 24 (current LTS as of this research), which is young enough that prebuild matrices might not yet cover every platform/arch combination.

**How to avoid:** As a first Wave 0 task, actually run `pnpm add better-sqlite3` and `require("better-sqlite3")` in a throwaway script on both the dev machine and (if CI exists yet) the CI runner, before designing anything on top of it. If it fails to install cleanly anywhere the pipeline needs to run, the fallback is Node's built-in (experimental, as of Node 24) `node:sqlite` module — noted as an alternative above.

**Warning signs:** `npm install` failures mentioning `node-gyp`, Python, or a missing Visual Studio Build Tools toolchain on Windows.

**Phase to address:** This phase, as an early Wave 0 spike before the corpus schema is built out.

---

### Pitfall 4: RP "awards" (D-05) may or may not require per-season rule logic in Phase 1

**What goes wrong:** D-05 says Phase 1 normalizes "totals, winner, and RP awards" but defers per-season score-component extraction to Phase 3. Investigating TBA's own source turned up a computed field the API injects into `score_breakdown[color]` for at least some years: `tba_rpEarned` (confirmed for 2016/2017 in the source method `_add_tba_breakdown_fields`; the same method appeared to branch per-year but full coverage for 2022–2026 could not be confirmed with certainty this session — see Open Questions). **If** this field (or an equivalent TBA-computed per-match RP total) is present for 2022–2026, Phase 1's RP-awards normalization is a straight field read, no season-specific rule logic needed, cleanly respecting D-05's deferral. **If** it is absent for some years, Phase 1 needs *at minimum* a trivial win/tie RP rule (2/1/0) plus whatever named boolean bonus fields that season's `score_breakdown` happens to expose — which starts to overlap with the "per-season RP rules" work explicitly scoped to Phase 3.

**Why it happens:** TBA's schema is genuinely per-season (score_breakdown shape changes every year), and this researcher's source access this session (via WebFetch summarization of GitHub source, not a byte-exact diff) could not fully confirm coverage for every 2022–2026 year with high confidence.

**How to avoid:** First pipeline task: fetch one real match from each of the 2022, 2023, 2024, 2025, 2026 seasons and inspect the actual `score_breakdown` JSON for a `tba_rpEarned`-style field before writing the Zod schema or the RP-normalization logic. Write this as an explicit, cheap verification step — do not assume either way.

**Warning signs:** RP totals in the corpus that don't match TBA's website for a specific season; RP-awards logic that silently only works for the season it was tested against (this is literally Pitfall 6 from `.planning/research/PITFALLS.md`, restated for Phase 1's narrower scope).

**Phase to address:** This phase, as a first-task verification; full per-season RP *prediction* rule tables remain Phase 3's job per the existing roadmap.

---

### Pitfall 5: DQ'd teams are a TBA quirk not covered by any locked decision

**What goes wrong:** TBA's alliance object separately exposes `dq_team_keys`/`dqs` alongside `surrogates` (confirmed via TBA's own model source). CONTEXT.md's decisions (D-06/D-07/D-08) cover offseason, surrogate, and replay handling explicitly, but say nothing about disqualified teams. A DQ'd team typically still physically played the match, but is ruled to have automatically lost for ranking purposes regardless of the alliance's actual score — structurally similar to (but distinct from) a surrogate.

**Why it happens:** DQs are rare enough that a naive ingestion built and tested against a handful of events may never encounter one, then silently mis-score that team's record.

**How to avoid:** At minimum, store `dq_team_keys` in the normalized schema (so the data isn't lost) even though DATA-02's explicit success criterion only names surrogates/replays/missing-breakdowns/offseason. Flag this to the user as an open scope question rather than silently deciding a rating-impact policy — see Open Questions.

**Phase to address:** This phase for data capture; a ratings-impact policy decision is out of this researcher's authority (not covered by any locked decision) and should go back to the user or Claude's discretion at planning time.

## Code Examples

### TBA client with ETag conditional requests (DATA-01)

```typescript
// Source: pattern per The Blue Alliance's own "Efficiently Querying the TBA API"
// blog post (cited in .planning/research/ARCHITECTURE.md and STACK.md Sources);
// header names confirmed via community-sourced TBA API documentation
// (X-TBA-Auth-Key for auth) cross-checked against TBA's own source repo's
// header-handling conventions this session.
const TBA_BASE = "https://www.thebluealliance.com/api/v3";

async function tbaFetch(
  path: string,
  apiKey: string,
  cachedEtag: string | undefined
): Promise<{ status: 200 | 304; etag?: string; body?: unknown }> {
  const res = await fetch(`${TBA_BASE}${path}`, {
    headers: {
      "X-TBA-Auth-Key": apiKey,
      ...(cachedEtag ? { "If-None-Match": cachedEtag } : {}),
    },
  });
  if (res.status === 304) return { status: 304 };
  if (!res.ok) throw new Error(`TBA ${path} -> ${res.status}`);
  return { status: 200, etag: res.headers.get("etag") ?? undefined, body: await res.json() };
}
```

### SQLite corpus schema sketch (D-05, DATA-02)

```sql
-- Source: original design, following D-05's "store raw score_breakdown as-is,
-- normalize only totals/winner/RP" and DATA-02's explicit-flag requirement.
CREATE TABLE teams (
  team_key TEXT PRIMARY KEY,        -- e.g. "frc254"
  team_number INTEGER NOT NULL,
  nickname TEXT
);

CREATE TABLE events (
  event_key TEXT PRIMARY KEY,       -- e.g. "2024casj"
  year INTEGER NOT NULL,
  event_type INTEGER NOT NULL,      -- TBA event_type enum (0=Regional ... 99=Offseason, 100=Preseason)
  is_offseason INTEGER NOT NULL,    -- derived: event_type == 99 (D-06)
  start_date TEXT NOT NULL
);

CREATE TABLE matches (
  match_key TEXT PRIMARY KEY,       -- e.g. "2024casj_qm12"
  event_key TEXT NOT NULL REFERENCES events(event_key),
  comp_level TEXT NOT NULL,         -- 'qm' | 'ef' | 'qf' | 'sf' | 'f'
  match_number INTEGER NOT NULL,
  set_number INTEGER NOT NULL,
  sort_time INTEGER NOT NULL,       -- actual_time ?? predicted_time ?? time ?? fallback (Pattern 3)
  red_teams TEXT NOT NULL,          -- JSON array of team_keys (includes surrogates)
  blue_teams TEXT NOT NULL,
  red_surrogates TEXT NOT NULL,     -- JSON array, subset of red_teams (D-07)
  blue_surrogates TEXT NOT NULL,
  red_dqs TEXT NOT NULL,            -- JSON array (see Pitfall 5)
  blue_dqs TEXT NOT NULL,
  winner TEXT,                      -- 'red' | 'blue' | 'tie' | NULL if unplayed
  red_score INTEGER,
  blue_score INTEGER,
  red_rp_earned INTEGER,            -- NULL if not derivable yet (see Pitfall 4)
  blue_rp_earned INTEGER,
  has_score_breakdown INTEGER NOT NULL,  -- 0 if TBA omitted it (never coerce to 0-value fields)
  score_breakdown_raw TEXT,         -- exact TBA JSON, verbatim (D-05)
  replayed INTEGER NOT NULL DEFAULT 0    -- synthesized flag (Pitfall 1 — TBA has no such field)
);

CREATE INDEX idx_matches_sort_time ON matches(sort_time);
CREATE INDEX idx_matches_event ON matches(event_key);

CREATE TABLE http_cache (
  url TEXT PRIMARY KEY,
  etag TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
```

### Brier score, winner accuracy, calibration binning (EVAL-02, EVAL-03)

```typescript
// Source: Brier score is a standard proper scoring rule (well-established
// statistics, not sourced from a specific document this session); calibration
// binning follows the "reliability diagram" approach flagged as required by
// .planning/research/PITFALLS.md Pitfall 10.
function brierScore(predictions: { pWin: number; won: boolean }[]): number {
  const sq = predictions.map((p) => (p.pWin - (p.won ? 1 : 0)) ** 2);
  return sq.reduce((a, b) => a + b, 0) / sq.length;
}

function winnerAccuracy(predictions: { pWin: number; won: boolean }[]): number {
  const correct = predictions.filter((p) => (p.pWin >= 0.5) === p.won).length;
  return correct / predictions.length;
}

function calibrationBins(
  predictions: { pWin: number; won: boolean }[],
  binCount = 10
): { binStart: number; binEnd: number; meanPredicted: number; observedFrequency: number; n: number }[] {
  const bins = Array.from({ length: binCount }, (_, i) => ({
    binStart: i / binCount,
    binEnd: (i + 1) / binCount,
    predicted: [] as number[],
    outcomes: [] as boolean[],
  }));
  for (const p of predictions) {
    const idx = Math.min(binCount - 1, Math.floor(p.pWin * binCount));
    bins[idx].predicted.push(p.pWin);
    bins[idx].outcomes.push(p.won);
  }
  return bins.map((b) => ({
    binStart: b.binStart,
    binEnd: b.binEnd,
    meanPredicted: b.predicted.length ? b.predicted.reduce((a, c) => a + c, 0) / b.predicted.length : NaN,
    observedFrequency: b.outcomes.length ? b.outcomes.filter(Boolean).length / b.outcomes.length : NaN,
    n: b.outcomes.length,
  }));
}
```

Per D-11, run all three of the above three times per algorithm per season: `comp_level === 'qm'` only, `comp_level !== 'qm'` only (elims), and combined.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| TypeScript 5.x as "current" | TypeScript 7.0 (native Go compiler, GA) is npm's `latest` | Confirmed GA per InfoQ + TypeScript's own devblog, recent as of this research (cross-checked, MEDIUM confidence) | 7.0 ships no compiler API — breaks `typescript-eslint`/`ts-morph`-style tooling until `7.1`. This phase should pin `5.9.3` explicitly; revisit project-wide once 7.1's API lands or once a specific tool's 7.x support is confirmed |
| `ts-node` for running TS scripts | `tsx` (already the project's chosen tool) | Already reflected in project's own STACK.md | No action needed — already correctly recommended |

**Deprecated/outdated:** Nothing else identified as stale within this phase's narrow scope; the project's own `STACK.md`/`ARCHITECTURE.md`/`PITFALLS.md` (dated the same day as this research) remain current.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `better-sqlite3` is the right package name/choice for the corpus | Standard Stack | Low — package legitimacy check confirms it exists, is heavily used, and has an official repo; worst case is a mid-phase swap to `node:sqlite` |
| A2 | `ml-matrix` is the right package name/choice for the OPR solve | Standard Stack | Low — same reasoning as A1 |
| A3 | TBA's `score_breakdown` exposes a computed `tba_rpEarned`-equivalent field consistently across 2022–2026 | Pitfall 4, Don't Hand-Roll | Medium — if false for some years, Phase 1's RP-normalization scope quietly grows to overlap Phase 3's per-season RP rules work; mitigated by the recommended first-task verification against real match JSON |
| A4 | Statbotics exposes `epa_acc`/`epa_mse` per-year via a programmatically-fetchable API (exact endpoint URL unconfirmed) | Don't Hand-Roll (D-04 support) | Medium — if the endpoint can't be resolved, D-04's reference row falls back to a manually-maintained constant, which is workable but loses the "always current" property |
| A5 | TypeScript 7.0's compiler-API removal will actually matter for a future phase (not this one) | Pitfall 2 | Low — worst case, this phase's `5.9.3` pin is unnecessary caution; it costs nothing functionally either way |
| A6 | No explicit "replay" flag exists anywhere in TBA's public API schema | Pitfall 1 | Medium-High — if a flag does exist somewhere this research didn't surface, the recommended diff-on-upsert replay detector is extra (harmless) work rather than the only mechanism; if confirmed absent (as researched), the detector is load-bearing and must not be skipped |

## Open Questions

1. **Does `tba_rpEarned` (or an equivalent) exist in `score_breakdown` for all of 2022–2026?**
   - What we know: Confirmed present for 2016/2017 in TBA's own source method `_add_tba_breakdown_fields`; the method appears to branch per-year (2020 and 2025 were also referenced) but full 2022–2026 coverage could not be confirmed with certainty via this session's tooling.
   - What's unclear: Whether Phase 1's "RP awards" normalization (D-05) is a trivial field read for every covered season, or needs season-specific bonus-rule logic for some.
   - Recommendation: First pipeline task fetches one real match per season and inspects the actual JSON before schema/logic is written (see Pitfall 4).

2. **Exact Statbotics REST API endpoint + auth requirements for D-04's reference row.**
   - What we know: Statbotics' own Python SDK/docs confirm a `Year` model with `epa_acc`/`epa_mse` fields, fetchable via `get_year()`/`get_years()`; direct `WebFetch` probing of `api.statbotics.io/v3/year/{year}` this session returned a 500 (likely wrong path shape, not a real outage).
   - What's unclear: The exact correct REST path/params, and whether it requires no auth (Statbotics' public API is generally documented as unauthenticated, but this wasn't independently confirmed this session).
   - Recommendation: Resolve during Phase 1 implementation — either call the documented `statbotics` PyPI/npm-equivalent client if one exists for Node, or replicate the REST call after inspecting the SDK's actual HTTP request. If this stalls, fall back to a manually-sourced, dated constant for the D-04 reference row rather than blocking the phase on it.

3. **Should DQ'd teams' participation be excluded from OPR rating updates the same way surrogates are (D-07)?**
   - What we know: TBA exposes `dq_team_keys` distinctly from `surrogates`; CONTEXT.md's locked decisions don't mention DQs at all.
   - What's unclear: Whether a DQ (team played, but ruled an automatic loss) should affect that team's OPR contribution the same way, differently, or not be a Phase 1 concern at all (DATA-02's success criterion only names surrogates/replays/missing-breakdowns/offseason).
   - Recommendation: Capture `dq_team_keys` in the schema regardless (cheap, preserves information); treat the ratings-impact policy as a planning-time decision within Claude's discretion, or send back to the user if the planner judges it materially affects OPR's correctness as a baseline.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Pipeline runtime | ✓ | 24.15.0 | — |
| npm | Package installs | ✓ | 11.12.1 | — |
| pnpm | Project's chosen package manager (workspaces) | ✗ | — | `corepack enable && corepack prepare pnpm@latest --activate` (corepack ships with Node 24) — near-zero-cost fallback, recommend doing this as a Wave 0 setup step rather than falling back to plain npm |
| git | Version control (already in use) | ✓ | 2.53.0 | — |
| Python (build toolchain, in case better-sqlite3 needs a native build) | Fallback for `better-sqlite3` native compile if no prebuild matches | ✓ (present on PATH) | not version-checked | — |
| TBA API key | All TBA ingestion | Present in untracked `.env` at repo root (per CONTEXT.md's Integration Points — not read this session, per secrets handling policy) | — | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** pnpm (use corepack to install it — trivial, recommended as a Wave 0 task rather than a blocker).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 (project-fixed) |
| Config file | none yet — Wave 0 gap |
| Quick run command | `pnpm vitest run --changed` (or `pnpm vitest run <file>` for a targeted module) |
| Full suite command | `pnpm vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DATA-01 | ETag conditional request returns 304 on unchanged upstream, avoids re-download | unit (mocked fetch) | `pnpm vitest run packages/ingest/tbaClient.test.ts` | ❌ Wave 0 |
| DATA-02 | Surrogate/replay/missing-breakdown/offseason each produce an explicit flag, never silent drop | unit | `pnpm vitest run packages/ingest/normalize.test.ts` | ❌ Wave 0 |
| EVAL-01 | Predict-before-update: reading a forbidden field on the upcoming-match Proxy throws | unit (the literal criterion-4 test) | `pnpm vitest run packages/harness/replay.test.ts` | ❌ Wave 0 |
| EVAL-02 | Brier score / winner accuracy computed correctly on a known fixture | unit | `pnpm vitest run packages/core/scoring/brier.test.ts` | ❌ Wave 0 |
| EVAL-03 | Calibration bins sum to total prediction count; empty bins report `NaN` not `0` (don't silently fabricate a rate for an empty bin) | unit | `pnpm vitest run packages/core/scoring/calibration.test.ts` | ❌ Wave 0 |
| EVAL-04 | Tune/holdout season split is enforced in the report's season labeling (2022–2024 tagged tune, 2025–2026 tagged holdout) | unit | `pnpm vitest run packages/harness/report.test.ts` | ❌ Wave 0 |
| ALGO-01 | OPR ridge solve recovers known synthetic team strengths on a small fixture; season-scope pooling produces a solvable system even with a single 2-match event | unit | `pnpm vitest run packages/core/algorithms/opr.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** targeted `pnpm vitest run <file>` for the module just touched
- **Per wave merge:** `pnpm vitest run` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`; additionally, run the harness CLI end-to-end against one real season (e.g., 2024) and manually eyeball the HTML report before calling the phase done — this is the one thing unit tests alone can't fully substitute for (D-01's "self-contained HTML report" is a human-facing artifact)

### Wave 0 Gaps

- [ ] `vitest.config.ts` — no test config exists yet
- [ ] `package.json` + `pnpm-workspace.yaml` — repo has no manifest yet (clean-slate repo, confirmed: only `REBUILD_SPEC.md`, `.planning/`, `.github/`, `.env`, `.gitignore` exist at repo root)
- [ ] `packages/core/scoring/brier.test.ts`, `calibration.test.ts` — shared fixtures for a known-answer probability set
- [ ] `packages/harness/replay.test.ts` — the criterion-4 leakage test is the single most important test in this phase; write it before or alongside the Proxy guard itself
- [ ] Throwaway native-module spike script (`node -e "require('better-sqlite3')"`) — run once during Wave 0 per Pitfall 3, not itself a permanent test

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | This phase has no user-facing auth surface — it's a local CLI pipeline |
| V3 Session Management | No | N/A — no sessions |
| V4 Access Control | No | N/A — single-operator local pipeline |
| V5 Input Validation | Yes | Zod schemas validating every TBA API response at the fetch boundary before it enters the corpus — the primary defense against malformed/unexpected third-party JSON (already the project's fixed choice) |
| V6 Cryptography | No | No cryptographic operations in this phase |
| V(secrets handling) | Yes (not a numbered ASVS category, but directly relevant) | TBA API key stays in the untracked `.env` (already the case per CONTEXT.md's Integration Points) and is read server/pipeline-side only — never logged, never written into the JSON artifact or HTML report, never committed. Verify `.gitignore` covers `.env` before the first pipeline commit `[VERIFIED: .planning/research/PITFALLS.md Security Mistakes table]` |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/unexpected TBA JSON shape silently corrupting the corpus | Tampering (of trust in third-party data, not malicious) | Zod validation at the fetch boundary; fail loudly (throw, log, halt that record) rather than coercing to a default |
| TBA API key committed to git history | Information Disclosure | `.env` already untracked; confirm `.gitignore` entry exists and covers it as the very first check when pipeline code starts touching the key |
| A malformed/partial pipeline run publishing a broken JSON artifact | Tampering / Denial of Service (of the eventual Compare page, Phase 8) | Not this phase's problem to fully solve (no publishing yet), but worth designing the JSON schema with Zod from day one so a future publish step can validate before writing, per `.planning/research/PITFALLS.md` Security Mistakes table |

## Sources

### Primary (HIGH confidence)
- Direct tool verification this session: `node --version`, `npm --version`, `git --version`, `npm view <pkg> version/engines/gypfile/repository.url` for typescript, tsx, zod, vitest, better-sqlite3, @types/better-sqlite3, ml-matrix — all confirmed live against the npm registry and local dev machine on 2026-08-12
- `gsd_run query package-legitimacy check` — ran against better-sqlite3, @types/better-sqlite3, zod, tsx, vitest, typescript, ml-matrix

### Secondary (MEDIUM confidence)
- `.planning/research/SUMMARY.md`, `.planning/research/PITFALLS.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/STACK.md` — this project's own prior research (dated same day), treated as an established, already-vetted source for this phase
- `REBUILD_SPEC.md` — product spec and failure log (read directly this session)
- TBA source repository, fetched via WebFetch, cross-checked across multiple files (`event_type.py`, `comp_level.py`, `match.py`) — `github.com/the-blue-alliance/the-blue-alliance` (official upstream): `EventType` enum values (REGIONAL=0 … OFFSEASON=99, PRESEASON=100), `CompLevel` enum (qm/ef/qf/sf/f), Match model's `alliances_json` shape (`teams`/`surrogates`/`dqs`/`score`), the `_add_tba_breakdown_fields`/`tba_rpEarned` mechanism (partial-year confirmation only — see Open Questions)
- WebSearch, cross-checked across 2+ independent results: `surrogate_team_keys`/`dq_team_keys` field naming (community client libraries), `X-TBA-Auth-Key` header + match key format (`yyyy[EVENT_CODE]_[COMP_LEVEL]m[MATCH_NUMBER]`), TypeScript 7.0 GA + native compiler + missing compiler API (InfoQ, TypeScript devblog titles, multiple third-party migration guides)
- Statbotics' own Python SDK docs (`statbotics.readthedocs.io`, fetched via WebFetch) — confirms `epa_acc`/`epa_mse` fields exist on a `Year` model, exact REST endpoint unconfirmed

### Tertiary (LOW confidence)
- `api.statbotics.io/v3/year/{year}` direct WebFetch probe — returned HTTP 500, inconclusive (likely wrong path, not confirmed either way)
- `thebluealliance.com/apidocs/v3` and `statbotics.io/blog/*` — both returned HTTP 403 to direct WebFetch this session; all TBA/Statbotics findings above were sourced from GitHub source/SDK docs instead, not the blocked doc pages themselves

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified live against npm registry this session; two packages (better-sqlite3, ml-matrix) are `[ASSUMED]` by name-provenance rule despite registry verification, since they were selected from training knowledge
- Architecture: HIGH — builds directly on the project's own same-day `ARCHITECTURE.md`, adds a concrete, testable mechanism (Proxy guard) for the specific "structurally impossible leakage" success criterion
- TBA data quirks: MEDIUM — surrogate/DQ/event-type/comp-level fields confirmed against TBA's own source code; the replay-flag absence and full RP-field-coverage-by-year claims carry real residual uncertainty (documented explicitly in Open Questions/Assumptions Log rather than asserted as fact)
- Pitfalls: MEDIUM-HIGH — generic pitfalls inherited from the project's own vetted `PITFALLS.md`; phase-specific pitfalls (TS7, better-sqlite3 native module, replay-flag absence) are new findings from this session, cross-checked where possible

**Research date:** 2026-08-12
**Valid until:** ~30 days for the TBA schema/architecture findings (stable domain); recheck the TypeScript 7.x compiler-API-availability question sooner (~2 weeks) since that ecosystem is actively evolving post-GA
