---
phase: 3
slug: tuning-ranking-points-versioning
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-08-18
updated: 2026-08-19
---

# Phase 3 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Register origin: **authored at plan time** — all 8 plans (03-01 … 03-08) carry a parseable
`<threat_model>` block. Verification was therefore mitigation-verification, not retroactive STRIDE.

Scope note carried forward from plans 03-07/03-08: this phase is an **offline pipeline** — no
network-facing surface, no authentication, no user input, and one secret (`TBA_API_KEY`) that is
read only by the ingest path and explicitly refused at the version-file write boundary. The threats
that genuinely apply are integrity-of-record and availability-of-pipeline threats, not a
transplanted web-application register.

> **ID collision, recorded rather than silently renumbered:** `T-03-18` was assigned twice by two
> different plans — 03-06 used it for a CI-permissions threat, 03-07 for the CR-01 harness crash.
> They are disambiguated below as **T-03-18a** and **T-03-18b**. The plan files are left unedited;
> this note is the reconciliation.

> **Register extended after the first audit.** T-03-18b was left open by the 2026-08-18 audit and
> remediated by quick task `260818-inm` (commits `7983c458`, `11a382d4`, `dd39ba28`, `4b41f86d`).
> That remediation authored its own `<threat_model>` covering the new attack surface it introduced —
> **T-03-26 / T-03-27 / T-03-28** (`260818-inm-PLAN.md:377-385`). They are folded into the register
> below, bringing the total from 26 to 29. All three were verified closed in the second audit.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| TBA `score_breakdown_raw` → RP rule `parse` | Verbatim third-party JSON, stored unmodified in the corpus, parsed into values that drive a published prediction | Untrusted third-party JSON |
| TBA `score_breakdown_raw` → SCORE-side `parseBreakdown` | The same untrusted payload on the score path; **self-reported** for offseason events, so systematically shape-variable | Untrusted third-party JSON |
| corpus `event_type` (third-party TBA enum) → RP tier dispatch | An out-of-range enum crosses into code documented to throw on it | Untrusted enum |
| `data/corpus.sqlite` → replay / search / measurement | Read-only handle (T-01-13); a write attempted through it fails at the SQLite layer | Third-party-derived data |
| Holdout seasons (2025/2026) → the optimizer | The boundary the project's entire honesty claim rests on; crossing it invisibly invalidates every headline number | Evaluation data |
| `reports/tune-*.json` → `promote.ts` → `data/algorithm-versions/*.json` | A regenerable, gitignored search log becomes a git-committed published claim | Provenance / version identity |
| `Prediction` → `predictions-{season}.jsonl` | In-memory prediction becomes durable data Phases 6–8 render | Published distributions |
| `reports/tuned-v3/artifact.json` → `docs/models/*.md` | A generated, gitignored artifact becomes a committed published claim | Published figures |
| human-reported manual text → shipped threshold constant + citation | An unverifiable spoken claim becomes code and a durable provenance record | Human judgment |
| Repository → GitHub Actions runner | CI executes repository code on a hosted runner | Build execution |
| skipped-breakdown count → cross-season carry (`carrySeason`) | A per-season availability metric crosses a season boundary and must not silently reset | Audit-trail integrity |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Denial of Service | RP `parse` over malformed `score_breakdown_raw` | medium | mitigate | Per-season Zod schemas declare only fields read, `z.number().finite()` / `z.boolean()`; reconciliation reports per-`event_type`/per-bonus (`reconciliation.test.ts:215-259`). Re-verified after remediation: `.finite()` counts unchanged (6/9/13/7/11 for 2022–2026), zero `.optional()` added. *Narrower than declared — see Findings F-2* | closed |
| T-03-02 | Tampering | non-finite threshold variable reaching `foldRpObservation` / Cholesky | medium | mitigate | `assertFiniteThresholdVariables` at `rp/2022.ts:91`, `2023.ts:83`, `2024.ts:135`, `2025.ts:142`, `2026.ts:94` **and** at the fold itself `rp/state.ts:239`; ridge escalation throws naming the match key `rp/distribution.ts:272-274` | closed |
| T-03-03 | Tampering | prototype pollution via a `__proto__` key in raw TBA JSON | medium | mitigate | 4× `Object.create(null)` per season module with literal named assignment (e.g. `rp/2025.ts:136-171`); audit for third-party spread across all 5 modules returned **zero**. Re-verified present in all 5 season modules after remediation | closed |
| T-03-04 | Information Disclosure | `promote.ts` version-file write | low | mitigate | Serialize (`promote.ts:309-310`), then refuse before `writeFileSync` (`:323`) if `TBA_API_KEY` is set and its value appears in the output (`:316-319`) | closed |
| T-03-05 | Tampering | committed digest in `data/algorithm-versions/*.json` | medium | mitigate | `digest.test.ts:150-151` recomputes from code + committed params and asserts; prohibition forbids regenerating as a fix. **Executed in both audits: 3 passed, 0 skipped** | closed |
| T-03-06 | Denial of Service | unbounded adaptation factor destabilizing the filter | low | mitigate | `adaptation.ts:139` clamp; exactly `1` below `adaptationMinObservations` (`:135`); defaults 0.25/4.0 (`params.ts:195-196`); exact-equality assertions at both bounds `adaptation.test.ts:63-72` | closed |
| T-03-07 | Tampering | optimizer reading or selecting on holdout-season data | **high** | mitigate | Gates 1+2 `tune.ts:120-141` invoked at **all three** stage entries (`:372`, `:448`, `:754`), each *before* `openCorpusReadOnly`; gate 3 `assertNoHoldoutLeak` `:144-152` at `:296`; `tune.test.ts:119-131` covers both throw directions **plus a negative control**; `boundedSeasonStream:161` hardcodes `includeOffseason:false`. *Nuance — see Findings F-1* | closed |
| T-03-08 | Tampering | `Sigma1ParamsSchema` parse of a committed parameter file | medium | mitigate | `params.ts:209` `z.strictObject`, 23× `z.number().finite()` | closed |
| T-03-09 | Tampering | a wrong tier threshold mispredicting DCMP-and-above matches | medium | mitigate | Thresholds are DATA keyed by tier; `eventTierFor` throws for an unmapped `event_type` with no default (`rp/constants.ts:71-79`); mismatches grouped by `event_type` (`reconciliation.test.ts:224,275`). Re-verified still throwing after remediation | closed |
| T-03-10 | Tampering | a malformed pmf persisted as a published distribution | medium | mitigate | `predictions.ts:86-93` `.refine()` + `isValidPmf:54-59`, enforced on write at `:128` `.parse()` | closed |
| T-03-11 | Spoofing | an algorithm module presenting a version identity it does not have | low | mitigate | `artifact.ts:126-141` `splitAlgorithmVersion` throws on a missing `+` and on an empty half; called at `:161` | closed |
| T-03-12 | Tampering | a non-finite normalized innovation poisoning a team's factor | medium | mitigate | `adaptation.ts:94-98` throws, never coerces. *Minor deviation: the message omits the team key the plan specified — cosmetic; refusal behavior intact* | closed |
| T-03-13 | Repudiation | a negative adaptation result quietly reversed, leaving no record the first design lost | medium | mitigate | The losing result is recorded, not reversed: `sigma1-tuning-results.md:188,216` (adaptation-on wins holdout Brier) against `:84` (adaptation-off still ships); mechanism/comparison/verdict split across plans 03-04/05/06; `docs/models/` git history is the audit trail | closed |
| T-03-14 | Repudiation | a promoted version whose provenance cannot identify which search produced it | medium | mitigate | `promote.ts:35-63` `ProvenanceSchema` + `.parse()` before write (`:309`); headline file carries all 11 provenance fields. *Guarantee rests on the writer, not the schema — see Findings F-3* | closed |
| T-03-15 | Tampering | a search log hand-edited between the search and the promotion | medium | mitigate | `promote.ts:207,289` records `searchArtifactSha256`; present in `sigma1@2.0.0+tuned-2026-08.json`; independent metric re-run `digest.test.ts:170-173` | closed |
| T-03-16 | Tampering | a head-to-head table spliced from different runs, corpora, or versions | medium | mitigate | Every figure from ONE artifact with the command quoted verbatim: `sigma1-tuning-results.md:10,13,344`, `runTimestamp: 2026-08-17T01:11:06.668Z` | closed |
| T-03-17 | Tampering | a stale committed fixture certifying a slice that no longer matches the corpus | medium | mitigate | `digest.test.ts:177-178` `toEqual` between corpus-derived and fixture match lists. **Executed in both audits against the live corpus: passed** | closed |
| T-03-18a | Elevation of Privilege | CI workflow permission / secret scope | low | mitigate | `test.yml:19-20` `permissions: contents: read`; zero `secrets.` references; `deploy.yml:38` `FIRST_API_KEY` is commented out and deliberately not propagated | closed |
| **T-03-18b** | Denial of Service | `sigma1/index.ts` `update()` / `predict()` — untrusted breakdown data aborting the harness run | **high** | mitigate | **Closed 2026-08-18 (second audit).** RP-guard half unchanged (`rp/constants.ts:103-105`; `index.ts:695`, `:839`; `sigma1.test.ts:719-819`). Upstream half remediated by `tryParseBreakdownPair` (`breakdown/index.ts:134-146`) applied at `sigma1/index.ts:740` and `epa.ts:443`. **Both re-close commands executed to exit 0**; corpus-wide probe shows exact 1:1 guarded/unguarded correspondence. See Closure Record | closed |
| T-03-19 | Tampering | the guard silently perturbing a committed prediction-stream digest, voiding SC-5 | **high** | mitigate | Verified **independently of the SUMMARY** in audit 1 (corpus query: `2022alhu`/`2022azfl`/`2022azva` all `event_type=0, is_offseason=0`; guard structurally inert). **Re-verified in audit 2 against the post-remediation tree**: `digest.test.ts` executed — 3 passed, both `predictionStreamSha256` reproduce bitwise; `data/algorithm-versions/` and `packages/harness/fixtures/` untouched by all 4 remediation commits. SC-5 intact | closed |
| T-03-20 | Tampering | `JSON.parse(result.scoreBreakdownRaw!)` reaching the RP fold | medium | mitigate | `JSON.parse` moved `:842` → `sigma1/index.ts:857` by the remediation but remains inside the `else` of the eligibility guard (`:854`); the result still flows to `ruleModule.parse` (Zod) then into `Object.create(null)` records. `usedFallback` now also covers the `malformed` outcome, so the fold is reached **only** when the same string already parsed — **strengthened, not weakened** | closed |
| T-03-21 | Spoofing | a guard broad enough to swallow unrelated exceptions, masking a rule defect as a skip | medium | mitigate | RP side: `rp/constants.ts:103-105` is a pure positive membership test, **not** `try`/`catch`; `eventTierFor` still throws (`:74`); positive control `sigma1.test.ts:781-818` over `[0,1,2,3,4,5,100]`. Breakdown side (new): `isRecoverableBreakdownParseError` (`breakdown/index.ts:93-95`) matches `ZodError` or `SyntaxError` **only**; `componentMapForSeason` resolved at `:136` **outside** the `try`; `assertFiniteComponents` called outside the guard (`sigma1/index.ts:786-787`, `epa.ts:476-477`) and still throws; negative controls `breakdown.test.ts:199-206`; single `zod@4.4.3` resolution rules out a dual-instance `instanceof` hazard | closed |
| T-03-22 | Repudiation | a "confirmed against the official manual" claim recorded without a human having read it | **high** | mitigate | `A1-confirmed` dated 2026-08-18 citing named sections (2025 §6.5.4 Tbl 6-2; 2026 §6.5.3 Tbl 6-4/6-5) at `03-08-SUMMARY.md:43,133`; `## Threshold Provenance` table `sigma1-rp-verification.md:35-65`; independent grep found no stale "pending manual check" comment in `rp/`. *Inherent limit: whether a human truly read the manual is unverifiable by code — every auditable control around it is present, and `03-08-SUMMARY.md:79-80` flags `human_judgment: true` honestly* | closed |
| T-03-23 | Tampering | a threshold correction stranding a stale figure or moving a committed digest | medium | mitigate | Slices are 2022 events; 03-08 changed only `rp/2025.ts`/`2026.ts`; `digest.test.ts` executed on the post-03-08 tree and again on the post-remediation tree — both `predictionStreamSha256` reproduce | closed |
| T-03-24 | Tampering | a measured shortfall absorbed by widening a reconciliation tolerance | medium | mitigate | `git diff a12fe496..f1f9f763` on `reconciliation.test.ts`: `ensembleBonus` 0.1→**0.085**, `coralBonus` 0.05→**0.005**. Both tightened; **no rate increased**. Audit 2 confirms the file was untouched by the remediation — no late loosening | closed |
| T-03-25 | Tampering | `JSON.parse` of corpus text in the new measurement script | low | mitigate | `rpConservativeBranch.ts:54` uses `openCorpusReadOnly` (`corpus/db.ts:96` `readonly:true, fileMustExist:true`); writes no algorithm state; output confined to gitignored `reports/` (`.gitignore:11`) | closed |
| T-03-26 | Repudiation | skipped-breakdown count silently resetting across a season boundary, erasing the audit trail | **high** | mitigate | **Empirically proven across a real season boundary**: multi-season run reported 942 after 2022 and **1981** after 2023 (942+1039, matching the per-season probe) — `carrySeason` (`sigma1/index.ts:1055`) demonstrably does not reset. OPR correctly omits the field rather than fabricating a `0` | closed |
| T-03-27 | Information Disclosure | guard telemetry leaking raw third-party payload content into logs | low | mitigate | `breakdown/index.ts:144` carries only `issueCount` — no field names, no values, no payload fragment; `cli.ts:311` prints algorithm id + count only (was `:310-312`; re-verified 2026-08-19) | closed |
| T-03-28 | Tampering | an over-broad guard skipping matches that should have parsed (silent under-counting of real data) | **high** | mitigate | Positive controls in `sigma1.test.ts` (counter 0 **and** `rpSkippedMatchCount` 0 **and** `foulsCommitted` present) and `epa.test.ts:475+`; corroborated at corpus scale — **84,318 official 2022–2026 matches → 0 malformed**, and both committed prediction-stream digests reproduce bitwise | closed |
| T-03-SC | Tampering | npm/pip/cargo installs (supply chain) | **high** | **accept** | See Accepted Risks Log **AR-03-01**. Hard proof: `pnpm-lock.yaml` last touched at `fa9d0455` (phase **01**-01) — re-confirmed unchanged in audit 2 after the remediation commits; both phase-03 `package.json` commits add only npm *scripts*. CI runs `pnpm install --frozen-lockfile` | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (high) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Closure Record — T-03-18b

**Severity:** high · **Disposition:** mitigate · **Opened:** audit 1, 2026-08-18 · **Closed:** audit 2, 2026-08-18

### What was open

T-03-18b's declared mitigation had two clauses. Clause 1 — the RP-side guard — verified closed in
audit 1. Clause 2 — *"Task 2 re-runs both documented invocations that reached it"* — was **unmet**,
self-recorded `status: fail` (`03-07-SUMMARY.md` coverage D5) and logged as `WINDOWS.md` #4 and #5.
The defect sat ~100 lines *upstream* of the fix: `parseBreakdown` at `sigma1/index.ts:735-736` threw
uncaught, and `replay.ts:117-119`/`:161-163` (now `:154`/`:198`) plus `epa.ts:432-433` had no `try`/`catch`, so a single
throw aborted the entire batch across every season and algorithm.

### How it was closed

Quick task `260818-inm` implemented the remediation audit 1 recommended, following the
`identifiability.ts:239-249` precedent but **narrower** than it:

- `tryParseBreakdownPair` (`breakdown/index.ts:134-146`) returns a discriminated union; a Zod or
  JSON failure degrades to the **existing, already-tested** `usedFallback` path
  (`FALLBACK_NOISE_MULTIPLIER`) and increments a **counted** skip — never a silent drop.
- Applied at both formerly-unguarded sites: `sigma1/index.ts:740` and `epa.ts:443`. Grep confirms
  **zero** remaining unguarded `parseBreakdown` in the live replay path.
- `replay.ts:117-119`/`:161-163` — now `:154`/`:198` — correctly left **unwrapped** — wrapping `update()` wholesale would
  have been exactly the broad-catch antipattern T-03-21 forbids.
- `predict()` is structurally immune: `replay.ts:24` `toLeakProofUpcoming` strips
  `scoreBreakdownRaw` from `UpcomingMatch`, so it can never receive a raw breakdown at all.

### Verification — executed, not inferred

Audit 2 closed this on execution and direct corpus probing, **not** on the commit messages, the
quick-task artifacts, or the `WINDOWS.md` `fixed` annotations — all of which are self-reports by the
same work under audit.

**Both re-close commands run by the auditor:**

| Ledger | Command | Result |
|---|---|---|
| #4 | `pnpm harness --season 2024 --algorithm sigma1 --include-offseason` | **exit 0**, `Breakdown parse failures [sigma1]: 1004` |
| #5 | `pnpm harness --event 2024wvrox --algorithm sigma1` | **exit 0**, count `19`; network live (`304 Not Modified` on both TBA calls), `TBA_API_KEY` present — no inference required |

**Independent corpus re-measurement** (read-only probe running unguarded `parseBreakdown` against
guarded `tryParseBreakdownPair` over the same rows):

| Population | matches w/ breakdown | unguarded throws | guarded `malformed` | guarded throws |
|---|---|---|---|---|
| official 2022–2026 | 84,318 | **0** | **0** | **0** |
| offseason 2022–2026 | 18,372 | 4,398 | **4,398** | **0** |

Exact 1:1 in every cell — the guard neither under-catches nor over-skips. Audit 1's figures
reproduce exactly: 2024 offseason **1,004 / 4,757 = 21.1%**; `2024wvrox_sf1m1` unguarded threw a
`ZodError` with **20** issues → guarded `malformed issueCount=20`; `2024cafb_qm1` threw **2** →
`issueCount=2`.

**The rejected alternative was not taken.** Zero `.optional()` in any breakdown schema; all five
season modules last touched at `776c0266` (phase 02). The T-03-01/T-03-20 integrity controls were
not traded away to buy availability.

**The counter is genuinely surfaced, not a dead field.** `types.ts:149` (was `:146`) → both algorithm states
(`sigma1` init `:186`, update `:759`, returned `:913`, `carrySeason` `:1055`; `epa` `:225`/`:458`/
`:504`/`:587`) → `breakdownParseFailureCountOf` (`types.ts:160`, was `:157`) → `cli.ts:303-313`, called from
**both** modes `main()` dispatches (`cli.ts:481` runSeason, `:696` runEventMode). Observed live at
1004, 19, and 942→1981 across a season boundary.

**Full suite: 36 files / 484 tests pass.** Working tree clean throughout; no implementation file was
modified by either audit.

### Ledger

`WINDOWS.md` #4 and #5 `fixed` claims **independently confirmed**, not accepted. The diff shows no
quiet waiver or description edit — both descriptions preserved verbatim. (Entry #3's stale
`"resolved"` → `"fixed"` is an enum normalization only. #1 and #2 remain genuinely open — phase
01/02 Statbotics, unrelated to phase 3.)

---

## Findings — mitigations narrower than declared

Non-blocking, recorded so a future audit does not have to rediscover them.

**F-1 · T-03-07 — gates 1 and 2 share a data source.** The two gates are independent *code paths*,
but `seasonSplit` (`score.ts:26`) itself reads `HOLDOUT_SEASONS`. The plan's claim that "a bug in
either cannot silently disable the other" holds for logic bugs, not for corruption of that constant.
Gate 3 (`assertNoHoldoutLeak`, post-scoring) is the genuinely independent backstop. Threat remains
closed — this narrows the argument, not the protection.

**F-2 · T-03-01 — no failure counter in the test, and the test is blind to the failing population.
Still open; now compensated, not closed.** The plan says the reconciliation test *counts* parse
failures. There is no counter: `module.parse` (`reconciliation.test.ts:222`) is uncaught, so a
failure aborts the test. The no-silent-skip property therefore holds (loudly), but
`sampleQualMatches` (`reconciliation.test.ts:55`, documented `:36`) filters `e.is_offseason = 0`,
leaving the test structurally blind to exactly the population that broke the harness. **This
blindness is why T-03-18b's 21% failure rate went unmeasured until audit 1.** The remediation did
not touch this file, so the blind spot **remains**. It is now *compensated* by three things — the
new synthetic regression suites derived from the real `2024cafb_qm1`/`2024wvrox_sf1m1` shapes,
`breakdownParseFailureCount` making the population observable at runtime, and audit 2's corpus-wide
probe. **Recommended follow-up:** add an offseason-inclusive reconciliation slice.

**F-3 · T-03-14 — provenance completeness rests on the writer, not the schema.** The plan says
`PromotedVersionSchema` *requires* the full provenance block. In fact 8 of 11 fields are `.optional()`
(`promote.ts:52-63`), deliberately, so the legacy `tracer-check` file keeps validating. The guarantee
currently depends on `promote.ts` unconditionally populating them; a future promotion path could omit
`seed`/`searchArtifactSha256` and still parse.

**F-4 · Integrity controls extend past the RP boundary; availability controls did not.**
`breakdown/2024.ts:84-87` has the same `Object.create(null)` + fixed allowlist loop over
`OWN_FIELD_COMPONENT_MAP` as the `breakdown/2026.ts:103` precedent 03-02 copied, with the identical
`T-02-04` comment, and all 13 fields are `z.number().finite()` — **2024.ts is not weaker than its
precedent.** T-03-03/T-03-20's prototype-pollution and non-finite controls are uniform across both
trees. Audit 1 recorded the split as clean: confidentiality/integrity uniform, availability RP-only.
**The remediation closed that asymmetry** — availability controls now extend to the score path too,
via `tryParseBreakdownPair` at `sigma1/index.ts:740` and `epa.ts:443`.

**F-5 (new, audit 2) · the failure population is corpus-wide, larger than the ledger's framing.**
`WINDOWS.md` #4/#5 describe the defect in 2024 terms. The true population is **4,398** offseason
matches across 2022–2026 — 2022: 942, 2023: 1039, 2024: 1004, 2025: 1317, 2026: 96. All are now
guarded and counted. Recorded so the scale is on file and no future reader under-estimates it from
the ledger alone.

**F-6 (new, audit 2) · `identifiability.ts:239-249` remains broader than the new guard.** Its bare
`catch` would swallow an unregistered-season `Error` or an `assertFiniteComponents` failure as a
counted skip, where `isRecoverableBreakdownParseError` would not. Pre-existing, confined to a
diagnostic-only reporting script (**not** the prediction path), and explicitly acknowledged in the
new code's own doc comment. Not a phase-03 regression. **Recommended follow-up:** narrow it to reuse
`isRecoverableBreakdownParseError`.

**F-7 (new, audit 3) · phase-3 code changed after audit 2; re-verified, no regression.** Three
files cited by this register were modified between audit 2 and audit 3:

| File | Commit | Change | Effect on this register |
|---|---|---|---|
| `harness/cli.ts` | `67d71db3` (phase-03 Nyquist) | `function`/`const` → `export` on 4 declarations | None — no behavior change, no line-count change; T-03-26/27/28 citations hold |
| `core/algorithms/types.ts` | `e70b31df` (quick `260819-2x6`) | doc comment only | Control intact; citations shifted +3 and were corrected above |
| `harness/replay.ts` | `f77757d8`, `e70b31df` (quick `260819-2x6`) | added `getOwnPropertyDescriptor` + `ownKeys` Proxy traps | **Strengthens** T-03-18b's "`predict()` is structurally immune" clause; `scoreBreakdownRaw` remains in `OUTCOME_KEYS` |

Re-verified by execution, not by reading the commits: `digest.test.ts` **3 passed / 0 skipped** on the
post-2x6 tree (T-03-05/17/19/23 — both committed `predictionStreamSha256` still reproduce bitwise),
`tryParseBreakdownPair` still applied at `sigma1/index.ts:740` and `epa.ts:443` unchanged,
`replay.ts` still contains **zero** `try`/`catch` (T-03-21's no-broad-catch property), and the full
suite passes at **37 files / 531 tests** (grown from 36/484 by the new 2x6 and Nyquist tests).

**F-8 (new, audit 3) · quick task `260819-2x6`'s own threat register has no home in any phase
SECURITY.md — not a phase-3 threat, recorded so it is not lost.** That task authored a
`<threat_model>` of six threats, **T-Q2x6-01 … T-Q2x6-06**, one of them **high** severity
(`260819-2x6-PLAN.md`). It remediates EVAL-01 / SC-4, a **phase-1** success criterion, and its code
lives in `packages/harness` — so those threats belong to phase 1's register, not this one. Phase 1's
`01-SECURITY.md` was authored at `b40db5dd` (2026-08-19 03:11), *after* the 2x6 commits (~02:29), yet
records none of them; its T-01-13 row still carries the pre-2x6 caveat about `toLeakProofUpcoming`
lacking traps. **This does not affect `threats_open` for phase 3.** Recommended follow-up: re-run
`/gsd-secure-phase 1` so the T-Q2x6 register is verified and folded into phase 1.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-03-SC | No package installs occur anywhere in phase 3. `03-RESEARCH.md:112-118`'s Package Legitimacy Audit records zero packages recommended for installation — every candidate was nonexistent, unpublished, a name collision (`cma-es`, `optuna`, `bayesian-optimization`, `hpjs`), or judged not worth the trust surface; the hyperparameter search is hand-rolled over existing primitives instead. Verified by audit: `pnpm-lock.yaml` was last modified at `fa9d0455` (phase **01**-01) — re-confirmed unchanged in audit 2 after the four remediation commits — and both phase-03 `package.json` commits add only npm *scripts* (`tune`, `promote`, `rp:conservative-branch`). CI runs `pnpm install --frozen-lockfile`. **Accepted because the attack surface is empty, not because the check was skipped.** | Jacob Williams | 2026-08-18 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-18 | 26 | 25 | 1 | gsd-security-auditor (opus) via /gsd-secure-phase 3 |
| 2026-08-18 | 29 | 29 | 0 | gsd-security-auditor (opus) via /gsd-secure-phase 3 — re-audit after `260818-inm` remediation |
| 2026-08-19 | 29 | 29 | 0 | orchestrator (opus) via /gsd-secure-phase 3 — regression re-verification after post-audit commits |

### Security Audit 2026-08-19 (regression re-verification)

| Metric | Count |
|--------|-------|
| Threats found | 29 |
| Closed | 29 |
| Open | 0 |

**Why a third pass.** Audit 2 closed the register at 29/29 on 2026-08-18. Six commits landed
afterwards, three of which touched files this register cites by name — so "still 0 open" could not
be inherited from audit 2 and was re-established rather than assumed. Full detail in **F-7**.

**Depth.** ASVS L1, `block_on: high`, register authored at plan time — the workflow's short-circuit
(`threats_open: 0` + plan-time register + L1) applies, so no auditor subagent was spawned. Even so
this pass exceeded grep depth on the changed surface: `digest.test.ts` and the **full 531-test
suite** were executed on the live post-2x6 tree, and every control cited for T-03-18b / T-03-21 /
T-03-26 / T-03-27 was re-located in source. Working tree clean throughout; no implementation file was
modified by this audit.

**Carried forward unchanged.** F-2 (offseason-blind reconciliation slice) and F-6
(`identifiability.ts:241-242` bare catch — re-confirmed still present, still diagnostic-only)
remain open non-blocking follow-ups. F-8 is new and is a **phase-1** action, not a phase-3 one.

### Security Audit 2026-08-18 (re-audit)

| Metric | Count |
|--------|-------|
| Threats found | 29 |
| Closed | 29 |
| Open | 0 |

**Audit depth.** ASVS L1 (`block_on: high`). The register was authored at plan time, so both audits
were mitigation-verification, not retroactive STRIDE. Both exceeded grep depth on the high-severity
threats.

Audit 1: `digest.test.ts` **executed** against the live corpus (T-03-05/17/19/23), the corpus
**queried directly** to establish event types and the T-03-18b failure population, and
`git log`/`git diff` used to prove the lockfile and tolerance histories (T-03-SC, T-03-24) rather
than relying on the SUMMARY files' own account.

Audit 2: both `WINDOWS.md` re-close commands **executed to exit 0** (including the networked event
run, with live TBA `304`s), a corpus-wide **read-only probe** run over all five seasons comparing
guarded against unguarded parse outcomes (102,690 matches carrying a breakdown), `digest.test.ts`
**re-executed** on the post-remediation tree, and the **full 484-test suite** run. The three threats
the remediation itself introduced (T-03-26/27/28) were verified by execution — T-03-26 specifically
by observing the counter carry 942 → 1981 across a real season boundary — rather than accepted from
the quick task's own threat model.

**Reporting caveat (carried from the auditor verbatim).** A supplementary
`--seasons 2022-2026 --algorithm opr,epa,sigma1 --include-offseason` replay was **killed mid-2024 by
the background harness — not failed**. 2022 and 2023 completed cleanly for all three algorithms.
That run was extra assurance beyond the declared re-close condition; both required commands (#4, #5)
passed outright, and the corpus-wide probe covers all five seasons independently.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed — 29/29 closed, no blocking threats remain
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-08-19 — register re-confirmed at 29/29 closed after the post-audit-2
commits (F-7). T-03-18b remains closed by execution. F-2 and F-6 carried forward as non-blocking
phase-3 follow-ups; F-8 raised as a **phase-1** action (`/gsd-secure-phase 1`).
