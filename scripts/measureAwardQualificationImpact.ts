/**
 * How much do awards actually move district and Championship qualification?
 * (quick task 260912-tm8)
 *
 * The companion to `measureAwardPredictability.ts`. That script asks whether an
 * award WINNER can be predicted. This one asks the question that decides whether
 * a prediction would matter for qualification at all: how many qualifying spots
 * do awards decide, and where do award points land relative to the cut line.
 *
 * It exists so that every number `/methodology/awards` publishes traces to code
 * in this repo. Before this file these figures came from throwaway analyses in a
 * session scratch directory, and a public page quoting numbers nobody can
 * reproduce is exactly what the published honesty rule forbids.
 *
 * Five measurements, each printed with its denominator:
 *
 *   1. Award points as a share of all district points, and how many DISTRICT
 *      CHAMPIONSHIP spots change hands when award points are removed entirely.
 *   2. Where award points land relative to the district championship cut line.
 *   3. Repeat rate per judged award, and how concentrated judged awards are
 *      across teams.
 *   4. District Championship automatic Championship berths (Impact, Engineering
 *      Inspiration, Rookie All Star): how many went to a team OUTSIDE the
 *      district points cut, and what share of all district Championship spots
 *      that is.
 *   5. Impact win rate per roster slot by team age.
 *
 * CUT LINES ARE APPROXIMATIONS. The district championship cut is "top
 * dcmp_slots by point_total"; the Championship cut is "top cmp_slots by
 * point_total". Automatic qualifiers really consume Championship slots, so the
 * true Championship cut sits higher than this and the OUTSIDE share in (4) is
 * CONSERVATIVE. Ties are broken by team key so both orderings in (1) use one
 * rule.
 *
 * THE JOIN TRAP. `events.district_key` holds the BARE abbreviation ('chs');
 * `districts.district_key` is YEAR PREFIXED ('2024chs'). Joining those two
 * columns directly matches nothing and returns an empty result with no error.
 * Measurement (4) joins on `districts.abbreviation` plus year, and throws if
 * that join finds no automatic berth awards at all.
 *
 * NOT UNIT TESTED. Every figure depends on the gitignored corpus, so no fixture
 * could pin them, and this was written at the end of a session to make already
 * measured numbers reproducible. Treat it as a research script. It reads
 * `data/corpus.sqlite` READ ONLY and makes no network request.
 *
 * Run: `pnpm measure:award-qualification-impact`
 */
import { openCorpusReadOnly, type Corpus } from "../packages/corpus/db.js";

export const CORPUS_PATH = "data/corpus.sqlite";

/** Official event types only: regional, district, district championship, and their divisions. */
const OFFICIAL_EVENT_TYPES = "(0,1,2,3,4,5)";
/** District championship and district championship division. */
const DCMP_EVENT_TYPES = "(2,5)";
/** Awards that carry an automatic Championship berth when won at a district championship. */
const AUTO_BERTH_AWARD_TYPES = "(0,9,10)";

interface RankingRow {
  readonly team_key: string;
  readonly point_total: number;
  readonly event_points_raw: string | null;
}

interface DistrictRow {
  readonly district_key: string;
  readonly year: number;
  readonly abbreviation: string;
  readonly dcmp_slots: number | null;
  readonly cmp_slots: number | null;
}

function pct(part: number, whole: number): string {
  return whole === 0 ? "n/a" : `${((100 * part) / whole).toFixed(1)}%`;
}

function awardPointsOf(raw: string | null): number {
  if (raw === null) return 0;
  let total = 0;
  for (const entry of JSON.parse(raw) as { award_points?: number }[]) total += entry.award_points ?? 0;
  return total;
}

function rankingsFor(db: Corpus, districtKey: string): RankingRow[] {
  return db
    .prepare("SELECT team_key, point_total, event_points_raw FROM district_rankings WHERE district_key = ?")
    .all(districtKey) as RankingRow[];
}

function measureDistrictChampionshipCut(db: Corpus): void {
  const districts = db
    .prepare("SELECT district_key, year, abbreviation, dcmp_slots, cmp_slots FROM districts WHERE dcmp_slots IS NOT NULL")
    .all() as DistrictRow[];

  let teamSeasons = 0;
  let awardSum = 0;
  let pointSum = 0;
  let slotSum = 0;
  let swapSum = 0;
  let districtsUsed = 0;
  let nearCut = 0;
  const buckets = [
    { label: "well above cut (top half of qualifiers)", teams: 0, award: 0, withAward: 0 },
    { label: "just above cut (bottom half of qualifiers)", teams: 0, award: 0, withAward: 0 },
    { label: "just below cut (within one slot depth)", teams: 0, award: 0, withAward: 0 },
    { label: "well below cut", teams: 0, award: 0, withAward: 0 },
  ];

  for (const d of districts) {
    const teams = rankingsFor(db, d.district_key).map((r) => ({
      team: r.team_key,
      total: r.point_total,
      award: awardPointsOf(r.event_points_raw),
    }));
    const slots = Math.min(d.dcmp_slots ?? 0, teams.length);
    if (slots <= 0 || slots >= teams.length) continue;

    const byActual = [...teams].sort((a, b) => b.total - a.total || a.team.localeCompare(b.team));
    const byNoAward = [...teams].sort(
      (a, b) => b.total - b.award - (a.total - a.award) || a.team.localeCompare(b.team)
    );
    const qualifiedNoAward = new Set(byNoAward.slice(0, slots).map((t) => t.team));
    for (const t of byActual.slice(0, slots)) if (!qualifiedNoAward.has(t.team)) swapSum += 1;

    const cut = byActual[slots - 1]?.total ?? 0;
    for (const t of teams) if (Math.abs(t.total - cut) <= 15) nearCut += 1;

    byActual.forEach((t, i) => {
      const rel = (i - (slots - 1)) / slots;
      const bucket = rel <= -0.5 ? buckets[0] : rel <= 0 ? buckets[1] : rel <= 0.5 ? buckets[2] : buckets[3];
      if (bucket === undefined) return;
      bucket.teams += 1;
      bucket.award += t.award;
      if (t.award > 0) bucket.withAward += 1;
    });

    slotSum += slots;
    districtsUsed += 1;
    for (const t of teams) {
      teamSeasons += 1;
      awardSum += t.award;
      pointSum += t.total;
    }
  }

  console.log("1. AWARD POINTS AND THE DISTRICT CHAMPIONSHIP CUT");
  console.log(`   team seasons:                                 ${teamSeasons}`);
  console.log(`   mean award points per team season:            ${(awardSum / teamSeasons).toFixed(2)}`);
  console.log(`   mean district point total:                    ${(pointSum / teamSeasons).toFixed(2)}`);
  console.log(`   award share of all district points:           ${pct(awardSum, pointSum)}`);
  console.log(`   districts scored:                             ${districtsUsed}`);
  console.log(`   spots that change hands with awards removed:  ${swapSum} of ${slotSum} (${pct(swapSum, slotSum)})`);
  console.log(`   teams within 15 points of the cut:            ${nearCut} of ${teamSeasons} (${pct(nearCut, teamSeasons)})`);
  console.log("");
  console.log("2. WHERE AWARD POINTS LAND, relative to the district championship cut");
  for (const b of buckets) {
    console.log(
      `   ${b.label.padEnd(44)} teams ${String(b.teams).padStart(5)}   mean award pts ${(b.award / b.teams).toFixed(2).padStart(6)}   with any award ${pct(b.withAward, b.teams)}`
    );
  }
  console.log("");
}

function measureRepeatAndConcentration(db: Corpus): void {
  const judged: readonly (readonly [number, string])[] = [
    [0, "Impact (formerly Chairman's)"],
    [9, "Engineering Inspiration"],
    [21, "Excellence in Engineering"],
    [71, "Autonomous"],
    [18, "Safety"],
    [17, "Quality"],
    [11, "Gracious Professionalism"],
    [13, "Judges'"],
  ];
  console.log("3a. REPEAT RATE: winners who had won the SAME award in a PRIOR season");
  for (const [type, label] of judged) {
    const rows = db
      .prepare(
        `SELECT a.team_key, e.year FROM event_awards_all a JOIN events e ON e.event_key = a.event_key
         WHERE a.award_type = ? AND a.team_key IS NOT NULL AND e.event_type IN ${OFFICIAL_EVENT_TYPES}
         ORDER BY e.year`
      )
      .all(type) as { team_key: string; year: number }[];
    const firstWin = new Map<string, number>();
    let repeat = 0;
    for (const r of rows) {
      const prior = firstWin.get(r.team_key);
      if (prior !== undefined && prior < r.year) repeat += 1;
      if (prior === undefined || prior > r.year) firstWin.set(r.team_key, r.year);
    }
    console.log(`   ${label.padEnd(30)} ${String(repeat).padStart(5)} of ${String(rows.length).padStart(5)} (${pct(repeat, rows.length)})`);
  }

  const wins = db
    .prepare(
      `SELECT a.team_key, COUNT(*) AS n FROM event_awards_all a JOIN events e ON e.event_key = a.event_key
       WHERE a.team_key IS NOT NULL AND e.event_type IN ${OFFICIAL_EVENT_TYPES} AND a.award_type NOT IN (1,2)
       GROUP BY a.team_key ORDER BY n DESC`
    )
    .all() as { team_key: string; n: number }[];
  const totalWins = wins.reduce((s, w) => s + w.n, 0);
  const rosterTeams = (db.prepare("SELECT COUNT(DISTINCT team_key) AS c FROM event_teams").get() as { c: number }).c;
  const heldByTop = (fraction: number): string => {
    const k = Math.max(1, Math.round(rosterTeams * fraction));
    let held = 0;
    for (const w of wins.slice(0, k)) held += w.n;
    return pct(held, totalWins);
  };
  console.log("");
  console.log(`3b. CONCENTRATION: ${totalWins} judged award wins (Winner and Finalist excluded) across ${rosterTeams} teams`);
  console.log(`   top 1% of teams hold ${heldByTop(0.01)}; top 5% hold ${heldByTop(0.05)}; top 10% hold ${heldByTop(0.1)}`);
  console.log(`   teams that never won a judged award: ${rosterTeams - wins.length} of ${rosterTeams} (${pct(rosterTeams - wins.length, rosterTeams)})`);
  console.log("");
}

function measureChampionshipBerths(db: Corpus): void {
  const districts = db
    .prepare("SELECT district_key, year, abbreviation, dcmp_slots, cmp_slots FROM districts WHERE cmp_slots IS NOT NULL")
    .all() as DistrictRow[];

  let recipients = 0;
  let recipientsOutside = 0;
  let slotSum = 0;
  let distinctOutside = 0;
  let districtSeasons = 0;

  for (const d of districts) {
    const rows = rankingsFor(db, d.district_key);
    if (rows.length === 0) continue;
    const slots = Math.min(d.cmp_slots ?? 0, rows.length);
    if (slots <= 0) continue;
    const sorted = [...rows].sort((a, b) => b.point_total - a.point_total || a.team_key.localeCompare(b.team_key));
    const pointsQualified = new Set(sorted.slice(0, slots).map((r) => r.team_key));

    const winners = db
      .prepare(
        `SELECT a.team_key FROM event_awards_all a JOIN events e ON e.event_key = a.event_key
         WHERE e.district_key = ? AND e.year = ? AND e.event_type IN ${DCMP_EVENT_TYPES}
         AND a.award_type IN ${AUTO_BERTH_AWARD_TYPES} AND a.team_key IS NOT NULL`
      )
      .all(d.abbreviation, d.year) as { team_key: string }[];
    if (winners.length === 0) continue;

    districtSeasons += 1;
    slotSum += slots;
    const outside = new Set<string>();
    for (const w of winners) {
      recipients += 1;
      if (!pointsQualified.has(w.team_key)) {
        recipientsOutside += 1;
        outside.add(w.team_key);
      }
    }
    distinctOutside += outside.size;
  }

  if (recipients === 0) {
    throw new Error(
      "measureChampionshipBerths: found no district championship automatic berth awards. " +
        "events.district_key is the BARE abbreviation and districts.district_key is YEAR PREFIXED; " +
        "an empty result here almost certainly means that join broke, not that the data is empty."
    );
  }

  console.log("4. DISTRICT CHAMPIONSHIP AUTOMATIC CHAMPIONSHIP BERTHS (Impact, Engineering Inspiration, Rookie All Star)");
  console.log("   Cut is APPROXIMATE (top cmp_slots by points); the true cut sits higher, so OUTSIDE is conservative.");
  console.log(`   district seasons with a berth award:          ${districtSeasons}`);
  console.log(`   berth award recipients:                       ${recipients}`);
  console.log(`   recipients OUTSIDE the points cut:            ${recipientsOutside} (${pct(recipientsOutside, recipients)})`);
  console.log(`   award decided spots (distinct teams):         ${distinctOutside} of ${slotSum} district Championship spots (${pct(distinctOutside, slotSum)})`);
  console.log("");
}

/**
 * Win rate per roster slot by team age, for Impact. Age is event year minus
 * rookie_year. A roster slot is one team registered at one official event, so
 * the rate reads "of every time a team this old showed up, how often did it
 * win Impact". This is the RAW rate; the age feature in
 * measureAwardPredictability.ts measures what age adds once past wins are known.
 */
function measureImpactRateByAge(db: Corpus): void {
  const band = `CASE WHEN e.year - t.rookie_year = 0 THEN '0 rookie' WHEN e.year - t.rookie_year BETWEEN 1 AND 3 THEN '1 to 3' WHEN e.year - t.rookie_year BETWEEN 4 AND 9 THEN '4 to 9' WHEN e.year - t.rookie_year BETWEEN 10 AND 19 THEN '10 to 19' ELSE '20 plus' END`;
  const slots = new Map(
    (db.prepare(`SELECT ${band} AS b, COUNT(*) AS n FROM event_teams et JOIN events e ON e.event_key = et.event_key
       JOIN teams t ON t.team_key = et.team_key WHERE e.event_type IN ${OFFICIAL_EVENT_TYPES} AND t.rookie_year IS NOT NULL GROUP BY b`).all() as { b: string; n: number }[]).map((r) => [r.b, r.n])
  );
  const wins = new Map(
    (db.prepare(`SELECT ${band} AS b, COUNT(*) AS n FROM event_awards_all a JOIN events e ON e.event_key = a.event_key
       JOIN teams t ON t.team_key = a.team_key WHERE a.award_type = 0 AND a.team_key IS NOT NULL
       AND e.event_type IN ${OFFICIAL_EVENT_TYPES} AND t.rookie_year IS NOT NULL GROUP BY b`).all() as { b: string; n: number }[]).map((r) => [r.b, r.n])
  );
  console.log("5. IMPACT WIN RATE PER ROSTER SLOT, by team age (event year minus rookie year)");
  for (const b of ["0 rookie", "1 to 3", "4 to 9", "10 to 19", "20 plus"]) {
    const w = wins.get(b) ?? 0;
    const n = slots.get(b) ?? 0;
    console.log(`   ${b.padEnd(10)} ${String(w).padStart(4)} Impact wins over ${String(n).padStart(6)} roster slots (${n === 0 ? "n/a" : ((100 * w) / n).toFixed(2) + "%"})`);
  }
  console.log("");
}

function main(): void {
  const db = openCorpusReadOnly(CORPUS_PATH);
  try {
    console.log("AWARD QUALIFICATION IMPACT, read only over data/corpus.sqlite\n");
    measureDistrictChampionshipCut(db);
    measureRepeatAndConcentration(db);
    measureChampionshipBerths(db);
    measureImpactRateByAge(db);
  } finally {
    db.close();
  }
}

main();
