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
