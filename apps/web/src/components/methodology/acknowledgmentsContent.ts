/**
 * Content-as-data for the `/methodology/acknowledgments` page.
 * `AcknowledgmentsPage.tsx` maps this array to `<section>` elements — the
 * single source of names, links and prose — so
 * `methodology.acknowledgments.test.tsx` can iterate this constant
 * structurally rather than hand-typing a second copy.
 *
 * Audience: the same FRC community (students, mentors, scouts) the rest of
 * the site is written for. Voice is Jacob's pick from sketch 014: third
 * person, flat and factual, one sentence per fact, in the manner of
 * Statbotics' own blurbs. The rendered copy carries NO hyphen or dash
 * characters ("district points", not "district-points").
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

export const ACKNOWLEDGMENTS_LEAD = "SigmaScout builds on the work of several FRC community projects.";

export const ACKNOWLEDGMENTS_ENTRIES: readonly AcknowledgmentEntry[] = [
  {
    id: "the-blue-alliance",
    name: "The Blue Alliance",
    href: "https://www.thebluealliance.com/",
    paragraphs: [
      "All match, event, team, ranking, award and district points data comes from The Blue Alliance API.",
    ],
  },
  {
    id: "statbotics",
    name: "Statbotics",
    href: "https://www.statbotics.io/",
    paragraphs: [
      "Statbotics set the standard for FRC match prediction. SigmaScout is heavily influenced by it.",
      "EPA is available in the algorithm picker. The SigmaScout version is an independent reimplementation on TBA data, so any difference from Statbotics is an error on this side. Statbotics' published accuracy is shown as a reference in the accuracy comparison.",
    ],
  },
  {
    id: "frc-locks",
    name: "FRC Locks",
    href: "https://frclocks.com/",
    paragraphs: [
      "The Districts page borrows the lock concept from FRC Locks. All numbers are computed independently. Calculations are based on TBA district points and the FIRST district points model.",
      "One of the two lock tests follows the argument set out in District Points Analysis: Mathematical Locks for Advancement, by Liatys and Papa. A team is locked when the points a district still has to hand out cannot lift enough rivals past it.",
    ],
  },
  {
    id: "first",
    name: "FIRST",
    href: "https://www.firstinspires.org/",
    paragraphs: [
      "FIRST runs the FIRST Robotics Competition and publishes the game manuals that define the ranking point and district point rules used here. SigmaScout is not affiliated with or endorsed by FIRST.",
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

export const ACKNOWLEDGMENTS_BUILT_WITH_TITLE = "Built with";

/** Rendered on the same line as the package list, after it. */
export const ACKNOWLEDGMENTS_BUILT_WITH_HOSTING = "Hosted on Cloudflare.";
