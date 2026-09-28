# 260928-n6i run log

Append-only record of what ran against `260928-n6i-PREREG.md` (committed in 73259f8d, sha256 5deea93e1239122c87cad56c66f8704de5b82034d2a6a630673735dcff2b070a).

## Sign-offs

- 2026-09-28, before any retry run: Jacob ACCEPTED the registered bar's Rule A reading. For a level-2-only change, Rule A is satisfied iff G1 shows exact equality of every published winner accuracy and Brier figure. NOT EQUAL is an automatic NO-GO. So the Sigma-carry verdict is no longer conditional on that reading.

## Runs

- Inertness BEFORE: `publishSeasons` dry run 2025-2026, pinned clock (PIN_NOW 2026-09-28T00:00:00.000Z), code imported from a pristine detached checkout at eb90c0d7 (`scratchpad/wt-base`), corpus = the worktree's copy (sha256 prefix 36ab99dd26a74c9c). Output `scratchpad/n6i/digests-before.json`.

All runs below at HEAD 7543ccc2, tree clean for packages, scripts and apps before and after, corpus sha256 prefix 36ab99dd26a74c9c before and after. No instrument was fixed and no gate was rerun.

### Inertness (knob off)

- AFTER at 7543ccc2: 24389 page bodies and 24430 measured strings (presim sidecars included), 0 differences in order or content against BEFORE; running digest 8929a75c6001706f on both; sidecar stats identical. PASS.
- Full vitest suite from the worktree root: 4 failed, 7053 passed, 2 skipped. Three are CRLF-only structural failures (rpSeed, sigmaSeed, rp-attribution fence), which pass on LF copies. The fourth, measureAllianceWinProbability's 2026 re-measure within 1e-4, fails identically at 73259f8d (corpus drift from the 2026-09-28 ingest, not this change).

### Bar R: GO

| Gate | Result | Off | On | Counts |
|---|---|---|---|---|
| R0 winner figures | EQUAL | compare-off.json sha256 1022dd2b3814c2b9... | compare-on.json, identical | cmp exit 0; 35475 bytes; 90 slices |
| R1 played rows (strict) | PASS | bonus Brier 0.136178, RPS 0.136805 | bonus Brier 0.134220, RPS 0.136004 | bonus n 513310, total-RP n 230480, both arms |
| R2 pre-event matched set | PASS | bonus Brier 0.188425, RPS 0.159673 | bonus Brier 0.188311, RPS 0.159645 | bonus n 128214, total-RP n 56700, both arms |

Descriptive, pre-event matched set by RP-cold teams on the side (n, bonus Brier off/on): 0: 127923, 0.188138/0.188138; 1: 282, 0.317452/0.266094; 2: 9, 0.218778/0.205621; 3: 0.

### Sigma-carry retry (both arms rpColdPrior on): GO

| Gate | Result | Incumbent (G4b: reference) | Candidate | Counts |
|---|---|---|---|---|
| G1 Rule A, exact equality | PASS (EQUAL) | compare-off.json sha256 1022dd2b3814c2b9... | compare-on.json, identical | cmp exit 0; 90 slices |
| G2 band calibration | PASS | error 0.057326 (inside-1 0.740326) | error 0.048896 (0.731896) | n 278045 |
| G3 played-row RP | PASS | bonus Brier 0.134220, RPS 0.136004 | bonus Brier 0.134220 (equal), RPS 0.135986 | bonus n 513310, total-RP n 230480 |
| G4-cover | PASS | I = 28350 | C = 115240 | C minus I = 86890; dropped 0 |
| G4a matched set | PASS | bonus Brier 0.188311, RPS 0.159645 | bonus Brier 0.188311 (equal), RPS 0.159641 | bonus n 128214, total-RP n 56700 |
| G4b newly covered vs climatology | PASS | bonus Brier 0.140040, RPS 0.179949 | bonus Brier 0.132851, RPS 0.146411 | bonus n 385096, total-RP n 173780 |
| G5 district bake coverage | PASS | baked 0 / 0 / 1 / 1 / 14 | baked 135 / 135 / 108 / 82 / 20 | 03-01 / 03-05 / 03-14 / 03-21 / 04-04; every knob-on run exited 0 with sidecars schema-parsed |

Descriptive G4b split: 2017-2020 and 2022 candidate/reference bonus Brier 0.118409/0.125974; 2023-2026 0.143945/0.150844. Both halves beat climatology. The first attempt's G4b bonus Brier was 0.173994, so the cold-team prior accounts for the whole shortfall.

**Decision: both GO.** Nothing shipped. Promotion is Jacob's decision (see PREREG "What a GO does and does not do").
