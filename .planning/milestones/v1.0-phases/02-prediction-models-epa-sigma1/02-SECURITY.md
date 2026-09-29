---
phase: 02
slug: prediction-models-epa-sigma1
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (high)
threats_open: 0
asvs_level: 1
created: 2026-08-19
---

# Phase 2 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
>
> Register origin: authored at plan time — all six of `02-01-PLAN.md` … `02-06-PLAN.md`
> carry a `<threat_model>` block. This audit therefore **verifies the declared mitigations
> exist**; it does not scan for new threats (ASVS L1, grep-depth verification).
>
> Register assembly: the six per-plan registers name 16 distinct threats across 21 rows;
> threats appearing in more than one plan (T-02-01, T-02-02, T-02-04, T-02-05, T-02-09,
> T-02-13, T-02-SC) are merged into one row carrying the union of their mitigations and
> the highest severity assigned by any plan.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| TBA `score_breakdown_raw` → per-season parser | Third-party JSON stored verbatim in Phase 1; this phase's five season modules are the first code to read structured fields out of it. The phase's largest untrusted-input surface | Untrusted structured data |
| `MatchResult` → `predict()` | The leak-proof Proxy boundary. Outcome-bearing data must not cross it | Outcome labels (leakage vector) |
| parsed components → rating state | A non-finite or wrongly-typed value crossing here poisons every subsequent rating for that team and, via the alliance sum, its teammates | Untrusted numerics |
| numeric degeneracy → published uncertainty | A divide-by-zero or negative variance surfaces to a user as a plausible-looking `X ± Y`; it does not throw on its own | Integrity of a published `±` |
| prior-season state → current-season predictions | Cross-season carry is the only path by which data from outside a season influences its predictions; it must carry only past seasons | Walk-forward ordering guarantee |
| in-memory records → disk | Three new persistence paths this phase (`predictions.ts`, `metricHistory.ts`, `identifiability.ts`), each a place a secret or malformed record could reach a file | Secret (API key) / structured records |
| harness process → corpus file | The corpus must stay read-only during a scoring run; new readers and writers must not open it for write | Durable corpus integrity |
| artifact JSON → rendered HTML | The report is the human-facing surface; artifact strings (algorithm ids, source labels) cross into markup here | Untrusted text into markup |
| computed numbers → published claim | The write-up and report are where measurements become claims a reader will trust | Integrity of a public claim |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-02-01 | Tampering | Per-season parse boundary (`breakdown/{2022,2023,2024,2025,2026}.ts`) and `sigma1/index.ts` update path | high | mitigate | **Two independent gates.** Gate 1: each season Zod-validates the exact key subset it reads with `z.number().finite()` per field and `Schema.parse()` throwing rather than coercing — `2022.ts:69`, `2023.ts:70`, `2024.ts:77`, `2025.ts:65`, `2026.ts:96` (including 2026's nested `hubScore` shape). Gate 2: `assertFiniteComponents` (`breakdown/constants.ts:103-109`) runs on every observed component immediately before it folds into state — `epa.ts:476-477` and `sigma1/index.ts:786-787` — catching a value that survived parsing but was produced non-finite by `distributeResidual`'s degenerate branch. Regression: `reconciliation.test.ts:131` `describe("malformed breakdown handling (T-02-01)")` asserts a malformed side throws per season | closed |
| T-02-02 | Tampering | `replay.ts` `OUTCOME_KEYS` (leak-proof Proxy) | high | mitigate | `scoreBreakdownRaw` is a member of `OUTCOME_KEYS` (`packages/harness/replay.ts:24-32`), added in the same change that added it to `MatchResult`; both the `get` (`:48`) and `getOwnPropertyDescriptor` (`:56`) traps route through the shared `denyOutcomeKey` throw helper so the two surfaces cannot drift. Regression: `replay.test.ts:48` includes `scoreBreakdownRaw` in the parameterized denied-key case | closed |
| T-02-02b | Information Disclosure | `predictions.ts`, `metricHistory.ts`, `identifiability.ts` writers | high | mitigate | Both JSONL writers carry an optional `secretToScrub` and check the serialized line before any write, throwing first — `predictions.ts:113,130` and `metricHistory.ts:55,72`, matching `writeArtifact`'s check at `artifact.ts:177-180`. Regression: `predictions.test.ts:138-147` and `metricHistory.test.ts:82-89` each supply a secret, assert the throw, and assert the file does not contain it afterward. `identifiability.ts:639-642` documents why it has nothing to scrub (no env read, no network) | closed |
| T-02-04 | Tampering | `ParsedComponents` construction across five season modules | medium | mitigate | Every component record is built with `Object.create(null)` plus a fixed allowlist loop, so a `__proto__` or `constructor` key in third-party TBA JSON cannot reach `Object.prototype` — `2022.ts:76`, `2023.ts:77`, `2024.ts:84`, `2025.ts:72`, `2026.ts:103`, and `fallback.ts:56`. Zod's default strip mode on `.object()` independently drops unmapped keys before this point. **Caveat:** no dedicated prototype-pollution regression test exists; the control is structural (six construction sites, all null-prototype) rather than test-asserted. Below the `high` block threshold | closed — with caveat |
| T-02-05 | Information Disclosure | `writeArtifact` / `report.ts` under the v2 schema restructure | medium | mitigate | `writeArtifact`'s `secretToScrub` check survives the v2 restructure intact (`artifact.ts:177-180`); `report.ts` routes every artifact-sourced string through `escapeHtml` (`report.ts:17`, applied at `:86-89`, `:125-129`, `:179`, `:190-193`, `:231` and elsewhere), including the new Statbotics reference table's `sourceLabel`, `matchPopulation`, and `capturedAt` columns | closed |
| T-02-06 | Tampering | `distributeResidual` degenerate inputs | medium | mitigate | Explicit all-zero-prediction branch in `fallback.ts` distributes uniformly rather than evaluating 0/0, preventing a `NaN` from silently propagating into every downstream component mean. Regression: `breakdown.test.ts:36-41` asserts uniform distribution and no `NaN` at genuine cold start; `:299-315` asserts consecutive breakdown-less matches never produce `NaN` component means | closed |
| T-02-07 | Tampering | 2026's renamed foul fields | high | mitigate | `2026.ts:93` declares `diagnosticKeys: ["majorFoulCount", "minorFoulCount"]`, and `foulsCommitted` is derived from the opponent's `foulPoints` (`2026.ts:113`) rather than from any count field — so no `foulCount`/`techFoulCount` read exists to return `undefined` across ~20,000 2026 matches. All four `techFoulCount` occurrences in the module (`:5,7,91,112`) are comments documenting the rename. Enforcement: `reconciliation.test.ts` reconciles components against `totalPoints` for all five `REGISTERED_SEASONS` (`:28`) against the real corpus, and `:189-192` asserts a 2026 breakdown parsed under 2025's map throws rather than reading `undefined` for every field. **Caveat:** the plan also specified a grep-enforced absence test for `techFoulCount`; that specific test was not written. The reconciliation check is the stronger control and would fail on a wrong-field read | closed — with caveat |
| T-02-08 | Tampering | `cli.ts` season loop (backward season leakage) | high | mitigate | `carrySeason` is invoked only with `fromSeason: season - 1` (`cli.ts:542`) inside an ascending-order season replay (`:554-555`); an algorithm without `carrySeason` (OPR) is deliberately excluded. Regression: `cli.season-carry.test.ts:151` and `:166` assert a 2022-only run's predictions are byte-identical to the 2022 portion of a 2022–2023 run's, for both EPA (which carries) and OPR (which does not); `:179` asserts the carry is not silently no-opping. Test was authored during execution as a Rule 2 threat-model-mandated deviation (`02-03-SUMMARY.md:216-228`) | closed |
| T-02-09 | Repudiation | Statbotics reference row; identifiability write-up and full-run report | high | mitigate | Every Statbotics constant carries `sourceLabel: "…dated manual constant, unverified estimate — see Known Stubs"`, `capturedAt`, and `fetched: false` (`statbotics.ts:24-71`), so a published comparison always carries its provenance. `docs/models/sigma1-identifiability.md` quotes `reports/identifiability.json` rather than retyped numbers (`:3`, `:159`), states its sampling design and seed (`:25`), and gives the reproduce command (`:61`). The write-up's own correction at `:55-57` — an ad-hoc uncommitted union-find pass replaced by the committed `computeConnectedComponents`, with the prose corrected to match the script rather than the reverse — is the discipline working under load. Gated by a blocking human checkpoint | closed |
| T-02-10 | Tampering | `updateAllianceSum` zero-denominator branch | high | mitigate | Explicit guards in `kalman.ts` for `teammates.length === 0` (`:101`) and `pooledVariance === 0` (`:109`) return unchanged beliefs rather than dividing. Regression: `kalman.test.ts:145-154` asserts that with `pooledVariance + measurementNoise` exactly 0 every belief returns unchanged and no mean or variance is `NaN` — without which a converged team pair would publish `NaN` as a plausible blank `±` rather than an error | closed |
| T-02-11 | Tampering | `covariance.ts` shrinkage | medium | mitigate | `shrinkTowardDiagonal` (`covariance.ts:76-77`) applies constant shrinkage toward the diagonal on every `ewmaCovariance` fold (`:96,106`); the result is a convex combination of PSD matrices and therefore PSD. Regression: `covariance.test.ts:98-107` asserts positive semi-definiteness via Sylvester's criterion for a rank-deficient residual history — the normal early-season condition, not an exotic one | closed |
| T-02-12 | Repudiation | `teamMetrics` spread values | high | mitigate | `sigma1.test.ts:270` asserts two teams with identical means but different observed residual histories report different `spread` values, for both a component (`:314`) and the total (`:316`); `:224-245` asserts every entry carries a defined, finite spread. A regression substituting a constant spread fails rather than shipping uncertainty that is not honest — the failure this project's log already records once | closed |
| T-02-13 | Tampering | Corpus read-only guarantee across new read/write paths | high | mitigate | Every new corpus reader this phase opens through `openCorpusReadOnly` (`corpus/db.ts:95`, `{ readonly: true, fileMustExist: true }`): `identifiability.ts:95,532` with an explicit T-02-13 comment at `:188`, alongside the pre-existing `cli.ts:605`, `promote.ts:227`, and `tune.ts:375,473,767`. Both new sidecar writers write only beneath the run's `--out` directory (`predictions.ts:17`), never into the corpus. Preserves Phase 1's T-01-13 under D-23's side-artifact-not-corpus choice | closed |
| T-02-14 | Tampering | JSONL record validation | medium | mitigate | Every record is Zod-parsed before serialization — `PredictionRecordSchema.parse()` at `predictions.ts:128` and `MetricHistoryRowSchema.parse()` at `metricHistory.ts:70`, both including `.refine()` constraints. Regression: `predictions.test.ts:83,116,163,177` round-trip written lines back through the schema and `:185` asserts a malformed `redRpPmf` throws at write time, so a shape drift fails a test rather than producing a file Phases 6–7 silently misread | closed |
| T-02-15 | Information Disclosure | gitignore coverage for run outputs | medium | mitigate | `.gitignore:9-11` covers `data/*` (with `!data/algorithm-versions/` re-included) and `reports/`; `02-05`'s acceptance criteria assert `git status --porcelain` stays clean after a run writing ~620,000 rows. Confirmed live: working tree clean with `reports/identifiability.json` and `reports/full-v2/` present on disk | closed |
| T-02-16 | Tampering | tune/holdout split integrity | high | mitigate | The plan prohibits changing any hyperparameter, default, threshold, or algorithm variant in response to full-range figures that include the 2025–2026 holdout seasons — a change there would convert the headline claim from out-of-sample to in-sample while it continued to be published as out-of-sample. Enforced by the blocking checkpoint reviewer confirming no constant moved after the run; recorded in `02-06-SUMMARY.md:49` and restated at the point of publication (`:135`). Structurally reinforced by Phase 1's T-01-14 (`headlineEligible` derived from season label, never operator-set, `score.ts:152`) | closed |
| T-02-SC | Tampering | npm/pnpm installs | low | accept | No new external packages were introduced in any of this phase's six plans (`02-RESEARCH.md` § Package Legitimacy Audit: not applicable). Every dependency used — `ml-matrix`, `zod`, `better-sqlite3`, `vitest` — was audited under Phase 1's T-01-SC blocking checkpoint. The Kalman recursion, erf approximation, and covariance update are hand-written precisely because no mature TypeScript library exists at this scale. Accepted because the attack surface is unchanged from an already-audited state — see Accepted Risks | closed |

*Status: open · closed · closed — with caveat · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (high) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

### Register hygiene notes

- **`T-02-02` was assigned twice.** `02-01-PLAN.md` uses it for Tampering / `replay.ts` `OUTCOME_KEYS`; `02-05-PLAN.md` and `02-06-PLAN.md` reuse it for Information Disclosure / the new writers. Both are recorded above, the second as `T-02-02b`, so neither is lost to the collision. Future phases should allocate threat IDs from a phase-level register rather than per-plan.
- **`T-02-03` was never assigned.** No plan in this phase uses the identifier; it is a numbering gap, not a dropped threat.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-SC | No new packages were added in any of the phase's six plans, so the dependency attack surface is byte-identical to the state Phase 1's blocking Package Legitimacy Audit already cleared. Re-running a slopcheck against an unchanged manifest would produce no new information. The disposition flips back to `mitigate` the moment any task adds a package | Jacob Williams (plan-time disposition, all six plans) | 2026-08-13 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-19 | 17 | 17 | 0 | gsd-secure-phase (orchestrator, ASVS L1 grep-depth) |

**2026-08-19 — initial audit (State B: reconstructed from artifacts).**
No SECURITY.md existed for this phase; the register was rebuilt from the six PLAN
`<threat_model>` blocks and cross-checked against the SUMMARY threat discussion.
All 16 plan-declared threats (17 register rows after splitting the `T-02-02`
collision) verified closed against the implementation. Two rows carry caveats —
T-02-04's structural-not-tested prototype guard and T-02-07's missing grep-enforcement
test — both below the `high` block threshold and both backed by a stronger adjacent
control. Two threats (T-02-08, and T-02-01's second gate) were closed during execution
as Rule 2 threat-model-mandated deviations, meaning the register caught two real
implementation gaps before they shipped.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-19
