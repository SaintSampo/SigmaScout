# The predicted cutoff, 2026-09-26

Three shots at 1440 wide. Taken with no network: the built app was served from `apps/web/dist`
by `vite preview` on :4173, and every `/v1/**` request was answered from `data/fixtures/phase10`
by a Playwright route handler. The handler aborts and logs any request that would leave the
host, so a silent network hit could not have passed unnoticed; the run served 17 fixture
responses and 0 404s.

**The fixture is `district-2026pnw.json`, generation 2026-09-14** — the same artifact 260925-xab
shot, and it predates three fields the publisher emits today (`state`, `awardProfile`,
`bakedEvents`). Where a shot needed one it is stamped on in the harness and the table says so.
Every point value, slot count and verdict in these shots is the published one.

| File | Position | What it shows |
| --- | --- | --- |
| `district-locks-cutoff-1440.png` | Now, with an all final `state` block stamped on all nine events | The District Locks controls card reading **Cutoff 59**. Settled, so no tilde and no likely range: every team in the points pool is done. 59 is the midpoint of the boundary pair 60 and 57, pool ranks 42 and 43 of 118 against 42 points slots. Chips `Prequalified 0 / Locked 50 / In range 0 / Out of range 0 / Locked out 76`. |
| `champ-locks-cutoff-1440.png` | The same position, Champ Locks tab | The Champ Locks controls card reading **Cutoff 182**, which is exactly the artifact's own `insights.cmpCutLinePoints`. The boundary pair is 182 and 182, pool ranks 13 and 14 against 13 points slots, so the midpoint is the tie itself. Chips `Prequalified 0 / Locked 20 / In range 1 / Out of range 1 / Locked out 104`. |
| `district-locks-drawer-cutoff-1440.png` | After week 3 (`at=2026wasam:awards`), all final states stamped AND a STAND IN `awardProfile` on every team | **The one value on both surfaces.** The stat line reads `Predicted cutoff ~54` and the grand total drawer below it draws its dashed rule at the same 54, labelled `Predicted cutoff`, with the two sentence caption. Filtered to team 4089 so both fit one frame; the cutoff describes the whole district and never the filtered view, which is why the number does not move when the filter does. |

## What the third shot's stand in is, and is not

The stand in (`bucket: "none"`, veteran, no prior judged awards) is NOT the published award
profile, so the blue figures in that shot are not published predictions. It exists to produce
blue cells at all: the fixture carries no `awardProfile`, and without one every predicted cell
refuses. The CUTOFF and its label are real behaviour; the numbers behind them are the stand in's.

## Why no shot carries a likely range

No position reachable from this fixture set produces one, and that is the code being correct
rather than a gap in the shots.

- At the all final position there is nothing left to vary, so the cutoff is settled and carries
  no range by design.
- At the rewound position 32 of 126 grand totals still refuse under the stand in profile, and
  `prepareChanceRanking` EXCLUDES a team whose grand total cannot be built. The simulated line
  is then the 42nd highest of a smaller pool than the cutoff was taken over, and it sits below
  it: before the refusal was added the stat line read `Predicted cutoff ~54 · likely 49–51`, a
  range that cannot contain the number beside it. The tab now prints no range at all while the
  chance run excluded anyone (see the deviation in the summary).

A range therefore needs a district whose every grand total builds, which is the ordinary live
case and not something this 2026-09-14 fixture can stand in for. `districtLedgerCopy.test.ts`
pins the range's own wording and its omission rule, and `predictedCutoff.test.ts` pins the
percentiles it is taken from.
