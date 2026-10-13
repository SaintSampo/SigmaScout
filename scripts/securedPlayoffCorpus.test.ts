/**
 * THE CORPUS HALF of the playoff pay rule and the secured minimum (quick task
 * 261012-mw2, CONTEXT D1, D2 and D5): the rule against every playoff value
 * TBA has paid, and the secured minimum at every position of every bracket.
 *
 *   "It is mission critical that no team is told they are locked at any stop,
 *   and then later they are not locked."                    (Jacob, 2026-10-08)
 *
 * The secured minimum is made to join a team's FLOOR in the lock math of both
 * Locks tabs. A floor that is ever above what the team finally holds is a Locked
 * that can be taken back. So the gate here is one sided and exact: over every
 * district points event of every REGISTERED bracket season with an alliance
 * list in `data/corpus.sqlite` (2023 to 2026 when this was written), at EVERY
 * prefix of the event's decisive playoff rows, no team's secured minimum is
 * above the playoff points TBA finally paid it, and none is lower than at the
 * prefix before.
 *
 * THE SEASONS COME FROM `BRACKET_REGISTERED_SEASONS`, and no last year is
 * written into this file (orchestrator addendum D7). A season registered
 * later is read without an edit here: its events join the gates, the fit
 * table files them under the season's DECLARED rule, and the pinned counts
 * below then fail until they are read again, which is the point. Test 7
 * holds that no registered season was passed over. A NEW SEASON'S DECLARED
 * RULE MUST PASS THIS FILE ON THAT SEASON'S FIRST FINISHED EVENTS BEFORE THE
 * CREDIT CAN BE TRUSTED FOR IT.
 *
 * WHAT EACH TEST HOLDS:
 *
 *   1. THE FIT TABLE (D1). `playoffPointsPaid` over each event's whole rows
 *      against TBA's own `elim_points`, per rule and per kind of event, with
 *      every count pinned. The rows are mapped to alliances HERE by TBA's own
 *      reading (the first of the side's three robots that a pick list names),
 *      so this test shares no mapping with the tab.
 *   2. THE GATE ON THE RULE (D2). `securedPlayoffPoints` at every prefix, in
 *      schedule order and in clock order, every bracket size.
 *   3. THE GATE ON THE TAB'S OWN READER (D2). `securedElimByTeamFor`, the
 *      rows module's reader and the one function a Locks tab's credit comes
 *      from, at every prefix of every eight alliance event, with the tab's
 *      own mapping of a side to its alliance.
 *   4. THE FACTS THE READING RESTS ON, counted: tied rows, Finals overtime,
 *      disqualified sides, sets with two decisive rows, robots no list names.
 *   5. WHAT THE RULE IS NOT: the reading this task started from (the
 *      placement value times the matches a robot played over the matches its
 *      alliance played) against the same paid values.
 *   6. THE CELL NEVER PROMISES MORE THAN ITS OWN RUN DRAWS. An open Playoffs
 *      cell prints "at least N" beside a chance that comes from the tab's
 *      simulation. On the eight 2026 PNW district event fixtures, at every
 *      playoff round stop, built and simulated by the tab's own functions, no
 *      draw of a cell's distribution is below its N.
 *   7. NO REGISTERED SEASON IS PASSED OVER. A census of the corpus taken
 *      apart from the loader (its own query, no season filter at all) counts
 *      each season's finished brackets with paid values. Every registered
 *      season that has one must have at least one event COMPARED in each of
 *      gates 1, 2 and 3. A registered season the corpus holds no finished
 *      bracket of is printed by name and not failed: its declared rule is
 *      not measured yet.
 *
 * LOCAL DATA GATED. `data/corpus.sqlite` is gitignored. Where it is absent
 * this file skips with a message, and with `REQUIRE_LOCAL_DATA=1` in the
 * environment it FAILS instead, so a gate run can never pass by skipping.
 * `packages/core/districts/securedPlayoffPoints.test.ts` is the pure half
 * that runs everywhere.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openCorpusReadOnly } from "../packages/corpus/db.js";
import { DistrictArtifactSchema, EventArtifactSchema } from "../packages/harness/pageArtifacts.js";
import { BRACKET_REGISTERED_SEASONS, bracketRoundOfSet, bracketSetIdFor } from "../packages/core/districts/bracket.js";
import { simulateDistrictEvent } from "../packages/core/districts/ledgerSimulation.js";
import { playoffPayRule, playoffPointsPaid, securedPlayoffPoints, type PlayoffWinRow } from "../packages/core/districts/securedPlayoffPoints.js";
import {
  buildDistrictEventSimulationInput,
  buildDistrictLedgerRows,
  distributionsFromResult,
  securedElimByTeamFor,
  tierEvents,
  type BracketSourceEvent,
  type DistrictStageFinality,
} from "../apps/web/src/components/districts/districtLedgerRows.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_ABSOLUTE = join(REPO_ROOT, "data", "corpus.sqlite");
const FIXTURE_DIR = join(REPO_ROOT, "data", "fixtures", "phase10");
const FIXTURE_DISTRICT = join(FIXTURE_DIR, "district-2026pnw.json");
const FIXTURE_EVENTS = ["2026orore", "2026orsal", "2026orwil", "2026waahs", "2026wabon", "2026wasam", "2026wasno", "2026wayak"] as const;

/** One skipped test naming what is missing, or with `REQUIRE_LOCAL_DATA=1` one FAILING test. */
function localDataAbsent(what: string): void {
  if (process.env.REQUIRE_LOCAL_DATA === "1") {
    it(`REQUIRE_LOCAL_DATA=1 and the local data is absent: ${what}`, () => {
      throw new Error(`REQUIRE_LOCAL_DATA=1, but this local data gated group cannot run: ${what}`);
    });
    return;
  }
  it.skip(`skipped: ${what}`, () => {});
}

interface EventRow {
  readonly event_key: string;
  readonly year: number;
  readonly event_type: number;
}
interface AllianceRow {
  readonly alliance_number: number;
  readonly picks: string;
}
interface MatchRow {
  readonly match_key: string;
  readonly comp_level: string;
  readonly set_number: number;
  readonly match_number: number;
  readonly sort_time: number;
  readonly red_teams: string;
  readonly blue_teams: string;
  readonly red_dqs: string;
  readonly blue_dqs: string;
  readonly red_surrogates: string;
  readonly blue_surrogates: string;
  readonly winner: string | null;
}
interface RankingRow {
  readonly team_key: string;
  readonly event_points_raw: string;
}
interface PaidEntry {
  readonly event_key: string;
  readonly elim_points: number;
}

interface Alliance {
  readonly allianceNumber: number;
  readonly picks: readonly string[];
}
interface PlayedRow {
  readonly matchKey: string;
  readonly compLevel: string;
  readonly setNumber: number;
  readonly matchNumber: number;
  readonly time: number;
  readonly redTeams: readonly string[];
  readonly blueTeams: readonly string[];
  readonly redDqs: readonly string[];
  readonly blueDqs: readonly string[];
  readonly surrogates: number;
  readonly winner: "red" | "blue" | "tie";
}
interface LoadedEvent {
  readonly eventKey: string;
  readonly year: number;
  readonly tier: "district" | "dcmp";
  readonly kind: string;
  readonly alliances: readonly Alliance[];
  /** Every played playoff row, in clock order (ties broken by schedule order). */
  readonly rows: readonly PlayedRow[];
}

/** TBA's own reading of a side: the first of its three robots that a pick list names, lists in order. */
function tbaAllianceOf(alliances: readonly Alliance[], teams: readonly string[]): number | undefined {
  for (const teamKey of teams.slice(0, 3)) {
    for (const alliance of alliances) if (alliance.picks.includes(teamKey)) return alliance.allianceNumber;
  }
  return undefined;
}

/** The tab's reading of a side (`playedBracketMatchesFor`): every listed robot of the side on ONE list. */
function tabAllianceOf(alliances: readonly Alliance[], teams: readonly string[]): number | undefined {
  const numbers = new Set<number>();
  for (const teamKey of teams) for (const alliance of alliances) if (alliance.picks.includes(teamKey)) numbers.add(alliance.allianceNumber);
  return numbers.size === 1 ? [...numbers][0] : undefined;
}

const scheduleOrder = (a: PlayedRow, b: PlayedRow): number =>
  (a.compLevel === "sf" ? 0 : 1) - (b.compLevel === "sf" ? 0 : 1) || a.setNumber - b.setNumber || a.matchNumber - b.matchNumber;

/**
 * The fit table's rule label of a season, by the pay rule DECLARED for it and never by a range of years: a season
 * registered later lands in its own rule's rows, and the pinned table then fails until that season is measured.
 */
function ruleLabelOf(year: number): string {
  const rule = playoffPayRule(year);
  if (rule === "allWins") return "2023 rule";
  if (rule === "semifinalWins") return "2024 on";
  return `no declared rule (${String(year)})`;
}

function kindOf(year: number, eventType: number, allianceCount: number): string {
  const rule = ruleLabelOf(year);
  const shape =
    eventType === 1 ? "district tier, 8 alliances" : eventType === 5 ? "dcmp division, 8 alliances" : allianceCount === 8 ? "dcmp single, 8 alliances" : `dcmp finals, ${String(allianceCount)} alliances`;
  return `${rule} | ${shape}`;
}

interface Loaded {
  readonly events: readonly LoadedEvent[];
  /** `eventKey|teamKey` -> the playoff points TBA paid. */
  readonly paid: ReadonlyMap<string, number>;
  readonly eventsWithoutAlliances: number;
}

function load(): Loaded {
  const db = openCorpusReadOnly(CORPUS_ABSOLUTE);
  try {
    const paid = new Map<string, number>();
    for (const row of db.prepare("SELECT team_key, event_points_raw FROM district_rankings").all() as RankingRow[]) {
      for (const entry of JSON.parse(row.event_points_raw) as PaidEntry[]) paid.set(`${entry.event_key}|${row.team_key}`, entry.elim_points);
    }
    // District tier events, District Championships and their divisions: TBA's event types 1, 2 and 5, of EVERY
    // registered bracket season. The seasons are read from `BRACKET_REGISTERED_SEASONS` and no year is written here.
    const eventRows = db
      .prepare(`SELECT event_key, year, event_type FROM events WHERE year IN (${BRACKET_REGISTERED_SEASONS.map(() => "?").join(", ")}) AND district_key IS NOT NULL AND event_type IN (1, 2, 5) ORDER BY event_key`)
      .all(...BRACKET_REGISTERED_SEASONS) as EventRow[];
    const selectAlliances = db.prepare("SELECT alliance_number, picks FROM event_alliances WHERE event_key = ? ORDER BY alliance_number");
    const selectMatches = db.prepare(
      "SELECT match_key, comp_level, set_number, match_number, sort_time, red_teams, blue_teams, red_dqs, blue_dqs, red_surrogates, blue_surrogates, winner FROM matches WHERE event_key = ? AND comp_level IN ('sf', 'f') AND winner IS NOT NULL"
    );
    const events: LoadedEvent[] = [];
    let eventsWithoutAlliances = 0;
    for (const event of eventRows) {
      const alliances = (selectAlliances.all(event.event_key) as AllianceRow[]).map((row) => ({ allianceNumber: row.alliance_number, picks: JSON.parse(row.picks) as string[] }));
      if (alliances.length === 0) {
        eventsWithoutAlliances += 1;
        continue;
      }
      const rows: PlayedRow[] = (selectMatches.all(event.event_key) as MatchRow[]).map((row) => ({
        matchKey: row.match_key,
        compLevel: row.comp_level,
        setNumber: row.set_number,
        matchNumber: row.match_number,
        time: row.sort_time,
        redTeams: JSON.parse(row.red_teams) as string[],
        blueTeams: JSON.parse(row.blue_teams) as string[],
        redDqs: JSON.parse(row.red_dqs) as string[],
        blueDqs: JSON.parse(row.blue_dqs) as string[],
        surrogates: (JSON.parse(row.red_surrogates) as string[]).length + (JSON.parse(row.blue_surrogates) as string[]).length,
        winner: row.winner === "red" ? "red" : row.winner === "blue" ? "blue" : "tie",
      }));
      rows.sort((a, b) => a.time - b.time || scheduleOrder(a, b));
      events.push({
        eventKey: event.event_key,
        year: event.year,
        tier: event.event_type === 1 ? "district" : "dcmp",
        kind: kindOf(event.year, event.event_type, alliances.length),
        alliances,
        rows,
      });
    }
    return { events, paid, eventsWithoutAlliances };
  } finally {
    db.close();
  }
}

/** The decisive rows as the pay rule reads them, each side mapped by `allianceOf`. `undefined` where a decisive row cannot be mapped. */
function winRows(event: LoadedEvent, rows: readonly PlayedRow[], allianceOf: (alliances: readonly Alliance[], teams: readonly string[]) => number | undefined): PlayoffWinRow[] | undefined {
  const out: PlayoffWinRow[] = [];
  for (const row of rows) {
    if (row.winner === "tie") continue;
    const teams = row.winner === "red" ? row.redTeams : row.blueTeams;
    const winner = allianceOf(event.alliances, teams);
    if (winner === undefined) return undefined;
    out.push({ compLevel: row.compLevel, setNumber: row.setNumber, matchNumber: row.matchNumber, winningAllianceNumber: winner, winningTeams: teams });
  }
  return out;
}

/** Every robot on a pick list or on a played playoff row of the event. */
function everyRobot(event: LoadedEvent): Set<string> {
  const robots = new Set<string>();
  for (const alliance of event.alliances) for (const pick of alliance.picks) robots.add(pick);
  for (const row of event.rows) {
    for (const teamKey of row.redTeams) robots.add(teamKey);
    for (const teamKey of row.blueTeams) robots.add(teamKey);
  }
  return robots;
}

/** The tab's reader over the 491 eight alliance events, measured 2026-10-12 (pinned as the run showed). */
const TAB_READER_PINS = { events: 491, positions: 7987, credits: 45513, sum: 762821, largest: 90 };

interface FitCounts {
  events: number;
  teams: number;
  paidAboveZero: number;
  equal: number;
  ruleAbove: number;
  ruleBelow: number;
  noDistrictRow: number;
}

describe("the playoff pay rule and the secured minimum against the corpus (quick task 261012-mw2)", () => {
  if (!existsSync(CORPUS_ABSOLUTE)) {
    localDataAbsent("data/corpus.sqlite absent (gitignored local data)");
    return;
  }
  const loaded = load();

  // WHICH SEASONS EACH GATE COMPARED (orchestrator addendum D7): per season, the events at which a gate held at least
  // one value against a payment of TBA's. The three gates below fill these as they run, and the last test of this
  // group reads them. `ran` says which gates ran in this process, so a filtered run cannot pass the season test empty.
  const comparedEvents = { fit: new Map<number, number>(), rule: new Map<number, number>(), reader: new Map<number, number>() };
  const ran = { fit: false, rule: false, reader: false };
  const countEvent = (bySeason: Map<number, number>, season: number): void => {
    bySeason.set(season, (bySeason.get(season) ?? 0) + 1);
  };

  it("D1, the fit table: the rule equals what TBA paid at every team of every event, with nothing above and nothing below", () => {
    const table = new Map<string, FitCounts>();
    const off: string[] = [];
    for (const event of loaded.events) {
      let counts = table.get(event.kind);
      if (counts === undefined) {
        counts = { events: 0, teams: 0, paidAboveZero: 0, equal: 0, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 0 };
        table.set(event.kind, counts);
      }
      counts.events += 1;
      const rows = winRows(event, event.rows, tbaAllianceOf);
      const rule = rows === undefined ? undefined : playoffPointsPaid(event.year, event.tier, event.alliances.length, rows);
      expect(rule, `${event.eventKey}: the rule refused the event's whole rows`).toBeDefined();
      let comparedHere = false;
      for (const teamKey of everyRobot(event)) {
        const paid = loaded.paid.get(`${event.eventKey}|${teamKey}`);
        if (paid === undefined) {
          counts.noDistrictRow += 1;
          continue;
        }
        const value = rule!.get(teamKey) ?? 0;
        comparedHere = true;
        counts.teams += 1;
        if (paid > 0) counts.paidAboveZero += 1;
        if (value === paid) counts.equal += 1;
        else {
          if (value > paid) counts.ruleAbove += 1;
          else counts.ruleBelow += 1;
          off.push(`${event.eventKey} ${teamKey}: rule ${String(value)}, paid ${String(paid)}`);
        }
      }
      if (comparedHere) countEvent(comparedEvents.fit, event.year);
    }
    ran.fit = true;
    const report = Object.fromEntries([...table].sort(([a], [b]) => a.localeCompare(b)));
    console.log(`[playoff pay rule fit] ${JSON.stringify(report)}`);
    expect(off).toEqual([]);
    expect(loaded.eventsWithoutAlliances).toBe(2);
    // THE FIT TABLE OF D1, as measured 2026-10-12. Every row: equal is teams, and nothing is above or below.
    expect(report).toEqual({
      "2023 rule | dcmp division, 8 alliances": { events: 10, teams: 244, paidAboveZero: 121, equal: 244, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 0 },
      "2023 rule | dcmp finals, 2 alliances": { events: 3, teams: 16, paidAboveZero: 9, equal: 16, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 2 },
      "2023 rule | dcmp finals, 4 alliances": { events: 1, teams: 9, paidAboveZero: 6, equal: 9, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 4 },
      "2023 rule | dcmp single, 8 alliances": { events: 7, teams: 176, paidAboveZero: 85, equal: 176, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 0 },
      "2023 rule | district tier, 8 alliances": { events: 94, teams: 2255, paidAboveZero: 1119, equal: 2255, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 63 },
      "2024 on | dcmp division, 8 alliances": { events: 30, teams: 738, paidAboveZero: 366, equal: 738, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 0 },
      "2024 on | dcmp finals, 2 alliances": { events: 9, teams: 37, paidAboveZero: 27, equal: 37, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 21 },
      "2024 on | dcmp finals, 4 alliances": { events: 3, teams: 28, paidAboveZero: 18, equal: 28, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 11 },
      "2024 on | dcmp single, 8 alliances": { events: 26, teams: 651, paidAboveZero: 322, equal: 651, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 0 },
      "2024 on | district tier, 8 alliances": { events: 324, teams: 7837, paidAboveZero: 3873, equal: 7837, ruleAbove: 0, ruleBelow: 0, noDistrictRow: 165 },
    });
  });

  it("D2, the gate on the rule: at every prefix of every event's decisive rows, in schedule order and in clock order, no secured minimum is above the final payment and none is lower than before", () => {
    let positions = 0;
    let teamPositions = 0;
    let credited = 0;
    let alreadyFinal = 0;
    const above: string[] = [];
    const drops: string[] = [];
    const refused: string[] = [];
    for (const event of loaded.events) {
      const decisive = winRows(event, event.rows, tbaAllianceOf);
      expect(decisive, event.eventKey).toBeDefined();
      const clock = decisive!;
      const schedule = [...clock].sort((a, b) => (a.compLevel === "sf" ? 0 : 1) - (b.compLevel === "sf" ? 0 : 1) || a.setNumber - b.setNumber || a.matchNumber - b.matchNumber);
      let comparedHere = false;
      for (const [name, order] of [
        ["schedule", schedule],
        ["clock", clock],
      ] as const) {
        let before: ReadonlyMap<string, number> = new Map();
        for (let k = 0; k <= order.length; k++) {
          const prefix = order.slice(0, k);
          const secured = securedPlayoffPoints(event.year, event.tier, event.alliances.length, prefix);
          positions += 1;
          if (k > 0 && playoffPointsPaid(event.year, event.tier, event.alliances.length, prefix) === undefined) refused.push(`${event.eventKey} ${name} ${String(k)}`);
          for (const [teamKey, value] of secured) {
            const paid = loaded.paid.get(`${event.eventKey}|${teamKey}`);
            if (paid === undefined) continue;
            comparedHere = true;
            teamPositions += 1;
            if (value > 0) credited += 1;
            if (value === paid) alreadyFinal += 1;
            if (value > paid) above.push(`${event.eventKey} ${teamKey} ${name} prefix ${String(k)}: secured ${String(value)}, paid ${String(paid)}`);
          }
          for (const [teamKey, was] of before) {
            const now = secured.get(teamKey) ?? 0;
            if (now < was) drops.push(`${event.eventKey} ${teamKey} ${name} prefix ${String(k)}: ${String(was)} then ${String(now)}`);
          }
          before = secured;
        }
      }
      if (comparedHere) countEvent(comparedEvents.rule, event.year);
    }
    ran.rule = true;
    console.log(
      `[secured minimum gate, the rule] events ${String(loaded.events.length)}, positions ${String(positions)}, team positions ${String(teamPositions)}, credited above 0 ${String(credited)}, equal to the final payment ${String(alreadyFinal)}, above ${String(above.length)}, lower than before ${String(drops.length)}, refused ${refused.join("; ")}`
    );
    expect(above).toEqual([]);
    expect(drops).toEqual([]);
    // 2023mawor's sf5 carries a clock time before its sf1 and sf2, so in clock order two of its prefixes hold a row
    // whose feeders are missing. The rule refuses them and credits nothing there, which is the rule working.
    expect(refused).toEqual(["2023mawor clock 3", "2023mawor clock 4"]);
    expect({ events: loaded.events.length, positions, teamPositions, credited, alreadyFinal }).toEqual({ events: 507, positions: 16094, teamPositions: 222863, credited: 90965, alreadyFinal: 116871 });
  });

  it("D2, the gate on the tab's own reader: securedElimByTeamFor at every prefix of every eight alliance event, in clock order, credits listed picks only and never above the final payment", () => {
    let events = 0;
    let positions = 0;
    let credits = 0;
    let largest = 0;
    let sum = 0;
    const above: string[] = [];
    const drops: string[] = [];
    const unlisted: string[] = [];
    for (const event of loaded.events) {
      if (event.alliances.length !== 8) {
        // A finals event of a divisioned championship: the tab credits nothing there.
        const source: BracketSourceEvent = { alliances: event.alliances, matches: event.rows.map((row) => ({ matchKey: row.matchKey, compLevel: row.compLevel, setNumber: row.setNumber, matchNumber: row.matchNumber, redTeams: row.redTeams, blueTeams: row.blueTeams, actualWinner: row.winner })) };
        expect(securedElimByTeamFor(source, event.year, event.tier).size, event.eventKey).toBe(0);
        continue;
      }
      events += 1;
      const source: BracketSourceEvent = {
        alliances: event.alliances,
        matches: event.rows.map((row) => ({ matchKey: row.matchKey, compLevel: row.compLevel, setNumber: row.setNumber, matchNumber: row.matchNumber, redTeams: row.redTeams, blueTeams: row.blueTeams, actualWinner: row.winner })),
      };
      const listed = new Set(event.alliances.flatMap((alliance) => alliance.picks));
      let before: ReadonlyMap<string, number> = new Map();
      let comparedHere = false;
      for (let k = 0; k <= event.rows.length; k++) {
        const keys = new Set(event.rows.slice(0, k).map((row) => row.matchKey));
        const secured = securedElimByTeamFor(source, event.year, event.tier, keys);
        positions += 1;
        for (const [teamKey, value] of secured) {
          if (!listed.has(teamKey)) unlisted.push(`${event.eventKey} ${teamKey}`);
          expect(value).toBeGreaterThan(0);
          const paid = loaded.paid.get(`${event.eventKey}|${teamKey}`);
          if (paid === undefined) continue;
          comparedHere = true;
          credits += 1;
          sum += value;
          largest = Math.max(largest, value);
          if (value > paid) above.push(`${event.eventKey} ${teamKey} prefix ${String(k)}: secured ${String(value)}, paid ${String(paid)}`);
        }
        for (const [teamKey, was] of before) {
          const now = secured.get(teamKey) ?? 0;
          if (now < was) drops.push(`${event.eventKey} ${teamKey} prefix ${String(k)}: ${String(was)} then ${String(now)}`);
        }
        before = secured;
      }
      // The whole rows, no cut: the same reading.
      expect(securedElimByTeamFor(source, event.year, event.tier)).toEqual(before);
      if (comparedHere) countEvent(comparedEvents.reader, event.year);
    }
    ran.reader = true;
    console.log(`[secured minimum gate, the tab's reader] events ${String(events)}, positions ${String(positions)}, credits ${String(credits)}, sum ${String(sum)}, largest ${String(largest)}, above ${String(above.length)}, lower than before ${String(drops.length)}`);
    expect(above).toEqual([]);
    expect(drops).toEqual([]);
    expect(unlisted).toEqual([]);
    expect({ events, positions, credits, sum, largest }).toEqual(TAB_READER_PINS);
  });

  it("the facts the reading rests on, counted over every played playoff row", () => {
    let rows = 0;
    const ties: string[] = [];
    const overtime: string[] = [];
    let disqualifiedSides = 0;
    const disqualifiedSideWon: string[] = [];
    let surrogates = 0;
    const twoDecisive: string[] = [];
    const threeFinalsWins: string[] = [];
    const twoLists: string[] = [];
    const mappedDifferently: string[] = [];
    const unlistedOnTheField = new Set<string>();
    let listedFourth = 0;
    const listedNeverPlayed: string[] = [];
    const lossesOnlyYetPaid: string[] = [];
    for (const event of loaded.events) {
      const listCount = new Map<string, number>();
      for (const alliance of event.alliances) {
        alliance.picks.forEach((pick, slot) => {
          listCount.set(pick, (listCount.get(pick) ?? 0) + 1);
          if (slot >= 3) listedFourth += 1;
        });
      }
      for (const [teamKey, count] of listCount) if (count > 1) twoLists.push(`${event.eventKey} ${teamKey}`);
      const decisiveBySet = new Map<string, number>();
      const finalsWins = new Map<number, number>();
      const onTheField = new Set<string>();
      const won = new Set<string>();
      for (const row of event.rows) {
        rows += 1;
        if (row.winner === "tie") ties.push(row.matchKey);
        if (row.compLevel === "f" && row.matchNumber >= 4) overtime.push(row.matchKey);
        surrogates += row.surrogates;
        for (const [color, teams, dqs] of [
          ["red", row.redTeams, row.redDqs],
          ["blue", row.blueTeams, row.blueDqs],
        ] as const) {
          const tba = tbaAllianceOf(event.alliances, teams);
          if (tba !== tabAllianceOf(event.alliances, teams)) mappedDifferently.push(`${row.matchKey} ${color}`);
          if (dqs.length > 0) {
            disqualifiedSides += 1;
            if (row.winner === color) disqualifiedSideWon.push(`${row.matchKey}: ${[...row.redTeams, ...row.blueTeams].filter((teamKey) => loaded.paid.has(`${event.eventKey}|${teamKey}`)).length} robots with a district row`);
          }
          for (const teamKey of teams) {
            onTheField.add(teamKey);
            if (!listCount.has(teamKey)) unlistedOnTheField.add(`${event.eventKey} ${teamKey}`);
            if (row.winner === color) won.add(teamKey);
          }
          if (row.winner === color && row.compLevel === "f" && tba !== undefined) finalsWins.set(tba, (finalsWins.get(tba) ?? 0) + 1);
        }
        if (row.winner !== "tie" && row.compLevel === "sf") decisiveBySet.set(`sf${String(row.setNumber)}`, (decisiveBySet.get(`sf${String(row.setNumber)}`) ?? 0) + 1);
      }
      for (const [setId, count] of decisiveBySet) if (count > 1) twoDecisive.push(`${event.eventKey} ${setId}`);
      for (const [allianceNumber, count] of finalsWins) if (count > 2) threeFinalsWins.push(`${event.eventKey} alliance ${String(allianceNumber)}`);
      for (const teamKey of listCount.keys()) if (!onTheField.has(teamKey)) listedNeverPlayed.push(`${event.eventKey} ${teamKey} paid ${String(loaded.paid.get(`${event.eventKey}|${teamKey}`) ?? "no row")}`);
      for (const teamKey of onTheField) {
        const paid = loaded.paid.get(`${event.eventKey}|${teamKey}`);
        if (!won.has(teamKey) && paid !== undefined && paid > 0) lossesOnlyYetPaid.push(`${event.eventKey} ${teamKey}`);
      }
    }
    console.log(
      `[playoff row facts] rows ${String(rows)}, ties ${String(ties.length)}, Finals rows numbered 4 or above ${String(overtime.length)}, disqualified sides ${String(disqualifiedSides)}, surrogates ${String(surrogates)}, listed fourth picks ${String(listedFourth)}, listed picks on no played row ${String(listedNeverPlayed.length)}`
    );
    expect(rows).toBe(7554);
    // A tie has no winner and pays nobody: thirteen Finals rows and one semifinal, each replayed.
    expect(ties.sort()).toEqual([
      "2023mabri_f1m1",
      "2023marea_f1m1",
      "2023mibel_f1m2",
      "2023miesc_f1m1",
      "2023milak_f1m1",
      "2023ncash_sf12m1",
      "2024isde1_f1m2",
      "2024necmp_f1m1",
      "2024njall_f1m1",
      "2024njfla_f1m2",
      "2025mibig_f1m3",
      "2025mitvc_f1m3",
      "2025njrob_f1m1",
      "2026vtbur_f1m3",
    ]);
    expect(overtime.sort()).toEqual(["2023mabri_f1m4", "2024necmp_f1m4", "2024njfla_f1m4", "2025mibig_f1m4", "2025mitvc_f1m4", "2026vtbur_f1m4"]);
    // A disqualified (red carded) side is a losing side like any other: the rule needs no special case, and the fit
    // above is exact with these rows in. The one row a disqualified side is recorded as winning is a 0 to 0 match
    // between two alliances of placeholder robots (frc9991 to frc9999), none of which has a district row.
    expect(disqualifiedSides).toBe(60);
    expect(disqualifiedSideWon).toEqual(["2026txmca_sf6m1: 0 robots with a district row"]);
    expect(surrogates).toBe(0);
    // More wins than a set can hold has never happened, so the rule's refusal of it costs nothing.
    expect(twoDecisive).toEqual([]);
    expect(threeFinalsWins).toEqual([]);
    expect(twoLists).toEqual([]);
    // TBA's reading of a side and the tab's agree on every played row.
    expect(mappedDifferently).toEqual([]);
    // A backup no list names: credited nothing by the tab's reader, as its open Playoffs cell says.
    expect([...unlistedOnTheField].sort()).toEqual(["2024onwat frc7722", "2024onwat frc9663"]);
    expect(listedFourth).toBe(351);
    // A listed pick that never played, and a robot that was only on the field for losses or ties, is paid nothing:
    // TBA writes it a 0 at its own event and no row at all at a finals event.
    expect(listedNeverPlayed.sort()).toEqual([
      "2024isde2 frc2212 paid 0",
      "2024micmp frc4405 paid no row",
      "2024micmp frc894 paid no row",
      "2026necmp frc2648 paid no row",
      "2026necmp frc8724 paid no row",
      "2026txcmp frc8088 paid no row",
    ]);
    expect(lossesOnlyYetPaid).toEqual([]);
  });

  it("what the rule is NOT: the placement value times matches played over the alliance's matches is above what TBA paid at 156 of the 694 robots that sat out a row", () => {
    let satOut = 0;
    let equal = 0;
    let above = 0;
    let below = 0;
    for (const event of loaded.events) {
      const weight = event.tier === "district" ? 1 : 3;
      const playedByTeam = new Map<string, number>();
      const playedByAlliance = new Map<number, number>();
      const allianceOfTeam = new Map<string, number>();
      for (const row of event.rows) {
        for (const teams of [row.redTeams, row.blueTeams]) {
          const allianceNumber = tbaAllianceOf(event.alliances, teams);
          if (allianceNumber === undefined) continue;
          playedByAlliance.set(allianceNumber, (playedByAlliance.get(allianceNumber) ?? 0) + 1);
          for (const teamKey of teams) {
            playedByTeam.set(teamKey, (playedByTeam.get(teamKey) ?? 0) + 1);
            allianceOfTeam.set(teamKey, allianceNumber);
          }
        }
      }
      for (const alliance of event.alliances) {
        const allianceMatches = playedByAlliance.get(alliance.allianceNumber);
        if (allianceMatches === undefined) continue;
        // The alliance's value: the most TBA paid any of its listed picks, unweighted.
        let value = 0;
        for (const pick of alliance.picks) value = Math.max(value, (loaded.paid.get(`${event.eventKey}|${pick}`) ?? 0) / weight);
        const members = new Set(alliance.picks);
        for (const [teamKey, allianceNumber] of allianceOfTeam) if (allianceNumber === alliance.allianceNumber) members.add(teamKey);
        for (const teamKey of members) {
          const paid = loaded.paid.get(`${event.eventKey}|${teamKey}`);
          if (paid === undefined) continue;
          const played = playedByTeam.get(teamKey) ?? 0;
          if (played >= allianceMatches) continue;
          satOut += 1;
          const guess = Math.ceil((value * played) / allianceMatches) * weight;
          if (guess === paid) equal += 1;
          else if (guess > paid) above += 1;
          else below += 1;
        }
      }
    }
    expect({ satOut, equal, above, below }).toEqual({ satOut: 694, equal: 359, above: 156, below: 179 });
  });

  it("no registered season is passed over: every season of BRACKET_REGISTERED_SEASONS with a finished bracket and paid values in the corpus has an event compared in each of the three gates", () => {
    // This test reads what the three gates above compared, so they must have run in this process.
    if (!ran.fit || !ran.rule || !ran.reader) {
      throw new Error("the season test reads what the fit table and the two gates compared: run this file whole, not one test of it");
    }
    // THE CENSUS, taken apart from `load()`: its own query, with no season filter of any kind. A finished bracket
    // with paid values is an event with an alliance list, at least one decisive playoff row, and at least one team
    // TBA paid playoff points at it.
    interface CensusRow {
      readonly event_key: string;
      readonly year: number;
      readonly alliances: number;
      readonly decisive: number;
    }
    const db = openCorpusReadOnly(CORPUS_ABSOLUTE);
    let census: CensusRow[];
    try {
      census = db
        .prepare(
          "SELECT e.event_key AS event_key, e.year AS year, " +
            "(SELECT COUNT(*) FROM event_alliances a WHERE a.event_key = e.event_key) AS alliances, " +
            "(SELECT COUNT(*) FROM matches m WHERE m.event_key = e.event_key AND m.comp_level IN ('sf', 'f') AND m.winner IN ('red', 'blue')) AS decisive " +
            "FROM events e WHERE e.district_key IS NOT NULL AND e.event_type IN (1, 2, 5) ORDER BY e.event_key"
        )
        .all() as CensusRow[];
    } finally {
      db.close();
    }
    const paidEvents = new Set<string>();
    for (const [key, value] of loaded.paid) if (value > 0) paidEvents.add(key.slice(0, key.indexOf("|")));
    const finished = new Map<number, { all: number; eightAlliances: number }>();
    for (const row of census) {
      if (row.alliances === 0 || row.decisive === 0 || !paidEvents.has(row.event_key)) continue;
      const counts = finished.get(row.year) ?? { all: 0, eightAlliances: 0 };
      counts.all += 1;
      if (row.alliances === 8) counts.eightAlliances += 1;
      finished.set(row.year, counts);
    }

    const measured: number[] = [];
    const notMeasured: number[] = [];
    const passedOver: string[] = [];
    for (const season of BRACKET_REGISTERED_SEASONS) {
      const counts = finished.get(season);
      if (counts === undefined) {
        // Registered, and the corpus holds no finished bracket of it: printed by name, never failed.
        notMeasured.push(season);
        continue;
      }
      measured.push(season);
      if (!((comparedEvents.fit.get(season) ?? 0) > 0)) passedOver.push(`${String(season)}: ${String(counts.all)} finished brackets with paid values, none in the fit table`);
      if (!((comparedEvents.rule.get(season) ?? 0) > 0)) passedOver.push(`${String(season)}: ${String(counts.all)} finished brackets with paid values, none in the gate on the rule`);
      if (counts.eightAlliances > 0 && !((comparedEvents.reader.get(season) ?? 0) > 0)) {
        passedOver.push(`${String(season)}: ${String(counts.eightAlliances)} finished eight alliance brackets with paid values, none in the gate on the tab's reader`);
      }
    }
    // A season the corpus holds finished brackets of that is newer than every registered one: nothing is credited in
    // it (the module refuses an undeclared season), so it is named and not failed.
    const lastRegistered = Math.max(...BRACKET_REGISTERED_SEASONS);
    const newerUnregistered = [...finished.keys()].filter((season) => season > lastRegistered).sort((a, b) => a - b);

    const perSeason = Object.fromEntries(
      measured.map((season) => [
        String(season),
        {
          rule: playoffPayRule(season),
          finished: finished.get(season)!.all,
          fit: comparedEvents.fit.get(season) ?? 0,
          gateOnTheRule: comparedEvents.rule.get(season) ?? 0,
          gateOnTheReader: comparedEvents.reader.get(season) ?? 0,
        },
      ])
    );
    console.log(`[season coverage] registered ${BRACKET_REGISTERED_SEASONS.join(", ")}; compared events per season ${JSON.stringify(perSeason)}`);
    for (const season of notMeasured) {
      console.log(
        `[season coverage] REGISTERED SEASON ${String(season)} HAS NO FINISHED BRACKET WITH PAID VALUES IN THE CORPUS: its declared pay rule (${String(playoffPayRule(season))}) is NOT measured, and a credit resting on it is not to be trusted until this file has passed on that season's first finished events`
      );
    }
    for (const season of newerUnregistered) {
      console.log(`[season coverage] season ${String(season)} has finished brackets in the corpus and is not registered: nothing is credited in it`);
    }
    expect(passedOver).toEqual([]);
    // Every registered season is either measured or named above, and a measured season has a declared rule.
    expect([...measured, ...notMeasured].sort((a, b) => a - b)).toEqual([...BRACKET_REGISTERED_SEASONS].sort((a, b) => a - b));
    for (const season of measured) expect(playoffPayRule(season), `season ${String(season)} is compared with no declared pay rule`).toBeDefined();
    // The events the fit table compared are the census' finished brackets, season by season: nothing the census
    // counts as finished is missing from the table, and the table holds nothing the census does not know.
    for (const season of measured) expect(comparedEvents.fit.get(season), `season ${String(season)}`).toBe(finished.get(season)!.all);
  });
});

/** The eight fixture events at their five round stops, measured 2026-10-12 (pinned as the run showed). */
const CELL_PINS = { stops: 40, cells: 268 };

describe("an open Playoffs cell never reads at least more than its own run draws (quick task 261012-mw2, D4)", () => {
  const missing = [FIXTURE_DISTRICT, ...FIXTURE_EVENTS.map((eventKey) => join(FIXTURE_DIR, `event-${eventKey}.json`))].filter((path) => !existsSync(path));
  if (missing.length > 0) {
    localDataAbsent(`${String(missing.length)} of 9 fixtures absent under data/fixtures/phase10 (gitignored local data)`);
    return;
  }

  it("the eight 2026 PNW district events at every playoff round stop: no draw of a cell's distribution is below its secured minimum", () => {
    const district = DistrictArtifactSchema.parse(JSON.parse(readFileSync(FIXTURE_DISTRICT, "utf8")));
    const playoffsOpen: DistrictStageFinality = { qual: true, alliance: true, elim: false, award: false };
    const allFinal: DistrictStageFinality = { qual: true, alliance: true, elim: true, award: true };
    const ELIM_CELL = 2;
    let stops = 0;
    let cells = 0;
    const below: string[] = [];
    for (const eventKey of FIXTURE_EVENTS) {
      const event = EventArtifactSchema.parse(JSON.parse(readFileSync(join(FIXTURE_DIR, `event-${eventKey}.json`), "utf8")));
      const semifinals = event.matches.filter((match) => match.compLevel === "sf" && match.actualWinner !== undefined);
      const roundOf = (setNumber: number): number => bracketRoundOfSet(bracketSetIdFor("sf", setNumber) ?? "") ?? Infinity;
      const stageByEvent = new Map<string, DistrictStageFinality>();
      for (const team of district.teams) for (const entry of tierEvents(team, "district")) if (!stageByEvent.has(entry.eventKey)) stageByEvent.set(entry.eventKey, entry.eventKey === eventKey ? playoffsOpen : allFinal);
      for (let round = 1; round <= 5; round++) {
        const playedKeys = semifinals.filter((match) => roundOf(match.setNumber) <= round).map((match) => match.matchKey);
        const built = buildDistrictEventSimulationInput({
          eventKey,
          season: district.year,
          eventArtifact: event,
          districtArtifact: district,
          stage: playoffsOpen,
          startMatchKey: null,
          conditionOnPlayedElims: false,
          asOfPlayedElimMatchKeys: playedKeys,
          tier: "district",
        });
        if (!built.ok) throw new Error(`${eventKey} round ${String(round)}: the tab's input builder refused (${built.reason})`);
        stops += 1;
        const secured = securedElimByTeamFor(event, district.year, "district", new Set(playedKeys));
        const entry = { ...distributionsFromResult(simulateDistrictEvent(built.input, 200, 20261012)), ...(secured.size === 0 ? {} : { securedElimByTeam: secured }) };
        const rows = buildDistrictLedgerRows({ artifact: district, distributions: new Map([[eventKey, entry]]), stageByEvent, tier: "district" });
        for (const team of rows.teams) {
          const cell = team.rows.find((row) => row.eventKey === eventKey)?.cells[ELIM_CELL];
          if (cell === undefined || cell.kind !== "open" || cell.securedAtLeast === undefined) continue;
          cells += 1;
          expect(cell.cell).toBe("elim");
          let lowest = 0;
          while (lowest < cell.distribution.counts.length && !((cell.distribution.counts[lowest] ?? 0) > 0)) lowest += 1;
          if (lowest < cell.securedAtLeast) below.push(`${eventKey} round ${String(round)} ${team.teamKey}: at least ${String(cell.securedAtLeast)}, lowest draw ${String(lowest)}`);
        }
      }
    }
    console.log(`[at least against the run] stops ${String(stops)}, open Playoffs cells with an at least line ${String(cells)}, a draw below it ${String(below.length)}`);
    expect(below).toEqual([]);
    expect({ stops, cells }).toEqual(CELL_PINS);
  });
});
