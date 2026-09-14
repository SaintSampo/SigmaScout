/**
 * Content-as-data for the `/methodology/acknowledgments` page.
 * `AcknowledgmentsPage.tsx` maps this array to `<section>` elements — the
 * single source of names, links and prose — so
 * `methodology.acknowledgments.test.tsx` can iterate this constant
 * structurally rather than hand-typing a second copy.
 *
 * Audience: the same FRC community (students, mentors, scouts) the rest of
 * the site is written for. Gracious, specific, plain language, short
 * sentences — say WHAT each project contributed, not that it is "great".
 *
 * Every claim below must stay traceable to a real, checkable fact about
 * this repo or the credited project — do not add a claim that cannot be
 * verified against the current codebase.
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
  "SigmaScout is built on work other people did first: the data, the ratings it measures itself against, and the ideas behind several of its pages. This page says who, and what each one contributed.";

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
      "SigmaScout's EPA is a from-scratch reimplementation over TBA data, not Statbotics' own code. It was done that way so EPA can be replayed walk-forward at any point in a season. Any place the two disagree is SigmaScout's reimplementation drifting, not a fault of Statbotics'; those differences are measured and written down.",
      "Statbotics' own published season accuracy is carried as a clearly-labelled reference figure inside SigmaScout's accuracy reporting, so SigmaScout's numbers are always shown next to the number they are trying to beat.",
    ],
  },
  {
    id: "frc-locks",
    name: "FRC Locks",
    href: "https://frclocks.com/",
    paragraphs: [
      "The idea behind SigmaScout's Districts page (showing whether a team's district championship spot is already mathematically locked, or already out of reach) came from FRC Locks.",
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
