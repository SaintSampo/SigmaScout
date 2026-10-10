/**
 * WHO IS IN THE DISTRICT CHAMPIONSHIP FIELD, shown over the verdicts on the
 * Live view (quick task 261005-04t, D-06).
 *
 * THE RULE JACOB APPROVED, 2026-10-05:
 *
 * - Any rewound moment, and any time before the District Championship starts:
 *   district event points only. That is the raw verdict model
 *   `computeDistrictLedgerStatuses` returns, and this module hands it back
 *   untouched.
 * - Once the championship has started AND ITS FIELD IS PROVEN, on the Live
 *   view only, who is in its field decides what the tab SHOWS: a team in the
 *   field reads Locked, a team that earned a place and is not in the field
 *   reads Declined, and every other team reads Locked out.
 *
 * WHY IT WAITS FOR THE PROVEN FIELD (quick task 261010-66y). The artifact
 * carries no event list: it learns a championship key only from team rows.
 * When TBA posts one division, or one of two championships, before the
 * others, the one the artifact knows has started while most of the field is
 * on no row. Applied there, the overlay showed every team of the unposted
 * events, all of whom had earned their place, as Declined for the minutes
 * until their rows landed, and then Locked again. Walked on the real 2026
 * artifacts through the two merge entry points: 119 FIM teams shown Locked,
 * then Declined, then Locked, 46 in NE and 55 in California. That is a Locked
 * taken back. So the overlay applies only once the field is proven by the one
 * core rule (`packages/core/districts/dcmpFieldProof.ts`: every field fixing
 * key started, every one carrying a posted row, and the field complete by
 * capacity, by a posted finals row or, in a season that is over, by Awards
 * final). Until then the raw verdicts stand. That also holds with every team
 * registered and no row posted yet: the raw verdicts stand until TBA posts
 * the championship's rows.
 *
 * WHY THIS IS A LAYER OVER THE VERDICTS AND NOT PART OF THEM. Locked, Locked
 * out and Prequalified in the raw model are GUARANTEES: statements `locks.ts`
 * proves from points and capacity, true whatever happens next. The field is a
 * FACT about who turned up. A team can earn a place and give it up, and a team
 * below the line can be invited into the place it gave up. Folding that fact
 * into the verdicts would make a guarantee depend on an attendance list, and
 * would hand Declined to every consumer that needs the guarantee: the
 * advancement chance run, the predicted cutoff, the Champ Locks tab and the
 * measurement scripts. So they keep reading the raw model and never call this
 * module, and by type the raw model cannot hold Declined at all.
 *
 * WHAT THE OVERLAY CHANGES: the displayed `status` and `byAward`, and the chip
 * counts. `verdict` and `lockedBy` on every result stay the raw guarantee.
 *
 * IT MAKES NO CLAIM ABOUT WHY a team is absent. Declined means "earned a place
 * and is not in the field", which is all the artifact can show.
 *
 * Pure: no React, no Worker type, and no status rule of `locks.ts`'s restated.
 */
import { dcmpFieldProof } from "../../../../../packages/core/districts/dcmpFieldProof.js";
import type { DistrictArtifact } from "../../../../../packages/harness/pageArtifacts.js";
import { deriveStageFromState, districtTierEvents, liveStageByEvent, tierEvents, type DistrictStageFinality } from "./districtLedgerRows.js";
import type { DistrictLedgerStatusKey, DistrictLedgerStatusModel, DistrictLedgerStatusResult } from "./districtLedgerStatus.js";

type DistrictTeam = DistrictArtifact["teams"][number];

/** The six chip keys in chip order: the raw model's five, with Declined between Locked and In range. */
export const DISTRICT_LEDGER_SHOWN_STATUS_KEYS = ["prequalified", "locked", "declined", "inRange", "outOfRange", "lockedOut"] as const;

export type DistrictLedgerShownStatusKey = (typeof DISTRICT_LEDGER_SHOWN_STATUS_KEYS)[number];

/** Every state a team can be SHOWN in, including the one that carries no chip. */
export type DistrictLedgerShownState = DistrictLedgerShownStatusKey | "capacityUnknown";

/**
 * The chip counts as shown. `declined` is OPTIONAL ON PURPOSE: a raw five key
 * counts object satisfies this type as it is, so the raw model, the champ
 * tier's model and every hand built model in a test pass through unedited. It
 * is present exactly when the overlay is active.
 */
export type DistrictLedgerShownCounts = Readonly<Record<DistrictLedgerStatusKey, number>> & { readonly declined?: number };

/** One team's SHOWN result. `verdict` and `lockedBy` are still the raw guarantee. */
export interface DistrictLedgerShownResult extends Omit<DistrictLedgerStatusResult, "status"> {
  readonly status: DistrictLedgerShownState;
}

/** The model the District tab's chips, filters and Status cells read. Every field but the three below is the raw model's own. */
export interface DistrictLedgerShownModel extends Omit<DistrictLedgerStatusModel, "byTeam" | "counts"> {
  readonly byTeam: ReadonlyMap<string, DistrictLedgerShownResult>;
  readonly counts: DistrictLedgerShownCounts;
  /** True when the field decided what is shown. False means `byTeam` and `counts` ARE the raw model's own objects. */
  readonly fieldOverlay: boolean;
}

export interface ChampionshipFieldOverlayOptions {
  /** Whether the tab is at its Live position. Absent reads as false: no caller gets the overlay without asking for it. */
  readonly atLive?: boolean;
  /**
   * The calendar year at the time of the call, for the field proof's season
   * over line (quick task 261010-66y). Defaults to the clock; a test passes
   * it.
   */
  readonly nowYear?: number;
}

/**
 * Whether the District Championship has started: some team's dcmp tier entry,
 * in `eventPoints` or `remainingEvents`, carries a state that reads started.
 *
 * An entry with NO state block does not count. That is a pre republish
 * artifact, and guessing "started" from points alone would switch the overlay
 * on for an artifact that cannot say who is in the field.
 */
export function championshipHasStarted(artifact: DistrictArtifact): boolean {
  for (const team of artifact.teams) {
    for (const entry of tierEvents(team, "dcmp")) {
      if (deriveStageFromState(entry.state).started) return true;
    }
  }
  return false;
}

/**
 * Whether one team is PLAYING the District Championship.
 *
 * 1. A dcmp tier `eventPoints` entry with qualification plus alliance plus
 *    playoff points above zero: playing. Those three are earned on the field.
 * 2. A dcmp tier `eventPoints` entry with award points above zero and none of
 *    those three: NOT playing through that entry. An award only invitee attends
 *    and can win an award there.
 * 3. A dcmp tier `eventPoints` entry whose four categories are ALL ZERO:
 *    - while the event's qualification NUMBER is not final it is POINTS NOT
 *      YET REPORTED, and is read exactly as rule 4 reads a `remainingEvents`
 *      entry. A live championship can publish the row before any points
 *      land, and reading that empty row as "not playing" would show a team
 *      that earned its place as Declined, and a late entry as Locked out,
 *      during the championship itself;
 *    - once the event's qualification number is final, zero qualification
 *      points is a result and not a gap: NOT playing through that entry.
 *
 *    THIS RULE ASKS WHETHER A NUMBER IS FINAL, so it takes the NUMBER reading
 *    (quick task 261009-vp9), not the field's. "Is this zero a result or a
 *    gap" is a question about TBA's points, and the event's state says only
 *    that qualification is over on the field. The state comes from the match
 *    feed and can run ahead of the district rankings, and for those minutes
 *    every row of the championship is still all zero: read from the state
 *    alone, every team that earned its place would be shown Declined. So
 *    where `liveStage` is supplied (the overlay always supplies it), a row's
 *    qualification is finished only when the live stage of its event says so
 *    (`liveStageByEvent`: the state AND a row with alliance points at the
 *    event), and an event absent from the map reads as not finished. With no
 *    `liveStage` the function reads the entry's own `state`, as it always
 *    has, where an absent state counts as not finished.
 * 4. NO dcmp tier `eventPoints` entry at all (points not yet reported for this
 *    team): PROVISIONALLY playing when it has a dcmp tier `remainingEvents`
 *    entry, UNLESS it did not earn a place (`earnedPlace` false) AND it holds a
 *    qualifying award with `awardOnly` true from one of its own district tier
 *    events. That exception is the award only invitee before any points are
 *    reported.
 * 5. No championship entry of either kind: not playing.
 *
 * Each `eventPoints` entry is read on its own, so where a team carries more
 * than one championship row the strongest reading wins: playing, then points
 * not yet reported, then not playing.
 *
 * `earnedPlace` is whether the team's raw verdict is `locked` or `lockedAward`.
 */
export function isPlayingChampionship(team: DistrictTeam, earnedPlace: boolean, liveStage?: ReadonlyMap<string, { readonly qual: boolean }>): boolean {
  let reported = false;
  let pointsNotYetReported = false;
  for (const entry of team.eventPoints) {
    if (entry.tier !== "dcmp") continue;
    if (entry.qual + entry.alliance + entry.elim > 0) return true;
    // Whether the event's qualification NUMBER is final (rule 3): the live
    // stage where the caller supplies it, the entry's own state otherwise.
    const qualFinal = liveStage === undefined ? deriveStageFromState(entry.state).final.qual : (liveStage.get(entry.eventKey)?.qual ?? false);
    if (entry.award === 0 && !qualFinal) pointsNotYetReported = true;
    else reported = true;
  }

  if (!pointsNotYetReported) {
    if (reported) return false;
    if (!team.remainingEvents.some((entry) => entry.tier === "dcmp")) return false;
  }
  if (earnedPlace) return true;

  const districtTierEventKeys = new Set(districtTierEvents(team).map((entry) => entry.eventKey));
  const awardOnlyInvitee = team.qualifyingAwards.some((award) => award.awardOnly && districtTierEventKeys.has(award.eventKey));
  return !awardOnlyInvitee;
}

/**
 * Whether the championship field is PROVEN at Now, by the one core rule
 * (`dcmpFieldProof`, quick task 261010-66y): the started keys from each
 * championship entry's own state, the awards final keys from the number
 * reading the overlay already builds.
 */
function championshipFieldProven(artifact: DistrictArtifact, liveStage: ReadonlyMap<string, DistrictStageFinality>, nowYear: number): boolean {
  const startedKeys = new Set<string>();
  for (const team of artifact.teams) {
    for (const entry of tierEvents(team, "dcmp")) if (deriveStageFromState(entry.state).started) startedKeys.add(entry.eventKey);
  }
  const awardsFinalKeys = new Set<string>();
  for (const [eventKey, final] of liveStage) if (final.award) awardsFinalKeys.add(eventKey);
  return dcmpFieldProof({ teams: artifact.teams, dcmpSlots: artifact.dcmpSlots, season: artifact.year, nowYear, startedKeys, awardsFinalKeys }).proven;
}

/**
 * THE OVERLAY. A separate pure function over the raw model.
 *
 * IT APPLIES ONLY WHEN ALL FOUR HOLD: the caller passes `atLive: true`, the
 * artifact publishes `dcmpSlots`, the championship has started, and its field
 * is proven (`championshipFieldProven`, quick task 261010-66y). The fourth is
 * what keeps a team that earned its place from reading Declined for the
 * minutes before its division's, or its championship's, rows are posted.
 * Otherwise it returns the raw model's OWN `byTeam` map and `counts` object
 * with `fieldOverlay` false, so an inactive overlay is provably a no op.
 *
 * ACTIVE, per team:
 * - a prequalified result passes through as the same object;
 * - playing reads `locked`, `byAward` true exactly when the raw verdict is
 *   `lockedAward`;
 * - not playing with a raw verdict of `locked` or `lockedAward` reads
 *   `declined`, never by award;
 * - everyone else reads `lockedOut`. That includes a team tied on the line that
 *   is not playing and an award only attendee.
 *
 * So under the overlay no team reads In range or Out of range, and both counts
 * are zero; the chips drop those two keys rather than print 0 and 0. A team
 * key the artifact does not carry is not playing.
 */
export function applyChampionshipFieldOverlay(
  statuses: DistrictLedgerStatusModel,
  artifact: DistrictArtifact,
  options: ChampionshipFieldOverlayOptions = {}
): DistrictLedgerShownModel {
  const started = options.atLive === true && artifact.dcmpSlots !== null && championshipHasStarted(artifact);
  if (!started) return { ...statuses, fieldOverlay: false };

  // The NUMBER reading of every championship event, built once and only
  // once the three cheap conditions hold (quick task 261009-vp9, rule 3
  // above). The field proof reads its awards, and the per team rule below its
  // qualification.
  const liveStage = liveStageByEvent(artifact, ["dcmp"]);
  if (!championshipFieldProven(artifact, liveStage, options.nowYear ?? new Date().getUTCFullYear())) return { ...statuses, fieldOverlay: false };

  const sourceByKey = new Map(artifact.teams.map((team) => [team.teamKey, team] as const));
  const byTeam = new Map<string, DistrictLedgerShownResult>();
  const counts = { prequalified: 0, locked: 0, declined: 0, inRange: 0, outOfRange: 0, lockedOut: 0 };

  for (const [teamKey, raw] of statuses.byTeam) {
    if (raw.status === "prequalified") {
      counts.prequalified += 1;
      byTeam.set(teamKey, raw);
      continue;
    }
    const earnedPlace = raw.verdict === "locked" || raw.verdict === "lockedAward";
    const source = sourceByKey.get(teamKey);
    const playing = source !== undefined && isPlayingChampionship(source, earnedPlace, liveStage);
    if (playing) {
      counts.locked += 1;
      byTeam.set(teamKey, { ...raw, status: "locked", byAward: raw.verdict === "lockedAward" });
    } else if (earnedPlace) {
      counts.declined += 1;
      byTeam.set(teamKey, { ...raw, status: "declined", byAward: false });
    } else {
      counts.lockedOut += 1;
      byTeam.set(teamKey, { ...raw, status: "lockedOut", byAward: false });
    }
  }

  return { ...statuses, byTeam, counts, fieldOverlay: true };
}
