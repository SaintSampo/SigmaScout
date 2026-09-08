/**
 * Content-as-data for the `/methodology/acknowledgments` page (quick task
 * 260905-tor). `AcknowledgmentsPage.tsx` maps this array to `<section>`
 * elements — the single source of names, links and prose — so
 * `methodology.acknowledgments.test.tsx` can iterate this constant
 * structurally rather than hand-typing a second copy, matching the
 * content-as-data discipline the former Intro to VPR page's own content
 * module established (retired by quick task 260908-n5o).
 *
 * Audience: the same FRC community (students, mentors, scouts) the rest of
 * the site is written for. Gracious, specific, plain language, short
 * sentences — say WHAT each project contributed, not that it is "great".
 *
 * Every claim below is traceable to a named source file — this task's own
 * closed claim list, checked live against this repo before writing:
 *
 *   The Blue Alliance (`https://www.thebluealliance.com/`)
 *   1. Every match, event, team, ranking, alliance, award and
 *      district-points record on SigmaScout comes from The Blue Alliance's
 *      public API; SigmaScout collects no competition data of its own.
 *      (`packages/ingest/tbaClient.ts` header — sixteen TBA capabilities;
 *      `TBA_BASE` is `https://www.thebluealliance.com/api/v3`.)
 *   2. TBA is free and volunteer-run, so SigmaScout throttles outbound
 *      requests and uses conditional (ETag) requests so an unchanged
 *      payload costs a cheap "nothing changed" reply. That pattern came
 *      from TBA's own guidance on querying their API efficiently.
 *      (`packages/ingest/tbaClient.ts`'s `THROTTLE_INTERVAL_MS` and its
 *      ETag/If-None-Match handling; `.claude/CLAUDE.md` Sources cites TBA's
 *      "Efficiently Querying the TBA API" post.)
 *   3. Team and event pages on SigmaScout link back to that team's or
 *      event's page on TBA.
 *      (`apps/web/src/components/team/SeasonHeader.tsx` builds
 *      `https://www.thebluealliance.com/team/{teamNumber}`;
 *      `apps/web/src/components/event/EventHeader.tsx` exports
 *      `TBA_EVENT_URL_PREFIX`.)
 *   No claim is made about TBA's licence, terms of use, or required
 *   attribution — this repo does not record those terms.
 *
 *   Statbotics (`https://www.statbotics.io/`)
 *   1. Statbotics established the way an FRC stats site presents teams,
 *      events and predictions, and SigmaScout follows that shape.
 *      (`.planning/PROJECT.md` line 5.)
 *   2. EPA, Statbotics' rating, is one of the algorithms a visitor can
 *      select on SigmaScout; the picker names it "EPA Statbotics" plus the
 *      version being served. Deliberately NOT a version literal here: the
 *      trailing number is our own `epa` code version and it moves with every
 *      bump (quick task 260908-615), so a hardcoded copy on this page would
 *      go stale behind the picker it describes.
 *      (`apps/web/src/components/ribbon/AlgorithmSelect.tsx`'s
 *      `EPA_STATBOTICS_LABEL_PREFIX`.)
 *   3. SigmaScout's EPA is a from-scratch reimplementation over TBA data,
 *      not Statbotics' own code, so EPA can be replayed walk-forward at any
 *      point in a season; any place the two disagree is SigmaScout's
 *      reimplementation drifting, not a fault of Statbotics', and those
 *      differences are measured and written down.
 *      (`.planning/PROJECT.md` Key Decisions row "EPA reimplemented, not
 *      pulled from Statbotics API"; `docs/models/epa-vs-statbotics.md`;
 *      `docs/models/epa-divergences.md`.)
 *   4. Statbotics' own published season accuracy is carried as a
 *      clearly-labelled reference figure inside SigmaScout's accuracy
 *      reporting, so SigmaScout's numbers are always shown next to the
 *      number they are trying to beat.
 *      (`packages/harness/statbotics.ts` — D-04's reference row.)
 *   No head-to-head verdict or accuracy number is published on this page —
 *   the accuracy-comparison page owns those; this entry points at it.
 *
 *   FRC Locks (`https://frclocks.com/`)
 *   1. The idea behind SigmaScout's Districts page — showing whether a
 *      team's district championship spot is already mathematically locked,
 *      or already out of reach — came from FRC Locks.
 *   2. The concept is all that was taken. Every number on SigmaScout's
 *      Districts page is computed from TBA's published district point data
 *      and the official FIRST district point model. Nothing was fetched,
 *      scraped, or copied from FRC Locks.
 *      (`.planning/quick/260905-lic-districts-page-as-fourth-ribbon-page-wit/260905-lic-PLAN.md`
 *      — "frclocks.com is a reference for the concept only... Do not fetch,
 *      scrape or consult frclocks for values"; and that task's SUMMARY —
 *      "frclocks.com was consulted for the concept only; no value came from
 *      it".)
 *
 *   FIRST (`https://www.firstinspires.org/`)
 *   1. FIRST runs the FIRST Robotics Competition, and publishes the game
 *      manuals that define the ranking-point rules and the district point
 *      model SigmaScout implements.
 *      (`.planning/STATE.md` records a human confirming SigmaScout's
 *      ranking-point thresholds against the 2025 FRC Game Manual Sec 6.5.4
 *      Table 6-2 and the 2026 FRC Game Manual Sec 6.5.3 Tables 6-4/6-5; the
 *      district point model is cited in the 260905-lic plan.)
 *   2. SigmaScout is an independent community project and is not affiliated
 *      with or endorsed by FIRST.
 *
 * Two hard prohibitions honored throughout: no claim that SigmaScout is
 * better than, beats, or outperforms any project it credits, and no
 * accuracy figure, Brier score, or percentage of its own — all of that
 * lives on the fetched accuracy-comparison page. No claim about any third
 * party's licence, terms of use, or required attribution.
 */
export interface AcknowledgmentEntry {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly paragraphs: readonly string[];
}

export const ACKNOWLEDGMENTS_LEAD =
  "SigmaScout is built on work other people did first — the data, the ratings it measures itself against, and the ideas behind several of its pages. This page says who, and what each one contributed.";

export const ACKNOWLEDGMENTS_ENTRIES: readonly AcknowledgmentEntry[] = [
  {
    id: "the-blue-alliance",
    name: "The Blue Alliance",
    href: "https://www.thebluealliance.com/",
    paragraphs: [
      "Every match, event, team, ranking, alliance, award and district-points record on SigmaScout comes from The Blue Alliance's public API. SigmaScout collects no competition data of its own.",
      "TBA is free and volunteer-run, so SigmaScout is deliberately a light caller: outbound requests are throttled, and repeat fetches use conditional requests so an unchanged payload costs a small \"nothing changed\" reply instead of a full download. That pattern came from TBA's own guidance on querying their API efficiently.",
      "Team and event pages on SigmaScout link back to that team's or event's page on TBA.",
    ],
  },
  {
    id: "statbotics",
    name: "Statbotics",
    href: "https://www.statbotics.io/",
    paragraphs: [
      "Statbotics established the way an FRC stats site presents teams, events and predictions, and SigmaScout follows that shape.",
      "EPA, Statbotics' rating, is one of the algorithms a visitor can select on SigmaScout; the picker names it \"EPA Statbotics\" followed by the version currently being served.",
      "SigmaScout's EPA is a from-scratch reimplementation over TBA data, not Statbotics' own code — done that way so EPA can be replayed walk-forward at any point in a season. Any place the two disagree is SigmaScout's reimplementation drifting, not a fault of Statbotics'; those differences are measured and written down.",
      "Statbotics' own published season accuracy is carried as a clearly-labelled reference figure inside SigmaScout's accuracy reporting, so SigmaScout's numbers are always shown next to the number they are trying to beat.",
    ],
  },
  {
    id: "frc-locks",
    name: "FRC Locks",
    href: "https://frclocks.com/",
    paragraphs: [
      "The idea behind SigmaScout's Districts page — showing whether a team's district championship spot is already mathematically locked, or already out of reach — came from FRC Locks.",
      "The concept is all that was taken. Every number on SigmaScout's Districts page is computed from TBA's published district point data and the official FIRST district point model. Nothing was fetched, scraped, or copied from FRC Locks.",
    ],
  },
  {
    id: "first",
    name: "FIRST",
    href: "https://www.firstinspires.org/",
    paragraphs: [
      "FIRST runs the FIRST Robotics Competition, and publishes the game manuals that define the ranking-point rules and the district point model SigmaScout implements.",
      "SigmaScout is an independent community project and is not affiliated with or endorsed by FIRST.",
    ],
  },
] as const;

/** The entry after whose paragraphs the internal link to the accuracy-comparison route renders. */
export const ACKNOWLEDGMENTS_ACCURACY_LINK_ENTRY_ID = "statbotics";

export const ACKNOWLEDGMENTS_PACKAGES: readonly { readonly package: string; readonly label: string }[] = [
  { package: "react", label: "React" },
  { package: "vite", label: "Vite" },
  { package: "tailwindcss", label: "Tailwind CSS" },
  { package: "@tanstack/react-router", label: "TanStack Router" },
  { package: "@tanstack/react-query", label: "TanStack Query" },
  { package: "recharts", label: "Recharts" },
  { package: "zod", label: "Zod" },
] as const;

export const ACKNOWLEDGMENTS_BUILT_WITH_TITLE = "Built with open source";

export const ACKNOWLEDGMENTS_BUILT_WITH_PARAGRAPHS: readonly string[] = [
  "SigmaScout itself is built on open-source software, including the projects below.",
  "SigmaScout is hosted on Cloudflare.",
];
