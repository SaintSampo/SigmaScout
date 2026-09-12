/**
 * PCM data loading.
 *
 * PCM (Phase-Component Model) is an EXPERIMENT, not a shipped algorithm. It
 * asks one question: does predicting an alliance's output as the SUM of three
 * separately-filtered phase ratings (auto + teleop + endgame) beat filtering
 * the total directly, which is what BPR does today?
 *
 * THE POPULATION IS BPR'S, BY CONSTRUCTION. This file does not run its own
 * match query. It calls `packages/spr/data.ts`'s `loadMatches` -- a SEALED path
 * it must never modify -- and attaches phase outputs to those exact rows by
 * match key. Re-deriving the row set here would risk the precise divergence
 * quick task 260908-vqr already found once (a private BPR query that dropped
 * `event_type = 100` rows, making BPR's numbers incomparable to every other
 * algorithm's). Because the base rows ARE BPR's rows, in BPR's order, the
 * paired comparison between the two arms is exact rather than approximate.
 *
 * The only thing added is `score_breakdown_raw`, which `loadMatches` reads for
 * its foul/adjust correction and then drops. PCM needs it kept, because the
 * phase split is a per-season `score_breakdown` field read.
 */
import { openCorpusReadOnly } from "../corpus/db.js";
import { loadMatches, type BprMatch } from "../spr/data.js";
import {
  COMPONENT_GROUP_IDS,
  componentGroupsForSeason,
  componentsInGroup,
  type ComponentGroupId,
} from "../core/algorithms/breakdown/groups.js";
import { tryParseBreakdownPair } from "../core/algorithms/breakdown/index.js";

/** One alliance's points in each phase, for one match. */
export type PhaseOutputs = Readonly<Record<ComponentGroupId, number>>;

/**
 * Why a match carries no phase outputs. Reported rather than collapsed into a
 * single `null`, because the four causes have genuinely different meanings and
 * only one of them is a corpus problem:
 *
 *  - `parsed`       -- phases available.
 *  - `absent`       -- TBA published no `score_breakdown` for the match.
 *  - `malformed`    -- a breakdown that fails its season's Zod schema.
 *  - `unregistered` -- the season has no declared component grouping, so there
 *                      is nothing to sum. `componentMapForSeason` THROWS for an
 *                      unregistered season, so this case is checked BEFORE the
 *                      parse rather than caught after it: a future season that
 *                      lands in the corpus before `groups.ts` registers it must
 *                      degrade to "not measurable", never take the replay down.
 */
export type BreakdownStatus = "parsed" | "absent" | "malformed" | "unregistered";

export interface PcmMatch extends BprMatch {
  /** `null` whenever `breakdownStatus !== "parsed"`. Never a zero-filled record. */
  readonly redPhase: PhaseOutputs | null;
  readonly bluePhase: PhaseOutputs | null;
  readonly breakdownStatus: BreakdownStatus;
}

/** One alliance's output in one phase: that phase's declared components, summed. */
function phaseOutput(
  components: Readonly<Record<string, number>>,
  season: number,
  phase: ComponentGroupId,
): number {
  let total = 0;
  for (const name of componentsInGroup(season, phase)) total += components[name] ?? 0;
  return total;
}

function phaseOutputs(components: Readonly<Record<string, number>>, season: number): PhaseOutputs {
  const out = {} as Record<ComponentGroupId, number>;
  for (const phase of COMPONENT_GROUP_IDS) out[phase] = phaseOutput(components, season, phase);
  return out;
}

export interface YearCoverage {
  readonly parsed: number;
  readonly n: number;
}

export interface YearResidual {
  /**
   * Mean per-alliance `correctedTotal - (auto + teleop + endgame)`. This is the
   * "components do not sum to the scoring target" gap made numeric instead of
   * asserted: ungrouped components (`adjust`, `foulsCommitted`) plus anything a
   * season's declared grouping omits land here.
   */
  readonly meanResidual: number;
  /**
   * Mean `|redResidual - blueResidual|`. A residual that is large but SYMMETRIC
   * between alliances cancels in the margin, and the margin is the only thing a
   * winner prediction depends on -- so this, not `meanResidual`, is the number
   * that says whether the gap can actually move a prediction.
   */
  readonly meanAbsAsymmetry: number;
  readonly n: number;
}

export interface PhaseDiagnostics {
  readonly n: number;
  readonly byStatus: Readonly<Record<BreakdownStatus, number>>;
  /** Per-year parsed/total, so a coverage hole is attributable to a season. */
  readonly perYear: ReadonlyMap<number, YearCoverage>;
  readonly perYearResidual: ReadonlyMap<number, YearResidual>;
}

let lastPhaseDiagnostics: PhaseDiagnostics | null = null;

/** Diagnostics from the most recent `loadPcmMatches` call. */
export function phaseDiagnostics(): PhaseDiagnostics | null {
  return lastPhaseDiagnostics;
}

/**
 * BPR's rows, in BPR's order, with phase outputs attached.
 *
 * Raw breakdowns are pulled in ONE keyed query rather than per row: the corpus
 * is ~580MB and a per-row lookup over the full match table is the difference
 * between seconds and minutes.
 */
export function loadPcmMatches(corpusPath: string): PcmMatch[] {
  const base = loadMatches(corpusPath);

  const raws = new Map<string, string | null>();
  const db = openCorpusReadOnly(corpusPath);
  try {
    const rows = db
      .prepare<[], { match_key: string; score_breakdown_raw: string | null }>(
        `select match_key, score_breakdown_raw from matches`,
      )
      .all();
    for (const r of rows) raws.set(r.match_key, r.score_breakdown_raw);
  } finally {
    db.close();
  }

  const byStatus: Record<BreakdownStatus, number> = {
    parsed: 0,
    absent: 0,
    malformed: 0,
    unregistered: 0,
  };
  const perYear = new Map<number, { parsed: number; n: number }>();
  const residual = new Map<number, { sum: number; absAsym: number; n: number }>();

  const out: PcmMatch[] = [];
  for (const m of base) {
    let status: BreakdownStatus;
    let redPhase: PhaseOutputs | null = null;
    let bluePhase: PhaseOutputs | null = null;

    if (componentGroupsForSeason(m.year) === undefined) {
      status = "unregistered";
    } else {
      const parsed = tryParseBreakdownPair(m.year, raws.get(m.matchKey) ?? null);
      if (parsed.kind === "parsed") {
        status = "parsed";
        redPhase = phaseOutputs(parsed.red, m.year);
        bluePhase = phaseOutputs(parsed.blue, m.year);
      } else {
        status = parsed.kind;
      }
    }

    byStatus[status] += 1;
    const y = perYear.get(m.year) ?? { parsed: 0, n: 0 };
    y.n += 1;
    if (status === "parsed") y.parsed += 1;
    perYear.set(m.year, y);

    if (redPhase !== null && bluePhase !== null) {
      const rRed = m.redOut - (redPhase.auto + redPhase.teleop + redPhase.endgame);
      const rBlue = m.blueOut - (bluePhase.auto + bluePhase.teleop + bluePhase.endgame);
      const acc = residual.get(m.year) ?? { sum: 0, absAsym: 0, n: 0 };
      acc.sum += rRed + rBlue;
      acc.absAsym += Math.abs(rRed - rBlue);
      acc.n += 1;
      residual.set(m.year, acc);
    }

    out.push({ ...m, redPhase, bluePhase, breakdownStatus: status });
  }

  const perYearResidual = new Map<number, YearResidual>();
  for (const [year, acc] of residual) {
    perYearResidual.set(year, {
      // Divided by 2n: `sum` accumulates BOTH alliances, and the quantity of
      // interest is the mean residual of ONE alliance.
      meanResidual: acc.n > 0 ? acc.sum / (2 * acc.n) : 0,
      meanAbsAsymmetry: acc.n > 0 ? acc.absAsym / acc.n : 0,
      n: acc.n,
    });
  }

  lastPhaseDiagnostics = { n: out.length, byStatus, perYear, perYearResidual };
  return out;
}

export type PhasedMatch = PcmMatch & { redPhase: PhaseOutputs; bluePhase: PhaseOutputs };

/** True when both alliances have phase outputs, i.e. the match can train PCM. */
export function hasPhases(m: PcmMatch): m is PhasedMatch {
  return m.redPhase !== null && m.bluePhase !== null;
}
