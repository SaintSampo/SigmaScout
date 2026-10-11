---
id: locks-first-live-2027-watch
created: 2026-10-10
source: quick 261009-r9x, 261009-tx6, 261009-vp9, 261010-66y, 261010-d7r, 261010-jyn, 261010-l0s
priority: high
due: 2027-03 (the first 2027 district event), then the first 2027 District Championship played in divisions
---

# Watch the first live 2027 district event and the first divisioned District Championship

## Why this matters

Between 2026-10-08 and 2026-10-10 the Locks tabs were made sound against everything that could be replayed: every 2023 to 2026 championship walked one fact at a time, in shuffled orders, with zero locks taken back. What no replay can show is HOW TBA posts during a real event. The work rests on a few premises about that, each written into a module header as assumed and not verified. Nothing here is undone work. It is a list of things to look at once, when the first real event happens, because that is the first time they can be seen.

## What to look at

At the first 2027 district event (week 1):

1. **Does TBA post district points during an event, or only at the end?** Open the District Locks tab while qualification is running. If rows for the event appear with provisional points, the common case holds. Either way the tab is built to be sound; this tells us which of the two walked cases is the real one (`packages/core/districts/categoryCorroboration.ts` header).
2. **Do one event's points rows land for all of its teams together?** Assumed in `packages/core/districts/dcmpFieldProof.ts` and `categoryCorroboration.ts`. If rows arrive in chunks, tell Claude: the field proof's capacity line would need a stricter reading.
3. **The awards flag.** After the ceremony, the event's Awards should turn grey about an hour after TBA's award list stops changing (twelve hours if an expected award never appears). `wrangler tail` during that hour shows the district pass: `districtsConsidered` above 0, no `districtsFailed`.
4. **Were awards listed in more than one batch, more than an hour apart?** That is the stated limit of the flag (`packages/core/districts/eventAwards.ts`). If it happens, note the event.

At the first District Championship played in divisions (FIM, NE, ONT or TX, April 2027):

5. **The first minutes.** Open the Champ Locks tab as the divisions start. Teams of a division TBA has not posted yet must NOT read Locked out or vanish from the table, and nobody should read Locked and then lose it when the other divisions' rows land (quick task 261010-66y).
6. **Division playoffs.** Locked should appear during the division playoffs and only ever grow (quick task 261010-d7r; the replay of 2026 FIM reads 1, 1, 5, 25, 35, 41, 46 over the playoff ticks).
7. **Any team that reads Locked and then not Locked, at any time.** That is the one thing that must never happen. Note the team, the time and the page URL (the `at` stop if rewound), and tell Claude.

Any live day:

8. **Tick wall time.** On 2026-10-10, with five offseason events playing, Worker ticks took 2 to 7 minutes each and overlapped, so results lagged past the 1 to 3 minute target. That is separate from the Locks work and not fixed. See the memory note "Live tick wall time on a busy Saturday".

## Operator rules that go with this

- Do not run `pnpm publish:districts` for a district while one of its events is live. Since quick task 261010-jyn the publisher skips such a district by itself and says so; `--allow-live` overrides it and should not be needed.
- Deploy the Worker only while no district or championship event sits between its playoffs ending and its awards being posted (`docs/worker-operations.md`).
