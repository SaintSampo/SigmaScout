# Champ Locks: No call and a DCMP priced before it starts, 2026-09-27

Six shots of the 2026 Pacific Northwest Champ Locks tab at 1440 wide, in real Chromium. These are the two
states the 260927-6bf run listed under "What could not be rendered offline". The app was built at
2d9e89b3 into a private output directory with `VITE_ARTIFACT_ORIGIN=http://localhost:4391` and served
by `vite preview` on port 4391. The working tree also held another session's uncommitted edits to
`SeasonHeader.tsx` and a team route test, which the District Locks page does not use. A Playwright
route handler answered every `/v1/**` request, and the page made no off host request (aborted count
0 in all four runs).

- **State 1** uses 6bf's serving recipe unchanged: a stand in manifest naming `spr@7.0.0+baseline`,
  `data/local-publish/districts` for the index and `2026pnw`, and `data/fixtures/phase10` for the eight
  PNW district events. `2026pncmp` is answered 404.
- **State 2** serves two doctored copies of the local `2026pnw` artifact and a stand in DCMP sidecar,
  all built by a throwaway prep script and then deleted:
  - **Sidecar** (`v1/district-presim/2026pnw/2026pncmp.json`): built from the live `2026pncmp` SPR
    event artifact (`spr@7.0.0+baseline`, two public GETs) with the shipped
    `buildDistrictEventSimulationInput` and `simulateDistrictEvent`, rewound to qualification match 1
    (100 remaining matches, 8 alliances, field 50, 1000 draws). It is encoded with the bake's own
    encode, round and trim steps and parsed under `DistrictPreSimArtifactSchema`. That means it is priced
    from the real DCMP schedule and each match's published pre match prediction.
  - **District artifacts**: every DCMP points row was removed and subtracted from `pointTotal`, the
    DCMP qualifying awards were dropped, and ranks were recomputed from the rewound totals. Registered
    teams get an unstarted `2026pncmp` entry in `remainingEvents` (`qualMatchesTotal: null`), and
    `bakedEvents` is `["2026pncmp"]`. Both parse under `DistrictArtifactSchema`.

| File | Position | Stat line | Chips | Notes |
| --- | --- | --- | --- | --- |
| `pnw-end-of-district-control-1440.png` | `2026waahs:awards`, unforced | Predicted cutoff ~186 · likely 163–205 | Prequalified 0, Locked 0, In range 15, Out of range 36, Locked out 75 | Matches 6bf's figures; the likely range now shows (3e455ded) |
| `pnw-no-call-1440.png` | `2026waahs:awards`, champ run forced to fail | Predicted cutoff not available · the simulation did not finish in this browser | In range —, Out of range —, Locked out 75 | 51 No call chips, exactly the control's 15 + 36 |
| `pnw-no-call-controls-1440.png` | same, controls card at 2x | same | same | So the reason text is legible |
| `pnw-dcmp-roster-known-1440.png` | Now, all 50 match roster teams registered | Predicted cutoff ~188 · likely 174–201 | In range 16, Out of range 34, Locked out 76 | Every registered DCMP row priced from the sidecar |
| `pnw-dcmp-roster-known-drawer-1440.png` | same, 5468's DCMP Playoffs drawer open | same | same | Playoff outcomes from the DCMP's own prediction |
| `pnw-dcmp-first-batch-1440.png` | Now, top 30 registered | Predicted cutoff ~192 · likely 178–207 | In range 13, Out of range 37, Locked out 76 | Priced and estimated DCMP rows in one frame (9 and 6) |

## State 1, No call

- **How it was forced.** No source file changed. A Playwright init script replaced `window.Worker`
  with a subclass that forwarded only the champ run's request (`type: "chance"` with
  `inputs.awardDraws`) to the real built Worker, with `draws: 0`. The real protocol rejected the
  request and posted a real `type: "error"` message. The fallback synthetic error was not needed.
- **Worker counts:** created 1, forced 1, passed 0. The plan expected the district run to pass
  through as well. At the end of the district season no team has an open district category, so
  `prepareChanceRanking` returns nothing, that run never starts, and the champ run is the only Worker
  on the page. The forcing touched nothing else.
- **Copy, verbatim:**
  - Chip label: "No call"
  - Chip `title`: "No predicted cutoff can be drawn at this position: the simulation did not finish in this browser."
  - Chip screen reader text: ". No predicted cutoff can be drawn at this position: the simulation did not finish in this browser."
  - Stat line reason span: "· the simulation did not finish in this browser"
- **Widths:** No call 88 px, Out of range 88.3 px (control), Pending 88 px (caught in both runs).
  The Status column does not change width when a call settles or fails.
- **Stat history:** "Predicted cutoff pending", then "Predicted cutoff not available · …", with no figure in between.
- **Verdicts unchanged:** Locked out 75 and Prequalified 0 and Locked 0 match the control. The chance
  line under the chip ("94% chance" in the control) is gone for No call rows, as designed.

## State 2, the DCMP priced before it starts

- **Registered:** 50 in the roster variant, 30 in the first batch variant.
- **DCMP rows (126 teams):** roster variant 50 priced and 76 estimated; batch variant 30 priced and
  96 estimated. In both: 0 not in field, 0 district only, 0 unavailable. REGISTERED PRICED is exact in
  both: every registered team is priced and no unregistered team is.
- **Source lines seen:** "Wk 6 · not started" on every priced row; "~99% to be there" and
  "<5% to be there" on estimated rows. With the whole roster registered, the other 76 teams keep an
  estimate at "<5% to be there" rather than reading not in field, because the field is still open
  before the event starts.
- **First priced against first estimated (roster variant):** frc5468's DCMP Subtotal ~198 (likely
  128.7–219.2) with four priced categories (~63, ~48, top 4 ~88%, ~64% award), against frc5920's
  estimated ~30 (likely 11.2–77.3) with four "not yet priced" categories.
- **EVENT REQUESTS 0** in both variants and **SIDECAR SERVED 1**, so the sidecar alone priced the DCMP.
- **Drawer (5468, Playoffs):** Wins the event ~54% (90), Finalist ~17% (60), Third place ~12% (39),
  Fourth place ~6% (21), Out before the top four ~12% (0), with the grand total histogram and the
  dashed predicted cutoff underneath.
- **Stat line:** ~188 with the full roster and ~192 with the first batch, against the published 182.
  That is context only, since these numbers come from a stand in sidecar.
- **Stand in sidecar medians against the real DCMP totals** (information only): frc2046 204 against
  219, frc2910 147 against 201, frc5468 198 against 156.

## Finding: an award only DCMP attendee has no sidecar row

frc2635 has a `2026pncmp` points row of 24, all awards (Engineering Inspiration), but played no DCMP
match, so it is not on the event artifact's 50 team roster. This stand in sidecar was built from that
match roster, so it has no row for 2635, and the roster variant registers the 50 match roster teams
rather than all 51.

**Follow up (checked the same day): this is a harness artifact, not a production bug.** TBA lists
2635 among 2026pncmp's 51 registered teams (`event_teams`). `scripts/publishDistricts.ts` builds both
the page's `remainingEvents` and the real bake's roster from that one registrations map, so a real
sidecar carries a row for every registered team and none reads unavailable. Once the DCMP has started,
a registered team missing from the schedule gets no row from the event's own simulation, so its row
falls back to the walk forward estimate (`buildDcmpRow` case 3). Until its awards post, it shows
estimated DCMP points as if it were playing.

## What these shots do not prove

- The live Cloudflare Worker tick path, or a promoted live DCMP.
- A real `publish:districts` bake of a DCMP sidecar. The stand in used the real schedule and published
  predictions; a real pre event bake uses synthetic schedules and the walk forward state. State 2's
  NUMBERS are not what production would print, only its layout and which source prices which row.
- TBA registrations arriving on the wire, or the 60 s district refetch picking them up.
- A genuine Worker failure, such as a script load failure or running out of memory, as opposed to a
  rejected request. Both end in the same error branch, but only the rejected request was exercised.
- Any No call reason other than `workerError`.
- Phone widths.
