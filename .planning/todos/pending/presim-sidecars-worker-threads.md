---
id: presim-sidecars-worker-threads
created: 2026-10-05
source: presim-all-seasons-handoff step 2, quick 261005-kzs
priority: medium
---

# Build pre-schedule sidecars on worker threads

## Why

Every-season presim (quick 261005-kzs) took the full publish from about 31 minutes to 3 h 16 min
(11,784.2 s, generation 8ee290cd, 2026-10-05). Sidecars are almost all of it: in the dry run EPA's
took 3,982 s and SPR's 5,046 s of 9,822.6 s.

The live Worker refuses to fold between its deploy and the D1 seed. That window is now over three
hours. It is harmless in October and it is not acceptable during a competition season, which
starts in March 2027.

## The lever

Each event's sidecar is independent of every other event's, so several can be built at once on
worker threads with byte identical output. This was named in the handoff and never tried. The
host has 12 logical CPUs and the publish uses about one.

The profile also puts `roundPmf`'s decimal shifting at 12.7% of sidecar time. Nobody has looked at
whether that can be cut.

## Proof it needs

Byte identity against the current sidecars. `experiments/261004-v3h/presimProbe.mts` (gitignored,
on Jacob's machine) builds sidecars with a pinned generation and timestamp so two trees can be
compared with `diff -rq`.

## Until then

A full `pnpm rebaseline` while an event is live freezes that event for three hours. Use
`pnpm publish:stubs` for in-season fixes, or pass `--presim-from-season 2026` by hand for a fast
publish that leaves the older seasons' sidecars as they are (check first that a publish without
them does not orphan or 404 them).
