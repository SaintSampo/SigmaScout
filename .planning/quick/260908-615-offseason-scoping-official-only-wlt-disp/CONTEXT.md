# Context — 260908-615 offseason scoping: official-only WLT display + EPA carryover

## User request (verbatim intent)

1. Remove offseason events from the W-L-T record shown on the Teams list and the team page header.
2. Remove offseason matches from next season's priors for EPA (cross-season carryover). EPA only — VPR unchanged.

## Locked decisions (AskUserQuestion, 2026-09-08)

- **EPA carryover mechanics: snapshot at last official match.** At each season
  boundary, EPA's `carrySeason` input must be the state as it stood immediately
  after the season's final OFFICIAL match — not the season-final state that has
  continued learning through offseason play. Accepted limitation (named by the
  user's chosen option): preseason (eventType 100) or mid-season offseason play
  occurring BEFORE the last official match still leaks into the snapshot. No
  shadow state; no double replay.
- **WLT scope: record AND counts, all official-only.** `record` (W-L-T),
  `matchCount`, and `eventCount` on the Teams-list artifact rows and the team
  page header (`seasonStats.record` or wherever the header actually reads from)
  all become official-only, so the whole header row draws from one population.
  Offseason activity stays visible in the match table and metric history chart.
- **Republish after: yes.** After tests pass, run `pnpm publish:seasons` — but
  ONLY from the main session context (executor subagents' sandbox denies all
  network Bash — see memory `project_subagent_network_block`). The plan must
  mark the republish as a main-context step, NOT an executor task.

## Definition of "official"

Use the existing shared predicate: NOT `is_offseason` AND official
`eventType` (`isOfficialEventType`, `packages/core/algorithms/eventTypes.ts` —
eventType 99 Offseason and 100 Preseason are unofficial; championship
divisions/Einstein ARE official). `apps/web/src/lib/officialSnapshot.ts` and
publish.ts's `officialEventKeys`/`lastOfficialMetricsByTeam` already apply this
rule — reuse, do not re-derive.

## Known constraints and hazards (from project memory + docs)

- **D-13 version invariant**: EPA's published output changes for every season
  after the first (different priors) → `epa.ts` version must bump
  `5.0.0+baseline` → `6.0.0+baseline` with the standard bump comment, even if
  the mechanical change lives partly in the harness. No version string may
  stand for two different computations.
- **Committed digests/fingerprints**: `packages/harness/baselineFingerprint.test.ts`
  and any committed digest pins over EPA output will move. Regenerate/update
  per their own documented procedure, never hand-edit blindly.
- **`data/baselines/epa-vs-statbotics-2026-09.json`**: the carryover change
  moves per-team agreement stats (expected direction: CLOSER to Statbotics,
  whose priors are champs-frozen). If `npx tsx scripts/epaVsStatbotics.ts --check`
  fails its ±bands, re-measure and recommit the baseline per
  `docs/models/epa-vs-statbotics.md`'s documented re-measurement procedure,
  and note the movement in that doc.
- **Docs must track the shipped model**: update `docs/models/epa-divergences.md`
  (the offseason-population divergence narrows: priors are now official-only)
  and `docs/models/epa-vs-statbotics.md` if its measured tables are refreshed.
- **Teams artifact + team artifact**: `packages/harness/publish.ts` —
  `teamsRows` (`record`/`eventCount`/`matchCount`, currently season-wide per
  the comment at ~line 2312) and the per-team artifact's `seasonStats.record`.
  The team page header (`SeasonHeader.tsx:74,173`) reads
  `artifact.seasonStats.record` and its comment says "always season-final" —
  that comment and any tests asserting it must be updated, not worked around.
- **Test scope trap** (memory): run tests from the REPO ROOT (`npx vitest run`),
  not from apps/web; root `tsc --noEmit` misses apps/web — run the web
  tsconfig too.
- **timeout+pnpm false green** (memory): never verify via `timeout N pnpm ...`
  exit codes; use `npx vitest run` and verify by output.
- **publish-budget is manual** (memory): after `publish:seasons`, transcribe
  its printed summary into `docs/publish-budget.md` or tests fail.
- **Iteration-list trap** (memory): season-list tests iterate hardcoded lists —
  check whether any equality-pinned test files
  (3 files across 3 packages) assert artifact shapes touched here.
- **Compare fixtures**: `apps/web/src/routes/__fixtures__/compare-*.json` were
  refreshed from the 2026-09-08 publish; if the republish regenerates them,
  refresh via the established fixture-refresh path (see recent commit
  1f11ea8f "refresh compare fixtures").

## Out of scope

- VPR/BPR/OPR carryover — unchanged.
- Scoring/accuracy populations — already official-only, untouched.
- Metric history, match table, offseason event pages — deliberately still
  offseason-inclusive for display.
- The official-scoped metric tiles (officialSnapshot.ts) — already correct.
