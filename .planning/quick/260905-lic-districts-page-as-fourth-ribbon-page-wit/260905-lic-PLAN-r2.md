---
quick_id: 260905-lic
type: execute
mode: quick-revision
revises: 260905-lic-PLAN.md
autonomous: true
---

# Revision R2: award-based qualification, color-coded locks, richer headers

User-requested changes after the base checkpoint, informed by `260905-lic-RESEARCH-awards.md`
(read it before implementing — it carries the verified per-season rules, TBA award_type
mapping, slot-accounting formulas, and the curated prequalified team lists).

## User decisions (locked)

- Color coding on the Locks tabs: **green** = locked on district points, **blue** = locked by
  an award (Impact), **red** = eliminated, **purple** = prequalified. Contending stays neutral.
- Awards column on both Locks tabs naming the award(s) that sent the team: Impact, Winner,
  Engineering Inspiration, Rookie All-Star.
- Blue at the district level = Impact only (research: EI/RAS are award-only invites in every
  corpus season — show them in the awards column annotated "award-only invite", no play slot).
- Prequalified (purple) comes from a curated in-repo list (research §Q3 has the verbatim lists;
  prefer TBA's HOF lists; follow TBA's year_end=2019 for original-and-sustaining, noting the
  2020 manual conflict in a comment).
- District Locks header: BOTH (a) per-team ceiling + per-event schedule strip (e.g.
  "Pre-DCMP points remaining: 83 / 166 per team" with each regular event played/upcoming and
  its 83-max), AND (b) the district-wide points pool (points still to be distributed per
  not-yet-played event; played events read from actual event_points sums, upcoming events
  estimated from team count x the season's observed average points-per-team at played district
  events, clearly marked as an estimate).
- Champ Locks header: "Remaining district points: X / Y pre-DCMP" where X includes the DCMP
  ceiling (3x tier) when the team's DCMP is still ahead, per the approved preview.
- Ribbon order becomes **Teams, Events, Districts, Compare**.

## Task R2a (data + math + publish) — files:
packages/corpus/schema.sql, packages/corpus/db.ts, packages/corpus/districts.test.ts,
packages/ingest/schemas.ts, packages/ingest/tbaClient.ts, packages/ingest/districts.ts,
packages/ingest/districts.test.ts, packages/ingest/cli.ts,
packages/core/districts/qualification.ts (new), packages/core/districts/qualification.test.ts (new),
packages/core/districts/prequalified.ts (new), packages/core/districts/locks.ts,
packages/core/districts/locks.test.ts, packages/harness/pageArtifacts.ts,
packages/harness/pageArtifacts.test.ts, scripts/publishDistricts.ts, scripts/publishDistricts.test.ts

1. **Awards ingest**: `event_awards` table (PK `(event_key, award_type, team_key)`, plus `year`,
   `fetched_at`; store only award types 0, 1, 9, 10; recipient rows with null `team_key` are
   skipped). `fetchEventAwards` (ETag-aware), Zod schema (recipient_list team_key is nullable),
   pure normalize, accessors mirroring existing shapes. Extend `--districts-only` to fetch
   awards for every district event key (regular + DCMP come from the same
   /district/{key}/events/keys list). Must be runnable standalone over already-ingested seasons:
   add an `--awards-only` mode so the orchestrator can ingest awards without --force re-fetching
   rankings.
2. **Qualification model** (`qualification.ts`): per-season qualifying sets per the research —
   district-event type 0 = full DCMP qualifier; DCMP types {0, 9, 10, 1} = Champs qualifiers
   (all consuming). Award display names: "Chairman's" pre-2023, "FIRST Impact" 2023+ (never
   branch on TBA's name string). `prequalified.ts`: curated per-season lists verbatim from
   research §Q3 with source citations.
3. **Lock math** (`locks.ts`): implement TBA's slot arithmetic (research §Q5):
   points_slots = max(slots - |consuming award qualifiers ∩ ranked|, 0); consuming qualifiers
   and prequalified teams are removed from the points pool (they are not threats and not
   contenders); new statuses `lockedAward` and `prequalified` join
   locked/eliminated/contending/unknown. A team that is BOTH award-qualified and points-safe
   reports `lockedAward` (the award is what guarantees it). Keep the pure-function contract and
   the existing tie/null rules. Property to test: adding an award qualifier never improves a
   non-qualified rival's status.
4. **Artifacts** (schema + publish): each team gains `qualifyingAwards:
   [{ eventKey, awardType, label, awardOnly: boolean }]` (district tab: district-event 0/9/10
   with 9/10 flagged awardOnly; champ tab: DCMP 0/9/10/1) and lock statuses extended. Detail
   artifact gains header data: `preDcmp: { maxPerTeam, remainingPerTeam, events: [{ eventKey,
   name, week, dateStart, played, maxPoints }] }` and `pointsPool: { distributed, remaining,
   perEvent: [{ eventKey, played, actualOrEstimate, isEstimate }] }` plus
   `champRemaining: { perTeamMax, preDcmpMax }`. Special-case `2025fsc` per research: its champ
   lock renders status unknown with `allocationNote` ("special allocation — not modeled").
5. Bump the artifact `schemaVersion` and keep Zod schemas + publish + web fetchers in lockstep.
   Dry-run for 2026 must validate.

## Task R2b (UI) — files:
apps/web/src/components/ribbon/Ribbon.tsx + test, apps/web/src/routes/districts.tsx + test,
apps/web/src/components/districts/* (+ DistrictLocksTab.test.tsx), apps/web/src/lib/api/districts.ts

1. Ribbon order Teams, Events, Districts, Compare (update NAV_LINKS, NavLinks(), tests).
2. Color-coded status per user mapping. Colors must read as ink (Pine discipline), be
   theme-consistent, and never be the only encoding (status text stays). Load
   Skill("sketch-findings-sigmascout") first; the user's color mapping overrides its
   accent-reservation rule for these four statuses.
3. Awards column ("Sent by") on both Locks tabs from `qualifyingAwards`, with award-only
   invites annotated on the District Locks tab.
4. District Locks header: per-team ceiling stat + event schedule strip + district-wide pool
   (estimates marked "~"). Champ Locks header: remaining-vs-pre-DCMP line per the preview.
5. Update/extend tests: a lockedAward row renders blue with its award named; prequalified
   renders purple; the header strip shows played vs upcoming; ribbon order test.

## Orchestrator-run steps (network)

- `pnpm ingest:districts -- --awards-only` (or equivalent) across 2019-2020 and 2022-2026.
- Dry-run publish, then real publish, live-origin content check, screenshots.

## Verification

- All district suites + full apps/web suite green; typecheck clean; repo-root no redder
  (known flake: packages/harness/seasonParamSets.test.ts).
- sigma1 in-flight files untouched.
