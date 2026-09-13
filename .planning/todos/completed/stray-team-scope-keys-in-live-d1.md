---
id: stray-team-scope-keys-in-live-d1
created: 2026-09-12
source: incidental finding while running the pre-event probe (quick task 260912-3e6) against live D1
priority: low
---

# Live D1 carries `frc` and `frc0` as team scope keys, and neither is a team

Found by the probe's roster discovery, which orders by `scope_key` and so surfaced them first:

```
SELECT algorithm_id, scope_key FROM algorithm_state
WHERE scope_kind='team' AND (scope_key NOT GLOB 'frc[0-9]*' OR scope_key GLOB 'frc0*');

bpr  frc, frc0
epa  demo-pseudo-unregistered, frc, frc0
opr  demo-pseudo-unregistered
```

`demo-pseudo-unregistered` is a deliberate sentinel and is fine. `frc` and `frc0` are not team keys —
TBA keys are `frc<number>` with no leading zero and no bare prefix.

## Why it is probably harmless, and why it is still worth closing

Both rows are small (`bpr` 256 bytes, `epa` 470 — the same size for both keys, which is the size of a
cold row with no observations), and neither exists in `opr`. That pattern points at
`initState` seeding an entry for every key it is **given** rather than every key an algorithm
actually folds — the exact behaviour `scheduled.ts`'s own demo-team header warns about, just reached
by a malformed key instead of a demo one.

So the likely story is a parse producing an empty or zero team number somewhere upstream in the
corpus, carried into the seed. Two things worth knowing that this finding does not establish:

1. **Where the key comes from.** Check the corpus for a match whose roster contains `frc`/`frc0`
   before assuming it is a serializer artifact.
2. **Whether a real team's observations went into one of them.** The byte sizes say no, but that is
   inference from a size, not a read of the row.

## The fix is probably a guard, not a delete

Deleting two rows from live D1 leaves whatever produced them in place to produce them again at the
next seed. Prefer a validity predicate at the same choke point `isDemoTeamKey` already occupies, so a
malformed key can neither acquire a state row nor a published page — and then let the next
re-baseline clear the existing rows by rewriting the table.

Related: [[worker-state-shape-unexercised-since-seed]].

## RESOLVED 2026-09-13 — guard shipped in code, SPR given the demo exclusion, stale pages deleted

**Where the keys came from.** TBA's own roster data, not a serializer or parse bug. `frc` fills one
slot in 11 played 2016cafc2 matches (a real robot with no number). `frc0` is a placeholder alliance
in 4 played 2016ohsc quarterfinals, and in 9 unplayed placeholders at 2023azrl4, 2023onsc and
2024mdsev. A third shape, `frc58 /`, sits in 3 played 2019wiwi matches. All 18 played matches are at
offseason events after their season's last official match.

**Real observations did go into them, and into real teams.** The byte-size inference in this todo
was wrong on one point: the 2016ohsc byes were folded, so real teams "beat" three empty slots in
OPR, EPA and SPR. And the live site published team pages and zero-match teams-list rows for `frc`
(2016), `frc0` (2016, 2023, 2024) and `frc58 /` (2019).

**What landed:**

- `a8c5f965`: `isPlaceholderTeamKey` in `demoTeams.ts` (no number, a zero number, or a character no
  team key can hold; letter-suffixed second robots stay real). `isDemoTeamKey` includes it, so the
  existing demo paths cover placeholders: match dropped for a fully-placeholder alliance, pseudo
  remap beside real teammates, publish's `teamsThisSeason` filter, the worker's touched-team filter.
- **SPR never had the demo exclusion at all.** It rated `frc9970`-`frc9999` as 30 real teams (30 live
  D1 rows). Jacob chose to fix that in the same change. `spr.ts` now skips fully-demo matches and
  remaps demo/placeholder slots in `predict` and `update`, bumped to **spr@4.0.0+baseline**.
  Walk-forward A/B on the publish path (10 seasons, offseason included, `aggregateScores`): pooled
  accuracy 0.753673 -> 0.753793, pooled Brier 0.163091 -> 0.163076. Both strictly improve, so Rule
  A passes. 88 official picks flip. Per season it is mixed and tiny. The in-module change was
  proven bit-identical to the A/B's wrapper arm on every replayed prediction.
- The 15 stale R2 team pages (`frc`, `frc0`, `frc58 /` x opr/epa/spr) were deleted. A re-list proved
  exactly 15 keys removed, nothing else, and real team 58's 30 pages identical. The public origin
  returns 404 for them.

**Still owed:** the live site and live D1 still run spr@3.0.0 until the republish in
[[republish-spr-4-demo-exclusion]]. The live D1 `frc`/`frc0`/demo rows clear at that re-baseline,
per this todo's own plan.
