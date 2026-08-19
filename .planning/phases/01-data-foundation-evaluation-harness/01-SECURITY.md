---
phase: 01
slug: data-foundation-evaluation-harness
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (high)
threats_open: 0
asvs_level: 1
created: 2026-08-19
---

# Phase 1 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
>
> Register origin: authored at plan time — all six of `01-01-PLAN.md` … `01-06-PLAN.md`
> carry a `<threat_model>` block. This audit therefore **verifies the declared mitigations
> exist**; it does not scan for new threats (ASVS L1, grep-depth verification).

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| npm registry → local toolchain | Third-party package code executes at install time and at runtime | Executable dependency code (`better-sqlite3`, `ml-matrix`, `zod`) |
| `.env` → pipeline process | The TBA API key crosses from an untracked file into process memory | Secret (API key) |
| TBA API → corpus | Five seasons of untrusted third-party JSON cross into durable local storage | Untrusted structured data |
| Statbotics API → report | Untrusted third-party JSON crosses into a published-looking comparison figure | Untrusted structured data |
| Pipeline → TBA API | Outbound request volume crosses into a free, volunteer-run third-party service | Outbound request load |
| Corpus / TBA text → generated HTML | Third-party strings cross into a browser-rendered document | Untrusted text into markup |
| Corpus → algorithm state | Values normalized from a third-party feed drive a numerical solve | Untrusted numerics |
| Harness output → published claim | Numbers leaving a run become accuracy claims other people rely on | Integrity of a public claim |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-SC | Tampering | pnpm installs (`better-sqlite3`, `@types/better-sqlite3`, `ml-matrix`) | high | mitigate | Package Legitimacy Audit in `01-RESEARCH.md` (slopcheck) gated as a blocking human checkpoint before any install/postinstall ran | closed |
| T-01-01 | Tampering | `packages/ingest/schemas.ts` fetch boundary | medium | mitigate | Every TBA response Zod-parsed before normalization — `tbaMatchListSchema` / `tbaTeamListSchema` / `tbaEventListSchema` / `tbaEventSchema` / `tbaStatusSchema` `.parse()` at `packages/ingest/cli.ts:121,142,159,208,223`; a shape change throws rather than coercing defaults into the corpus | closed |
| T-01-02 | Information Disclosure | TBA API key in `.env` / long backfill | high | mitigate | `git check-ignore .env` exits 0; key read from `process.env` only at four CLI entry points (`packages/ingest/cli.ts:50`, `packages/harness/cli.ts:188`, `packages/harness/promote.ts:316`, `scripts/recon-tba-fields.ts:36`) and passed as a parameter; never persisted to `ingest_runs`, never in an error message; key-absence asserted in `tbaClient.test.ts` | closed |
| T-01-03 | Tampering | `renderHtmlReport` interpolating TBA-sourced event and team text | low | mitigate | 26 `escapeHtml` call sites in `packages/harness/report.ts`; report references no off-disk script or stylesheet (independently re-confirmed by `01-VERIFICATION.md` grep for `src=` / external `href=` / `<script src`) | closed |
| T-01-04 | Denial of Service | Outbound TBA request volume in `tbaClient.ts` | medium | mitigate | `THROTTLE_INTERVAL_MS = 100` enforced *inside* `tbaFetch` (`packages/ingest/tbaClient.ts:26,63-77`) so no call site can bypass it; `If-None-Match` conditional requests make a repeat run 304-only (1,585/1,699 measured); per-run 200/304 counts persisted to `ingest_runs` | closed |
| T-01-05 | Tampering | Statbotics / TBA JSON entering the reference row | low | mitigate | `StatboticsYearResponseSchema.parse()` at `packages/harness/statbotics.ts:98`; any failure falls back to a dated manual constant, and `sourceLabel` records which of the two paths produced the number | closed |
| T-01-06 | Repudiation | Artifact / corpus rows with no provenance | medium | mitigate | `ProvenanceSchema` requires `corpusIdentity` + `runTimestamp`; artifact carries `schemaVersion`, algorithm id/version, seasons covered (`packages/harness/artifact.ts:75-76,99-100,152-155`); `ingest_runs` records what ran, when, over which seasons, at what request cost | closed |
| T-01-08 | Tampering | Concurrent writers corrupting the corpus | low | mitigate | WAL plus a single-writer lock file with stale-PID reclamation (`packages/corpus/db.ts:41-64`); a second concurrent ingestion fails fast with a readable message. **Caveat:** the acquire is `existsSync`-then-`writeFileSync`, a TOCTOU window (`01-REVIEW.md` WR-01→WR-03). Below the `high` block threshold; SQLite WAL still prevents corruption in the racing case | closed — with caveat |
| T-01-09 | Denial of Service | `solveRidgeOpr` on an ill-conditioned or adversarially-shaped observation set | low | mitigate | `OPR_RIDGE_LAMBDA = 3` added as `lambda*I` to the normal equations (`packages/core/algorithms/opr.ts:37,209`) keeps them invertible at any observation count; tests assert finite ratings in the deliberately under-determined two-match cold start. **Caveat:** no runtime `denom <= 0` / `isFinite` guard on the incremental Sherman-Morrison path (`01-REVIEW.md` WR-01); not observed to trigger across a real 78-minute full-corpus run | closed — with caveat |
| T-01-10 | Tampering | Unexpected null / absent team keys arriving from the corpus | low | accept | Closed upstream: corpus rows Zod-validated at ingestion (T-01-01) and team key columns declared NOT NULL in `schema.sql`. Duplicating validation inside the hot solve rejected at ASVS L1 — see Accepted Risks | closed |
| T-01-11 | Information Disclosure | API key reaching the artifact or report | high | mitigate | Neither `artifact.ts` nor `report.ts` reads the environment; `artifact.test.ts` asserts the serialized artifact does not contain the environment's key value | closed |
| T-01-12 | Denial of Service | Statbotics unavailability blocking a report run | low | mitigate | The reference row is context, not an input — fetch failure falls back to the dated constant (`packages/harness/statbotics.ts:53-85`) and the run completes | closed |
| T-01-13 | Tampering | The harness mutating the corpus it is scoring | medium | mitigate | `openCorpusReadOnly` opens with `{ readonly: true, fileMustExist: true }` (`packages/corpus/db.ts:95-96`); `replay.season.test.ts` asserts a write through that handle fails at the SQLite layer. **Caveat:** the adjacent in-memory case is not covered — `toLeakProofUpcoming`'s Proxy has no `set`/`defineProperty`/`deleteProperty` trap, so a buggy `predict()` can mutate the in-process `MatchResult` before `update()` folds it in (`01-VERIFICATION.md` NEW-01). Durable corpus integrity — the threat as written — is closed | closed — with caveat |
| T-01-14 | Repudiation | A tune-season figure presented as a headline claim | high | mitigate | `headlineEligible: label === "holdout"` is *derived* from the season, never operator-set (`packages/harness/score.ts:152`); `seasonSplit` throws for a season outside 2022–2026 rather than defaulting; `01-UAT.md` tests 30–31 record independent human confirmation that the report presents only holdout rows as headline figures | closed |
| T-01-15 | Denial of Service | Concurrent harness runs contending over corpus or output | low | accept | Corpus opened read-only so concurrent readers cannot corrupt it; each run writes beneath its own `--out`. Same-`--out` overwrite accepted at ASVS L1 for a single-operator local pipeline — see Accepted Risks | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (high) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01-01 | T-01-10 | Null/absent team keys are already excluded upstream by Zod validation at ingestion plus NOT NULL columns; re-validating inside the hot solve costs clarity for no additional ASVS L1 coverage | Plan author (`01-04-PLAN.md`) | 2026-08-13 |
| AR-01-02 | T-01-15 | Two harness runs given the same `--out` overwrite each other's files. Accepted rather than locked for a single-operator local pipeline; the guarantee rests on operator-chosen output paths, which is recorded rather than assumed | Plan author (`01-06-PLAN.md`) | 2026-08-13 |
| AR-01-03 | T-01-05 (Plan 01 instance) | The `tba-field-recon.md` output is a human-read observation document, not corpus input and not executed; a malformed response is recorded as an observation. Corpus-bound TBA JSON is validated where it matters (T-01-01) | Plan author (`01-01-PLAN.md`) | 2026-08-13 |

*Accepted risks do not resurface in future audit runs.*

---

## Carried-Forward Non-Blocking Caveats

Three closed threats carry a known imperfection in their mitigation. None is at or above the
`high` block threshold, so none contributes to `threats_open`. All three are already tracked
in `01-REVIEW.md` / `01-VERIFICATION.md` and are recorded here so a later audit does not
mistake them for newly-discovered gaps.

| Threat | Caveat | Source |
|--------|--------|--------|
| T-01-08 | Write-lock acquire is `existsSync`-then-`writeFileSync` (TOCTOU); no atomic `wx` open | `01-REVIEW.md` WR-03 |
| T-01-09 | No runtime `denom <= 0` / non-finite guard on the incremental RLS solve | `01-REVIEW.md` WR-01 |
| T-01-13 | No `set` / `defineProperty` / `deleteProperty` traps on the leak-proof wrapper — in-memory `MatchResult` is mutable by a buggy `predict()` | `01-VERIFICATION.md` NEW-01 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-19 | 15 | 15 | 0 | Claude (`/gsd-secure-phase 1`, ASVS L1, block_on: high) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-19
