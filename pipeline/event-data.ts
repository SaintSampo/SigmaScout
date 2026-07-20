// Emit per-event artifacts (events/<season>/<key>.json + index.json). Called by
// site-data after the season fit, so it reuses the same match predictions and
// team ratings — no re-fitting. Fetches actual rankings, playoff alliances, and
// the full match schedule (including UNPLAYED matches, for live events) from TBA.
//
// Played matches carry their pre-match prediction snapshot (from the walk-forward
// records). Unplayed matches get the current best prediction from the latest
// model state — which is exactly what a live event's upcoming matches should show.

import { fetchEventRankings, fetchEventAlliances, fetchEventSchedule } from "./fetch";
import { SeasonModelView } from "../src/core/inference";
import type {
  EventData,
  EventInfo,
  EventIndexEntry,
  MatchRecord,
  Season,
  SeasonEventsIndex,
  SeasonStateFile,
} from "../src/core/types";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const COMP_ORDER: Record<string, number> = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
const sortMatches = (a: MatchRecord, b: MatchRecord) => {
  const c = (COMP_ORDER[a.compLevel] ?? 9) - (COMP_ORDER[b.compLevel] ?? 9);
  if (c !== 0) return c;
  if (a.setNumber !== b.setNumber) return a.setNumber - b.setNumber;
  return a.matchNumber - b.matchNumber;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function buildEventFiles(
  season: Season,
  records: MatchRecord[],
  state: SeasonStateFile,
  events: EventInfo[],
  names: Map<number, string>,
  dataDir: string,
  seasonAccuracy: number,
  /** When given, only these events are re-emitted (and the events index is left
   *  alone) — used by the incremental updater for live events. */
  onlyEvents?: string[],
): Promise<void> {
  const stateByTeam = new Map(state.teams.map((t) => [t.team, t]));
  const eventByKey = new Map(events.map((e) => [e.key, e]));
  const view = new SeasonModelView(state.model, state.teams); // for unplayed predictions
  const round1 = (n: number) => Math.round(n * 10) / 10;

  // Played match records, keyed by match key.
  const recordByKey = new Map(records.map((r) => [r.key, r]));

  // Every event that has played matches (this covers live offseason events like
  // IRI) — or just the requested subset when updating incrementally.
  const eventKeys = onlyEvents ?? [...new Set(records.map((r) => r.event))];
  console.log(`  fetching schedule + rankings + alliances for ${eventKeys.length} event(s)…`);

  const extras = await mapLimit(eventKeys, 8, async (ek) => ({
    ek,
    rankings: await fetchEventRankings(ek),
    alliances: await fetchEventAlliances(ek),
    schedule: await fetchEventSchedule(ek),
  }));
  const extraByKey = new Map(extras.map((e) => [e.ek, e]));

  const index: EventIndexEntry[] = [];
  for (const ek of eventKeys) {
    const info: EventInfo = eventByKey.get(ek) ?? { key: ek, name: ek };
    const extra = extraByKey.get(ek)!;

    // Build match records from the FULL schedule: played from the walk-forward
    // records, unplayed predicted from current state.
    const matches: MatchRecord[] = extra.schedule.map((s) => {
      const existing = recordByKey.get(s.key);
      if (existing) return existing;
      const p = view.predictMatch({ red: s.red, blue: s.blue });
      return {
        key: s.key,
        event: ek,
        compLevel: s.compLevel,
        setNumber: s.setNumber,
        matchNumber: s.matchNumber,
        time: s.time,
        red: s.red,
        blue: s.blue,
        played: false,
        prediction: {
          redWinProb: p.redWinProbability,
          redScore: round1(p.red.mean),
          blueScore: round1(p.blue.mean),
        },
      };
    });

    const qualMatches = matches.filter((m) => m.compLevel === "qm").sort(sortMatches);
    const elimMatches = matches.filter((m) => m.compLevel !== "qm").sort(sortMatches);

    const teamSet = new Set<number>();
    for (const m of matches) for (const t of [...m.red, ...m.blue]) teamSet.add(t);
    const teams = [...teamSet]
      .map((team) => {
        const st = stateByTeam.get(team);
        if (!st) return null;
        return { team, name: names.get(team), components: st.components };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    const data: EventData = {
      event: info,
      componentIds: state.model.components,
      residualVariance: state.model.residualVariance,
      teams,
      qualMatches,
      elimMatches,
      alliances: extra.alliances,
      rankings: extra.rankings,
      seasonAccuracy,
    };
    const full = resolve(dataDir, `events/${season}/${ek}.json`);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, JSON.stringify(data));

    // Directory lists official + offseason events (not preseason/practice).
    if (info.official !== false || info.offseason) {
      index.push({
        key: ek,
        name: info.name,
        week: info.week,
        teamCount: teamSet.size,
        startDate: info.startDate,
      });
    }
  }

  // A partial (incremental) run must not rewrite the directory from a subset.
  if (onlyEvents) {
    console.log(`  wrote ${eventKeys.length} event file(s).`);
    return;
  }

  index.sort(
    (a, b) => (a.week ?? 99) - (b.week ?? 99) || (a.startDate ?? "").localeCompare(b.startDate ?? ""),
  );
  const idxFile: SeasonEventsIndex = { season, events: index };
  await writeFile(
    resolve(dataDir, `events/${season}/index.json`),
    JSON.stringify(idxFile),
  );
  console.log(`  wrote ${eventKeys.length} event files + index (${index.length} listed).`);
}
