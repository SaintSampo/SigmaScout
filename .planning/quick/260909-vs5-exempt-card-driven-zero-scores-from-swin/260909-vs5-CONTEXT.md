# Quick Task 260909-vs5: Exempt card-driven zero scores from Swing Factor - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Task Boundary

**The bug, in the developer's words:** a red card sets an alliance's score to 0, and
Swing Factor currently folds that 0 as a genuine observation — so a single carded
match tanks a robot's Swing Factor and, since quick task 260909-tgf, its rarity tier
too. A ruling is not evidence about a robot's consistency.

**The fix:** `SwingFactorAccumulator.foldMatch` must skip a card-zeroed alliance's
observation, using the predicate the algorithms already use.

This is a genuine gap rather than a regression. `packages/core/algorithms/dq.ts`
already exists and is already applied by EPA and Sigma1; Swing Factor was simply never
wired to it. Its `foldMatch` checks `isFullyDemoAlliance` and nothing else.

</domain>

<decisions>
## Implementation Decisions

LOCKED — settled with the developer before planning. Do not revisit.

### D1 — Apply `isFullyDqZeroScoreAlliance` ONLY. Not `isAdjustZeroedAlliance`.

`dq.ts`'s header documents that scorekeepers encode a card-driven zero-out two
structurally different ways, and measures both against `data/corpus.sqlite`:

- **Full DQ flags** — 207 of the 211 measured score-zeroed rulings.
- **`adjustPoints: -N` with an EMPTY DQ list** — 4 slip through at the
  `adjustPoints <= -30` threshold; 13 at the full `adjustPoints < 0` threshold,
  spanning 2019-2026.

This task covers the first only. That is ~98% of the measured population using data
BOTH fold sites already hold.

The adjust case is deliberately deferred, and the reason is not laziness:

- Neither fold site parses breakdowns today. Verified 2026-09-09: `tryParseBreakdownPair`,
  `adjustPoints`, and `ADJUST_COMPONENT` appear in NEITHER
  `packages/harness/sigmaScoutLayer.ts` NOR `apps/worker/src/scheduled.ts`.
- `isAdjustZeroedAlliance` requires the PARSED breakdown, never the D-05
  fallback-imputed vector — so it cannot be faked from data already at hand.
- The live Worker runs under a 10 ms CPU budget and holds a **live/offline
  bit-equality contract** on the swing band. Applying a predicate offline that the
  Worker cannot evaluate would silently break that parity, which is exactly the
  failure mode that contract exists to catch.

If the adjust case is picked up later it needs its own task with its own Worker
plumbing measurement. Do not smuggle it into this one.

### D2 — Drop ONLY the offending alliance's observation, never the whole match

This is `dq.ts`'s own documented asymmetry and it is NOT the same rule as the demo
check sitting beside it:

- `isFullyDemoAlliance` drops **the whole match, both alliances** — a real alliance
  "beating" three placeholders carries no information about either side.
- A whole-alliance DQ has **no such symmetry**. The disqualified alliance's three
  robots were real and physically on the field; only THAT alliance's own 0 is
  meaningless. The opponent's score is a genuine observation and must still fold.

So the demo early-return stays exactly as it is, and the DQ check is a separate,
per-alliance skip.

### D3 — A skipped fold must not consume a decay step

`SwingFactorAccumulator.fold` already documents this behaviour for its own ignore
path: a malformed or unplayed row "simply contributes nothing and does not consume a
decay step." A DQ skip must behave identically — do not decay the belief and then
decline to add the observation, as that would still quietly age the team's history on
the strength of a ruling.

### D4 — Live and offline must stay bit-identical

Both call sites change together, in the same commit where practical:

- `packages/harness/sigmaScoutLayer.ts:140` (offline publish)
- `apps/worker/src/scheduled.ts:1003` (live Worker)

`MatchResult` already carries `redDqs` / `blueDqs` (`packages/core/algorithms/types.ts:75-76`),
and `scheduled.ts:407-408` already maps `match.redDqs` / `match.blueDqs` onto its own
result object, so the data is in hand at BOTH sites and no new plumbing is required.

Whatever replay/digest test currently pins live/offline swing equality must still pass.
If changing `foldMatch`'s signature is necessary, change it once and update both
callers — do not add an optional parameter that one caller silently omits, because a
defaulted-empty DQ list would make live and offline disagree while both look healthy.

### D5 — Composition with the demo check follows dq.ts's contract

`dq.ts`'s header specifies the composition order and the team-identity each predicate
reads: `isFullyDemoAlliance` first against the RAW team lists (as it already is), then
`isFullyDqZeroScoreAlliance` against the caller's own rating-eligible team list,
compared to the RAW dq key lists.

Follow that contract. Do NOT widen the predicate to catch a mixed demo+DQ alliance —
`dq.ts` calls that "a different, unmeasured population this fix does not claim to
address," and widening it would drop observations whose blast radius nobody measured.

### D6 — Stage commits by explicit path

Multiple sessions have been committing to this checkout all day. The working tree was
clean at plan time, but that can change mid-task. **Never `git add -A`, `git add .`,
`git add -u`, `git stash`, or `git reset --hard`.** Stage explicit paths and use
`git commit -- <paths>` so a concurrent session's staged work cannot ride along.

### Claude's Discretion

- The shape of the signature change to `foldMatch` (D4 requires only that both callers
  change together and neither gets a silent default).
- Test structure and placement.
- Whether a partial-DQ-with-exactly-zero-score population exists is NOT in scope to
  fix, but noting it in a comment is welcome — `dq.ts` says partial DQs average 68.4
  points "with essentially no zeros," which is why the narrow predicate is correct.

</decisions>

<specifics>
## Specific Ideas

Verified against HEAD 2026-09-09:

- `packages/harness/swingFactor.ts` — `SwingFactorAccumulator.foldMatch` (~line 385)
  currently reads `if (isFullyDemoAlliance(redTeams) || isFullyDemoAlliance(blueTeams)) return;`
  then folds both alliances. `fold` (below it) is where the per-alliance deviation is
  computed and already carries the ignore-without-decay contract D3 names.
- `packages/core/algorithms/dq.ts` — `isFullyDqZeroScoreAlliance(teams, dqs, allianceScore)`.
  Returns `false` for an empty `teams` array and `false` for any non-zero score, both
  deliberately. Read its header before touching anything.
- `packages/core/algorithms/types.ts:75-76` — `MatchResult.redDqs` / `blueDqs`.
- `apps/worker/src/scheduled.ts:397` — an existing comment already describes calling
  `isFullyDqZeroScoreAlliance(teams, result.redDqs, result.redScore)`, so the Worker's
  own DQ contract is established there; match it rather than inventing a second style.

**This change alters published Swing Factor values**, and therefore the rarity tiers
added by quick task 260909-tgf. A republish is required for it to reach the site. That
republish is the developer's step and is OUT of scope here — same rule as 260909-tgf's D4.

</specifics>

<canonical_refs>
## Canonical References

- `packages/core/algorithms/dq.ts` — the header IS the specification for this task:
  the two encodings, the corpus measurements, the drop-only-the-offending-alliance
  asymmetry, and the composition contract with `isFullyDemoAlliance`.
- `.planning/todos/pending/exclude-whole-alliance-dq-zero-scores.md` — the originating
  todo, if it is still present.
- `.planning/quick/260909-tgf-make-swing-factor-a-first-class-metric-w/` — the task
  that made Swing Factor a tiered metric, which is what makes this bug visible.
- `.claude/CLAUDE.md` — project instructions.

</canonical_refs>
