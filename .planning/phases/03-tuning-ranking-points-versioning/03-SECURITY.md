---
phase: 3
slug: tuning-ranking-points-versioning
status: blocked
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 1
asvs_level: 1
created: 2026-08-18
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

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-03-01 | Denial of Service | RP `parse` over malformed `score_breakdown_raw` | medium | mitigate | Per-season Zod schemas declare only fields read, `z.number().finite()` / `z.boolean()`; reconciliation reports per-`event_type`/per-bonus (`reconciliation.test.ts:215-259`). *Narrower than declared — see Findings F-2* | closed |
| T-03-02 | Tampering | non-finite threshold variable reaching `foldRpObservation` / Cholesky | medium | mitigate | `assertFiniteThresholdVariables` at `rp/2022.ts:91`, `2023.ts:83`, `2024.ts:135`, `2025.ts:142`, `2026.ts:94` **and** at the fold itself `rp/state.ts:239`; ridge escalation throws naming the match key `rp/distribution.ts:272-274` | closed |
| T-03-03 | Tampering | prototype pollution via a `__proto__` key in raw TBA JSON | medium | mitigate | 4× `Object.create(null)` per season module with literal named assignment (e.g. `rp/2025.ts:136-171`); audit for third-party spread across all 5 modules returned **zero** | closed |
| T-03-04 | Information Disclosure | `promote.ts` version-file write | low | mitigate | Serialize (`promote.ts:309-310`), then refuse before `writeFileSync` (`:323`) if `TBA_API_KEY` is set and its value appears in the output (`:316-319`) | closed |
| T-03-05 | Tampering | committed digest in `data/algorithm-versions/*.json` | medium | mitigate | `digest.test.ts:150-151` recomputes from code + committed params and asserts; prohibition forbids regenerating as a fix. **Executed during audit: 3 passed, 0 skipped** | closed |
| T-03-06 | Denial of Service | unbounded adaptation factor destabilizing the filter | low | mitigate | `adaptation.ts:139` clamp; exactly `1` below `adaptationMinObservations` (`:135`); defaults 0.25/4.0 (`params.ts:195-196`); exact-equality assertions at both bounds `adaptation.test.ts:63-72` | closed |
| T-03-07 | Tampering | optimizer reading or selecting on holdout-season data | **high** | mitigate | Gates 1+2 `tune.ts:120-141` invoked at **all three** stage entries (`:372`, `:448`, `:754`), each *before* `openCorpusReadOnly`; gate 3 `assertNoHoldoutLeak` `:144-152` at `:296`; `tune.test.ts:119-131` covers both throw directions **plus a negative control**; `boundedSeasonStream:161` hardcodes `includeOffseason:false`. *Nuance — see Findings F-1* | closed |
| T-03-08 | Tampering | `Sigma1ParamsSchema` parse of a committed parameter file | medium | mitigate | `params.ts:209` `z.strictObject`, 23× `z.number().finite()` | closed |
| T-03-09 | Tampering | a wrong tier threshold mispredicting DCMP-and-above matches | medium | mitigate | Thresholds are DATA keyed by tier; `eventTierFor` throws for an unmapped `event_type` with no default (`rp/constants.ts:71-79`); mismatches grouped by `event_type` (`reconciliation.test.ts:224,275`) | closed |
| T-03-10 | Tampering | a malformed pmf persisted as a published distribution | medium | mitigate | `predictions.ts:86-93` `.refine()` + `isValidPmf:54-59`, enforced on write at `:128` `.parse()` | closed |
| T-03-11 | Spoofing | an algorithm module presenting a version identity it does not have | low | mitigate | `artifact.ts:126-141` `splitAlgorithmVersion` throws on a missing `+` and on an empty half; called at `:161` | closed |
| T-03-12 | Tampering | a non-finite normalized innovation poisoning a team's factor | medium | mitigate | `adaptation.ts:94-98` throws, never coerces. *Minor deviation: the message omits the team key the plan specified — cosmetic; refusal behavior intact* | closed |
| T-03-13 | Repudiation | a negative adaptation result quietly reversed, leaving no record the first design lost | medium | mitigate | The losing result is recorded, not reversed: `sigma1-tuning-results.md:188,216` (adaptation-on wins holdout Brier) against `:84` (adaptation-off still ships); mechanism/comparison/verdict split across plans 03-04/05/06; `docs/models/` git history is the audit trail | closed |
| T-03-14 | Repudiation | a promoted version whose provenance cannot identify which search produced it | medium | mitigate | `promote.ts:35-63` `ProvenanceSchema` + `.parse()` before write (`:309`); headline file carries all 11 provenance fields. *Guarantee rests on the writer, not the schema — see Findings F-3* | closed |
| T-03-15 | Tampering | a search log hand-edited between the search and the promotion | medium | mitigate | `promote.ts:207,289` records `searchArtifactSha256`; present in `sigma1@2.0.0+tuned-2026-08.json`; independent metric re-run `digest.test.ts:170-173` | closed |
| T-03-16 | Tampering | a head-to-head table spliced from different runs, corpora, or versions | medium | mitigate | Every figure from ONE artifact with the command quoted verbatim: `sigma1-tuning-results.md:10,13,344`, `runTimestamp: 2026-08-17T01:11:06.668Z` | closed |
| T-03-17 | Tampering | a stale committed fixture certifying a slice that no longer matches the corpus | medium | mitigate | `digest.test.ts:177-178` `toEqual` between corpus-derived and fixture match lists. **Executed during audit against the live corpus: passed** | closed |
| T-03-18a | Elevation of Privilege | CI workflow permission / secret scope | low | mitigate | `test.yml:19-20` `permissions: contents: read`; zero `secrets.` references; `deploy.yml:38` `FIRST_API_KEY` is commented out and deliberately not propagated | closed |
| **T-03-18b** | **Denial of Service** | **`sigma1/index.ts` `update()` / `predict()` — untrusted breakdown data aborting the harness run** | **high** | **mitigate** | **Guard half complete and proven (`rp/constants.ts:103-105`; `index.ts:695`, `:839`; 4 regression tests `sigma1.test.ts:719-819` incl. positive control). Verification half FAILED — the declared mitigation's clause 2 is unmet and the same abort survives upstream at `parseBreakdown`. See Open Threat Detail** | **open** |
| T-03-19 | Tampering | the guard silently perturbing a committed prediction-stream digest, voiding SC-5 | **high** | mitigate | Verified **independently of the SUMMARY**: corpus query confirms `2022alhu`/`2022azfl`/`2022azva` are all `event_type=0, is_offseason=0`, so the guard is structurally inert; `git log` confirms no 03-07/03-08 commit touched `data/algorithm-versions` or `fixtures` (last was 03-06 `7e4b09f4`); `digest.test.ts` executed — **both digests reproduce bitwise** | closed |
| T-03-20 | Tampering | `JSON.parse(result.scoreBreakdownRaw!)` reaching the RP fold | medium | mitigate | `index.ts:842` `JSON.parse` sits inside the `else` of the eligibility guard; the result flows to `ruleModule.parse` (Zod) and then into `Object.create(null)` records | closed |
| T-03-21 | Spoofing | a guard broad enough to swallow unrelated exceptions, masking a rule defect as a skip | medium | mitigate | `rp/constants.ts:103-105` is a pure positive membership test, **not** `try`/`catch`; `eventTierFor` still throws (`:74`); positive control `sigma1.test.ts:781-818` over `[0,1,2,3,4,5,100]` | closed |
| T-03-22 | Repudiation | a "confirmed against the official manual" claim recorded without a human having read it | **high** | mitigate | `A1-confirmed` dated 2026-08-18 citing named sections (2025 §6.5.4 Tbl 6-2; 2026 §6.5.3 Tbl 6-4/6-5) at `03-08-SUMMARY.md:43,133`; `## Threshold Provenance` table `sigma1-rp-verification.md:35-65`; independent grep found no stale "pending manual check" comment in `rp/`. *Inherent limit: whether a human truly read the manual is unverifiable by code — every auditable control around it is present, and `03-08-SUMMARY.md:79-80` flags `human_judgment: true` honestly* | closed |
| T-03-23 | Tampering | a threshold correction stranding a stale figure or moving a committed digest | medium | mitigate | Slices are 2022 events; 03-08 changed only `rp/2025.ts`/`2026.ts`; `digest.test.ts` executed on the post-03-08 tree — both `predictionStreamSha256` reproduce | closed |
| T-03-24 | Tampering | a measured shortfall absorbed by widening a reconciliation tolerance | medium | mitigate | `git diff a12fe496..f1f9f763` on `reconciliation.test.ts`: `ensembleBonus` 0.1→**0.085**, `coralBonus` 0.05→**0.005**. Both tightened; **no rate increased** | closed |
| T-03-25 | Tampering | `JSON.parse` of corpus text in the new measurement script | low | mitigate | `rpConservativeBranch.ts:54` uses `openCorpusReadOnly` (`corpus/db.ts:96` `readonly:true, fileMustExist:true`); writes no algorithm state; output confined to gitignored `reports/` (`.gitignore:11`) | closed |
| T-03-SC | Tampering | npm/pip/cargo installs (supply chain) | **high** | **accept** | See Accepted Risks Log **AR-03-01**. Hard proof: `pnpm-lock.yaml` last touched at `fa9d0455` (phase **01**-01); both phase-03 `package.json` commits add only npm *scripts*. CI runs `pnpm install --frozen-lockfile` | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above `workflow.security_block_on` (high) count toward `threats_open`*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Open Threat Detail — T-03-18b

**Severity:** high · **Disposition:** mitigate · **Counts toward `threats_open`** (high ≥ `block_on: high`)

### What is closed

The guard half is real and fully verified. `isRpEligibleEventType` (`rp/constants.ts:103-105`) is
`EVENT_TYPE_TIERS[eventType] !== undefined` — a pure positive membership test over the *same* table
`eventTierFor` throws on, so the predicate and the thrower cannot drift apart. It is applied at both
call sites (`index.ts:695` in `predict`, `:839` in `update`). The skip path returns
`{ redPmf: [], bluePmf: [] }`, which the spreads at `:722-723` turn into **omitted** fields rather
than a degenerate `P(RP=0)=1` claim of false certainty. All four CR-01 regression tests exist
(`sigma1.test.ts:719-819`), including a positive control proving all seven mapped event types still
take the full RP path. `eventTierFor` is unweakened. **Plan 03-07 delivered what it promised.**

### What is open

T-03-18b's declared mitigation had two clauses. Clause 2 — *"Task 2 re-runs both documented
invocations that reached it"* — is **unmet**, recorded by the executor itself as `status: fail`
(`03-07-SUMMARY.md` coverage D5) and logged as `WINDOWS.md` ledger **#4** and **#5**, both `status: open`.

Direct corpus probing during this audit found the residual is materially larger than the ledger
estimated:

| Probe | Ledger record | Audit finding |
|---|---|---|
| `2024wvrox_sf1m1` | "~13 missing required score fields" | `parseBreakdown` throws with **20** Zod issues |
| `2024cafb_qm1` | missing `adjustPoints` | confirmed — 2 issues (`red.adjustPoints`, `blue.adjustPoints`) |
| 2024 offseason population | "systemic … not one bad match" | **1,004 of 4,757** matches carrying a breakdown fail — **21.1%** |

The defect is **upstream of the fix**: `parseBreakdown` runs at `sigma1/index.ts:735-736`, roughly
100 lines *before* the RP guard at `:839`. `replay.ts:117-119` and `:161-163` call `predict`/`update`
with no `try`/`catch`, so a single throw propagates out of the entire batch — and `epa.ts:432-433`
carries the identical unguarded call. The blast radius is therefore precisely what T-03-18b's own
wording describes: *every season and every algorithm in the batch, not just the offending match.*

**Disposition rationale.** Plan 03-07 behaved correctly *procedurally* — its `files_modified` were
RP-only, and logging to `WINDOWS.md` rather than patching outside its scope was the right call. The
question here is not conduct but disposition: the security property T-03-18b asserts — *`update()`
does not abort the harness on untrusted corpus data* — does not hold on the current tree.

### Recommended remediation

The codebase's own precedent for this exact boundary already exists one file over:
`identifiability.ts:239-249` wraps the same `parseBreakdown` in `try`/`catch` → `skippedMatchCount++`,
commented *"counted, never silently coerced to zero."* The live replay path is the one place it was
not applied.

Smallest correct fix: wrap `parseBreakdown` at `sigma1/index.ts:735-736` and `epa.ts:432-433` so a
Zod failure degrades to the **existing, tested** `usedFallback` path (`redParsed === null` already has
defined semantics with `FALLBACK_NOISE_MULTIPLIER`) and increments a counted skip — never a silent drop.

**Explicitly rejected alternative:** relaxing `breakdown/2024.ts`'s schema to `.optional()`. That
would weaken the T-03-01/T-03-20 integrity controls for *all* seasons in order to fix an availability
problem confined to self-reported offseason data.

Re-close by running both `WINDOWS.md` #4/#5 commands to exit 0 and resolving both ledger entries.

---

## Findings — mitigations narrower than declared

Non-blocking, recorded so a future audit does not have to rediscover them.

**F-1 · T-03-07 — gates 1 and 2 share a data source.** The two gates are independent *code paths*,
but `seasonSplit` (`score.ts:26`) itself reads `HOLDOUT_SEASONS`. The plan's claim that "a bug in
either cannot silently disable the other" holds for logic bugs, not for corruption of that constant.
Gate 3 (`assertNoHoldoutLeak`, post-scoring) is the genuinely independent backstop. Threat remains
closed — this narrows the argument, not the protection.

**F-2 · T-03-01 — no failure counter, and the test is blind to the failing population.** The plan
says the reconciliation test *counts* parse failures. There is no counter: `module.parse`
(`reconciliation.test.ts:222`) is uncaught, so a failure aborts the test. The no-silent-skip property
therefore holds (loudly), but `sampleQualMatches` filters `e.is_offseason = 0`, leaving the test
structurally blind to exactly the population that breaks the harness. **This blindness is why
T-03-18b's 21% failure rate went unmeasured until this audit.**

**F-3 · T-03-14 — provenance completeness rests on the writer, not the schema.** The plan says
`PromotedVersionSchema` *requires* the full provenance block. In fact 8 of 11 fields are `.optional()`
(`promote.ts:52-63`), deliberately, so the legacy `tracer-check` file keeps validating. The guarantee
currently depends on `promote.ts` unconditionally populating them; a future promotion path could omit
`seed`/`searchArtifactSha256` and still parse.

**F-4 · Integrity controls extend past the RP boundary; availability controls do not.**
`breakdown/2024.ts:84-87` has the same `Object.create(null)` + fixed allowlist loop over
`OWN_FIELD_COMPONENT_MAP` as the `breakdown/2026.ts:103` precedent 03-02 copied, with the identical
`T-02-04` comment, and all 13 fields are `z.number().finite()` — **2024.ts is not weaker than its
precedent.** T-03-03/T-03-20's prototype-pollution and non-finite controls are uniform across both
trees. The split is clean: confidentiality/integrity uniform, availability RP-only.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-03-SC | No package installs occur anywhere in phase 3. `03-RESEARCH.md:112-118`'s Package Legitimacy Audit records zero packages recommended for installation — every candidate was nonexistent, unpublished, a name collision (`cma-es`, `optuna`, `bayesian-optimization`, `hpjs`), or judged not worth the trust surface; the hyperparameter search is hand-rolled over existing primitives instead. Verified by audit: `pnpm-lock.yaml` was last modified at `fa9d0455` (phase **01**-01), and both phase-03 `package.json` commits add only npm *scripts* (`tune`, `promote`, `rp:conservative-branch`). CI runs `pnpm install --frozen-lockfile`. **Accepted because the attack surface is empty, not because the check was skipped.** | Jacob Williams | 2026-08-18 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-08-18 | 26 | 25 | 1 | gsd-security-auditor (opus) via /gsd-secure-phase 3 |

**Audit depth.** ASVS L1 (`block_on: high`). The register was authored at plan time, so this was
mitigation-verification, not retroactive STRIDE. Verification exceeded grep depth on the
high-severity threats: `digest.test.ts` was **executed** against the live corpus (T-03-05/17/19/23),
the corpus was **queried directly** to establish event types and the T-03-18b failure population, and
`git log`/`git diff` were used to prove the lockfile and tolerance histories (T-03-SC, T-03-24)
rather than relying on the SUMMARY files' own account.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [ ] `threats_open: 0` confirmed — **1 open (T-03-18b, high)**
- [ ] `status: verified` set in frontmatter — currently `blocked`

**Approval:** pending — blocked on T-03-18b
