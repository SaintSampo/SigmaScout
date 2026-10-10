/**
 * The live facts guard of the offline district publisher (quick task 261009-ul3).
 *
 * WHAT IT PROTECTS. During a live district event the Worker writes facts into
 * `v1/district/{districtKey}.json`: who won a qualifying award, which point rows
 * exist, how far each event has got. `scripts/publishDistricts.ts` rebuilds the
 * same object from the corpus. When the corpus is OLDER than what the Worker has
 * already written, the upload takes those facts back, and nothing notices: the
 * Worker's next rankings request answers 304, so it never merges them again.
 * This module compares the published artifact with the one about to be
 * uploaded and names every fact the upload would lose, so the publisher can
 * refuse before its first write.
 *
 * THE SIX FACTS, each per event. `alliancesPicked`, `playoffsDone` or
 * `awardsPosted` true in the published artifact and not true in this run.
 * `qualMatchesPlayed` lower in this run. A `qualifyingAwards` entry (team,
 * event, award type) gone. An `eventPoints` row (team, event) gone. Nothing
 * else is compared: a lower point value on a row that is still there is not a
 * lost fact, and neither is `qualMatchesTotal`.
 *
 * WHAT IS NOT A REGRESSION. A district with no published object is a first
 * publish. A published body that is not JSON, or that fails
 * `DistrictArtifactSchema`, is a shape change: it is named in the output and it
 * is not compared. An identical artifact and a newer one are clean.
 *
 * WHICH EVENTS ARE COMPARED. An event is present in an artifact when any team
 * has an `eventPoints` row, a `remainingEvents` row or a `qualifyingAwards`
 * entry naming it. Only an event present in BOTH artifacts is compared. An
 * event only the published artifact names, or only this run names, is left
 * alone.
 *
 * ONE STATE PER EVENT, THE SAME FOLD ON BOTH SIDES. The state is not an event
 * level field. It sits on each (team, event) row, on `eventPoints` and on
 * `remainingEvents`, and it is optional. So an event's state is folded over
 * every row for that event that carries one: a flag is true when any such row
 * has it true, and `qualMatchesPlayed` is the largest value. Both producers
 * write one state to every row of an event, so the fold changes nothing for a
 * real artifact, and an identical artifact always compares clean.
 *
 * NO STATE ON THIS RUN'S SIDE IS THE STRICT SIDE. When the published fold
 * shows a true flag or a played count above zero and this run carries no state
 * for that event on any row, that is a regression, printed with this run's
 * value as `no state`. A published state of zero played and three false flags
 * against no state is not one: nothing is lost.
 *
 * A READ FAILURE REFUSES, AND THE OVERRIDE DOES NOT COVER IT. A 404 is a value
 * (the reader answers `null`). Any other read failure refuses a run that
 * uploads, with or without `--allow-regress`: the override still has to print
 * the list of facts it overrides, and that list cannot be built from an object
 * that was not read. In a dry run with `--check-live` (the `report` mode) a
 * read failure is printed and the check goes on, because that run uploads
 * nothing and never fails.
 *
 * This module does no I/O of its own and never reads the environment. The
 * reader and the logger are handed in, so every test runs without a network.
 */
import { DistrictArtifactSchema, type DistrictArtifact } from "../packages/harness/pageArtifacts.js";

export type DistrictRegressionKind =
  | "alliancesPicked"
  | "playoffsDone"
  | "awardsPosted"
  | "qualMatchesPlayed"
  | "eventPointsRow"
  | "qualifyingAward";

/** One fact the published artifact holds and this run's artifact would take back. */
export interface DistrictRegression {
  readonly districtKey: string;
  readonly eventKey: string;
  /** Present for the two per team kinds only (`eventPointsRow`, `qualifyingAward`). */
  readonly teamKey?: string;
  readonly kind: DistrictRegressionKind;
  /** The published value, rendered. */
  readonly live: string;
  /** This run's value, rendered. */
  readonly next: string;
}

/** The body text, `null` when no object exists at the key, a throw for any other failure. */
export type PublishedReader = (bucket: string, key: string) => Promise<string | null>;

/** Thrown when the publisher must not upload. Its message is what the operator reads last. */
export class DistrictPublishRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DistrictPublishRefusedError";
  }
}

export interface LiveFactsOutcome {
  /** Districts whose published artifact parsed and was compared. */
  readonly compared: number;
  /** Districts with no published object: a first publish. */
  readonly notPublished: number;
  /** Districts whose published body is not a district artifact this code can read: a shape change. */
  readonly unparsed: number;
  /** Districts whose published object could not be read. Above zero in `report` mode only: `enforce` throws instead. */
  readonly unreadable: number;
  readonly regressions: readonly DistrictRegression[];
  /** `true` only when there were regressions and `--allow-regress` let the run go on. */
  readonly overridden: boolean;
}

/** How many published objects are read at once. Two passes over every district of ten seasons then cost a few seconds. */
const READ_CHUNK_SIZE = 16;

const KIND_NAMES: Readonly<Record<DistrictRegressionKind, string>> = {
  alliancesPicked: "alliances picked",
  playoffsDone: "playoffs done",
  awardsPosted: "awards posted",
  qualMatchesPlayed: "qualification matches played",
  eventPointsRow: "points row",
  qualifyingAward: "recorded award winner",
};

/** The three flags, in the order their regressions are reported. */
const STATE_FLAGS = ["alliancesPicked", "playoffsDone", "awardsPosted"] as const;

/** One event's state, folded over every row that carries one. */
interface FoldedState {
  alliancesPicked: boolean;
  playoffsDone: boolean;
  awardsPosted: boolean;
  qualMatchesPlayed: number;
}

/** What one artifact says about one event, gathered in the artifact's own team order. */
interface EventFacts {
  /** `undefined` when no row for this event carries a state block. */
  state: FoldedState | undefined;
  /** The total of each team's `eventPoints` row here, keyed by team. Insertion order is team order. */
  readonly pointRows: Map<string, number>;
  /** Keyed by team and award type, so a repeated entry is one fact. Insertion order is team order. */
  readonly awards: Map<string, { readonly teamKey: string; readonly awardType: number; readonly label: string }>;
}

type RowState = NonNullable<DistrictArtifact["teams"][number]["eventPoints"][number]["state"]>;

function awardId(teamKey: string, awardType: number): string {
  return `${teamKey}\n${awardType}`;
}

function foldState(facts: EventFacts, state: RowState | undefined): void {
  if (state === undefined) return;
  if (facts.state === undefined) {
    facts.state = { alliancesPicked: false, playoffsDone: false, awardsPosted: false, qualMatchesPlayed: 0 };
  }
  for (const flag of STATE_FLAGS) {
    if (state[flag]) facts.state[flag] = true;
  }
  if (state.qualMatchesPlayed > facts.state.qualMatchesPlayed) facts.state.qualMatchesPlayed = state.qualMatchesPlayed;
}

/** Every event an artifact names, by the presence rule in this file's header, with the facts it holds there. */
function factsByEvent(artifact: DistrictArtifact): Map<string, EventFacts> {
  const byEvent = new Map<string, EventFacts>();
  const factsFor = (eventKey: string): EventFacts => {
    let facts = byEvent.get(eventKey);
    if (facts === undefined) {
      facts = { state: undefined, pointRows: new Map(), awards: new Map() };
      byEvent.set(eventKey, facts);
    }
    return facts;
  };
  for (const team of artifact.teams) {
    for (const row of team.eventPoints) {
      const facts = factsFor(row.eventKey);
      foldState(facts, row.state);
      if (!facts.pointRows.has(team.teamKey)) facts.pointRows.set(team.teamKey, row.total);
    }
    for (const row of team.remainingEvents) foldState(factsFor(row.eventKey), row.state);
    for (const award of team.qualifyingAwards) {
      const facts = factsFor(award.eventKey);
      const id = awardId(team.teamKey, award.awardType);
      if (!facts.awards.has(id)) facts.awards.set(id, { teamKey: team.teamKey, awardType: award.awardType, label: award.label });
    }
  }
  return byEvent;
}

/**
 * Every fact `live` (the published artifact) holds that `next` (this run's
 * artifact) would lose. Events are walked in ascending key order, and only the
 * events both artifacts name. Within an event the state facts come first (the
 * three flags, then the played count), then the point rows in the published
 * artifact's team order, then the award entries in that same order. An empty
 * list means the upload loses nothing.
 */
export function compareDistrictArtifacts(live: DistrictArtifact, next: DistrictArtifact): DistrictRegression[] {
  const liveFacts = factsByEvent(live);
  const nextFacts = factsByEvent(next);
  const shared = [...liveFacts.keys()].filter((eventKey) => nextFacts.has(eventKey)).sort();
  const districtKey = next.districtKey;
  const regressions: DistrictRegression[] = [];

  for (const eventKey of shared) {
    const was = liveFacts.get(eventKey)!;
    const now = nextFacts.get(eventKey)!;

    // The event state. Nothing can be lost when the published side carries none.
    if (was.state !== undefined) {
      for (const flag of STATE_FLAGS) {
        if (was.state[flag] && now.state?.[flag] !== true) {
          regressions.push({ districtKey, eventKey, kind: flag, live: "true", next: now.state === undefined ? "no state" : "false" });
        }
      }
      // No state on this run's side counts as zero played.
      if (was.state.qualMatchesPlayed > (now.state?.qualMatchesPlayed ?? 0)) {
        regressions.push({
          districtKey,
          eventKey,
          kind: "qualMatchesPlayed",
          live: String(was.state.qualMatchesPlayed),
          next: now.state === undefined ? "no state" : String(now.state.qualMatchesPlayed),
        });
      }
    }

    // A points row (team, event) the published artifact holds and this run does
    // not. Row presence only. A team missing from this run has none.
    for (const [teamKey, total] of was.pointRows) {
      if (now.pointRows.has(teamKey)) continue;
      regressions.push({ districtKey, eventKey, teamKey, kind: "eventPointsRow", live: `a row totalling ${total}`, next: "absent" });
    }

    // A recorded award winner (team, event, award type) the published artifact
    // holds and this run does not. A team missing from this run has none.
    for (const [id, award] of was.awards) {
      if (now.awards.has(id)) continue;
      regressions.push({
        districtKey,
        eventKey,
        teamKey: award.teamKey,
        kind: "qualifyingAward",
        live: `${award.label} (award type ${award.awardType})`,
        next: "absent",
      });
    }
  }
  return regressions;
}

/** One fact as one line, with the prefix every other line of the publisher carries. */
export function formatDistrictRegression(regression: DistrictRegression): string {
  const where =
    `district ${regression.districtKey}, event ${regression.eventKey}` + (regression.teamKey === undefined ? "" : `, team ${regression.teamKey}`);
  return `publishDistricts: this run would lose a live fact: ${where}, ${KIND_NAMES[regression.kind]}: live ${regression.live}, this run ${regression.next}`;
}

type ReadResult = { readonly ok: true; readonly body: string | null } | { readonly ok: false; readonly message: string };

/**
 * Reads the published artifact of every district in `details`, compares each
 * with the artifact about to be uploaded, and prints what it found: one
 * summary line holding the stage, then one line per fact.
 *
 * | mode    | allowRegress | a read fails                           | regressions found                         |
 * |---------|--------------|----------------------------------------|-------------------------------------------|
 * | enforce | false        | throws, naming the first failing key   | prints each line, throws                  |
 * | enforce | true         | the same throw                         | prints each line and one override line    |
 * | report  | ignored      | prints the key and the error, goes on  | prints each line, returns                 |
 *
 * Every throw is a `DistrictPublishRefusedError`. Reads go `READ_CHUNK_SIZE` at
 * a time and the results are handled in input order, so the output is the same
 * on every run. In `enforce` mode a read failure throws once its chunk has
 * settled, naming the first failing key in input order, and no later chunk is
 * read.
 */
export async function guardLivePublish(args: {
  /** Printed, for example "before the bake". */
  readonly stage: string;
  readonly bucket: string;
  readonly details: ReadonlyArray<{ readonly key: string; readonly artifact: DistrictArtifact }>;
  readonly read: PublishedReader;
  readonly log: (line: string) => void;
  /** `enforce` for a run that uploads. `report` for a dry run with `--check-live`, which never fails. */
  readonly mode: "enforce" | "report";
  /** `true` under `--allow-regress`. Read in `enforce` mode only, and never for a read failure. */
  readonly allowRegress: boolean;
}): Promise<LiveFactsOutcome> {
  let compared = 0;
  let notPublished = 0;
  let unparsed = 0;
  let unreadable = 0;
  const regressions: DistrictRegression[] = [];

  for (let start = 0; start < args.details.length; start += READ_CHUNK_SIZE) {
    const chunk = args.details.slice(start, start + READ_CHUNK_SIZE);
    // Every read is caught into a result, so no rejection is left unhandled
    // while the rest of its chunk is still in flight.
    const results = await Promise.all(
      chunk.map(async (detail): Promise<ReadResult> => {
        try {
          return { ok: true, body: await args.read(args.bucket, detail.key) };
        } catch (cause) {
          // The message only: never the error object or a stack.
          return { ok: false, message: cause instanceof Error ? cause.message : String(cause) };
        }
      })
    );

    for (let index = 0; index < chunk.length; index += 1) {
      const detail = chunk[index]!;
      const result = results[index]!;
      if (!result.ok) {
        if (args.mode === "enforce") {
          throw new DistrictPublishRefusedError(
            `publishDistricts: refused ${args.stage}. Nothing was uploaded. The published "${detail.key}" could not be read: ${result.message}. A run that cannot read what is live does not publish, and --allow-regress does not change that.`
          );
        }
        unreadable += 1;
        args.log(`publishDistricts: the published "${detail.key}" could not be read: ${result.message}. It is not compared.`);
        continue;
      }
      if (result.body === null) {
        notPublished += 1;
        continue;
      }
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(result.body);
      } catch {
        unparsed += 1;
        args.log(`publishDistricts: the published "${detail.key}" is not JSON. That is a shape change, not a regression, so it is not compared.`);
        continue;
      }
      const parsed = DistrictArtifactSchema.safeParse(parsedJson);
      if (!parsed.success) {
        unparsed += 1;
        args.log(
          `publishDistricts: the published "${detail.key}" does not parse as a district artifact. That is a shape change, not a regression, so it is not compared.`
        );
        continue;
      }
      compared += 1;
      regressions.push(...compareDistrictArtifacts(parsed.data, detail.artifact));
    }
  }

  args.log(
    `publishDistricts: live check ${args.stage}: ${compared} district(s) compared, ${notPublished} not published yet, ${unparsed} not parseable, ${unreadable} unreadable, ${regressions.length} live fact(s) this run would lose`
  );
  for (const regression of regressions) args.log(formatDistrictRegression(regression));

  if (regressions.length === 0 || args.mode === "report") {
    return { compared, notPublished, unparsed, unreadable, regressions, overridden: false };
  }
  if (args.allowRegress) {
    args.log(`publishDistricts: --allow-regress was given, so the ${regressions.length} live fact(s) listed above will be overwritten by this run.`);
    return { compared, notPublished, unparsed, unreadable, regressions, overridden: true };
  }
  throw new DistrictPublishRefusedError(
    `publishDistricts: refused ${args.stage}. Nothing was uploaded. This run would lose ${regressions.length} live fact(s), listed above: the corpus is older than what is live, so run the ingest first and publish again. See "The offline district publish reads what is live first" in docs/worker-operations.md.`
  );
}
