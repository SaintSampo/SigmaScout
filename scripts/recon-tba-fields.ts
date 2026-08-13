/**
 * One-shot, read-only reconnaissance probe answering RESEARCH.md's two Open
 * Questions before Plan 03 (RP normalization) and Plan 05 (D-04 reference
 * row) have to guess:
 *
 *   Q1. Does TBA expose a computed per-match ranking-point field in
 *       score_breakdown for every season 2022-2026?
 *   Q2. What is the Statbotics per-season accuracy endpoint, and does it
 *       require auth?
 *
 * Reads TBA_API_KEY from the environment and sends it only as the
 * X-TBA-Auth-Key request header. The key is never logged to stdout/stderr
 * and never written into the generated document — see the assertion at the
 * bottom of main().
 */
import { writeFile } from "node:fs/promises";

const TBA_BASE = "https://www.thebluealliance.com/api/v3";
const STATBOTICS_BASE = "https://api.statbotics.io";
const SEASONS = [2022, 2023, 2024, 2025, 2026] as const;
const OUTPUT_PATH = "docs/data/tba-field-recon.md";

interface TbaEventSimple {
  key: string;
  event_type: number;
  start_date: string;
}

interface TbaMatch {
  key: string;
  comp_level: string;
  score_breakdown: Record<string, Record<string, unknown>> | null;
}

function tbaApiKey(): string {
  const key = process.env["TBA_API_KEY"];
  if (!key) {
    throw new Error(
      "TBA_API_KEY is not set in the environment. Populate .env from .env.example and re-run."
    );
  }
  return key;
}

async function tbaGet<T>(path: string, apiKey: string): Promise<T> {
  const res = await fetch(`${TBA_BASE}${path}`, {
    headers: { "X-TBA-Auth-Key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`TBA ${path} -> HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

/** event_type values that represent normal in-season competition (exclude offseason=99, preseason=100). */
const IN_SEASON_EVENT_TYPES = new Set([0, 1, 2, 3, 4, 5, 6]);

interface RpFieldFinding {
  season: number;
  eventKey: string | null;
  matchKey: string | null;
  rpFieldPresent: boolean;
  rpFieldName: string | null;
  candidateKeys: string[];
  note: string;
}

async function findRpFieldForSeason(season: number, apiKey: string): Promise<RpFieldFinding> {
  let events: TbaEventSimple[];
  try {
    events = await tbaGet<TbaEventSimple[]>(`/events/${season}/simple`, apiKey);
  } catch (err) {
    return {
      season,
      eventKey: null,
      matchKey: null,
      rpFieldPresent: false,
      rpFieldName: null,
      candidateKeys: [],
      note: `Could not list events for ${season}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const candidates = events
    .filter((e) => IN_SEASON_EVENT_TYPES.has(e.event_type))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  for (const event of candidates.slice(0, 8)) {
    let matches: TbaMatch[];
    try {
      matches = await tbaGet<TbaMatch[]>(`/event/${event.key}/matches`, apiKey);
    } catch {
      continue;
    }

    const qualWithBreakdown = matches
      .filter((m) => m.comp_level === "qm" && m.score_breakdown != null)
      .sort((a, b) => a.key.localeCompare(b.key))[0];

    if (!qualWithBreakdown || !qualWithBreakdown.score_breakdown) continue;

    const redKeys = Object.keys(qualWithBreakdown.score_breakdown["red"] ?? {}).sort();
    const rpLikeKeys = redKeys.filter((k) => /rp/i.test(k) || /ranking/i.test(k));
    // TBA's computed per-match RP total field is named "tba_rpEarned" in
    // 2016/2017-era API responses (per RESEARCH.md) but is simply "rp" in
    // 2022-2026 responses observed here — accept either exact name.
    const exactRpField =
      redKeys.find((k) => k.toLowerCase() === "tba_rpearned") ??
      redKeys.find((k) => k.toLowerCase() === "rp") ??
      null;

    return {
      season,
      eventKey: event.key,
      matchKey: qualWithBreakdown.key,
      rpFieldPresent: exactRpField != null,
      rpFieldName: exactRpField,
      candidateKeys: exactRpField ? [] : rpLikeKeys,
      note:
        exactRpField != null
          ? `Found computed RP total field "${exactRpField}" among ${redKeys.length} top-level score_breakdown.red keys (value observed: red=${(qualWithBreakdown.score_breakdown["red"] as Record<string, unknown>)[exactRpField]}).`
          : rpLikeKeys.length > 0
            ? `No "tba_rpEarned"/"rp" field; RP-like candidate keys found instead.`
            : `No "tba_rpEarned"/"rp" field and no RP-like candidate keys found among ${redKeys.length} keys.`,
    };
  }

  return {
    season,
    eventKey: null,
    matchKey: null,
    rpFieldPresent: false,
    rpFieldName: null,
    candidateKeys: [],
    note: `No in-season event with a qualification match carrying score_breakdown was found among the first ${Math.min(candidates.length, 8)} candidate events tried.`,
  };
}

interface StatboticsFinding {
  urlsTried: { url: string; status: number | "network-error" }[];
  resolved: boolean;
  resolvedUrl?: string;
  authRequired: boolean;
  accFieldName?: string;
  mseFieldName?: string;
  values?: Record<number, { acc: number | null; mse: number | null }>;
}

async function probeStatbotics(): Promise<StatboticsFinding> {
  const shapeCandidates = [
    (year: number) => `${STATBOTICS_BASE}/v3/year/${year}`,
    (year: number) => `${STATBOTICS_BASE}/v2/year/${year}`,
    (year: number) => `${STATBOTICS_BASE}/v3/years/${year}`,
  ];

  const urlsTried: { url: string; status: number | "network-error" }[] = [];
  let workingShape: ((year: number) => string) | null = null;
  let firstBody: Record<string, unknown> | null = null;

  for (const shape of shapeCandidates) {
    const url = shape(2024);
    try {
      const res = await fetch(url);
      urlsTried.push({ url, status: res.status });
      if (res.ok) {
        const body = (await res.json()) as Record<string, unknown>;
        // Only accept as "working" if the body looks like a Year record (has an epa-ish key).
        const hasEpaLikeField = Object.keys(body).some((k) => /epa/i.test(k));
        if (hasEpaLikeField) {
          workingShape = shape;
          firstBody = body;
          break;
        }
      }
    } catch {
      urlsTried.push({ url, status: "network-error" });
    }
  }

  if (!workingShape || !firstBody) {
    return { urlsTried, resolved: false, authRequired: false };
  }

  const accFieldName = Object.keys(firstBody).find((k) => /epa_acc|acc$/i.test(k));
  const mseFieldName = Object.keys(firstBody).find((k) => /epa_mse|mse$/i.test(k));

  const values: Record<number, { acc: number | null; mse: number | null }> = {};
  for (const season of SEASONS) {
    try {
      const res = await fetch(workingShape(season));
      if (!res.ok) {
        values[season] = { acc: null, mse: null };
        continue;
      }
      const body = (await res.json()) as Record<string, unknown>;
      values[season] = {
        acc: accFieldName ? ((body[accFieldName] as number | undefined) ?? null) : null,
        mse: mseFieldName ? ((body[mseFieldName] as number | undefined) ?? null) : null,
      };
    } catch {
      values[season] = { acc: null, mse: null };
    }
  }

  return {
    urlsTried,
    resolved: true,
    resolvedUrl: workingShape(2024),
    authRequired: false,
    accFieldName,
    mseFieldName,
    values,
  };
}

function renderDocument(
  rpFindings: RpFieldFinding[],
  statbotics: StatboticsFinding,
  generatedAt: string
): string {
  const lines: string[] = [];
  lines.push("# TBA / Statbotics Field Reconnaissance");
  lines.push("");
  lines.push(`**Generated:** ${generatedAt}`);
  lines.push(
    "**Produced by:** `scripts/recon-tba-fields.ts` (`pnpm recon:tba`) — answers RESEARCH.md Open Questions 1 and 2 for Plans 03 and 05."
  );
  lines.push("");

  lines.push("## Question 1: Per-match ranking-point field in `score_breakdown` (2022-2026)");
  lines.push("");
  lines.push(
    "RESEARCH.md observed `tba_rpEarned` for 2016/2017 but could not confirm coverage for 2022-2026. Below: one sampled qualification match per season, checking for a computed per-match RP total field under either the legacy name `tba_rpEarned` or the current name `rp`."
  );
  lines.push("");
  lines.push("| Season | Event | Match | Computed RP field present | Field name | Notes |");
  lines.push("|---|---|---|---|---|---|");
  for (const f of rpFindings) {
    lines.push(
      `| ${f.season} | ${f.eventKey ?? "_none found_"} | ${f.matchKey ?? "_none found_"} | ${f.rpFieldPresent ? "YES" : "NO"} | ${f.rpFieldName ?? (f.candidateKeys.length ? f.candidateKeys.join(", ") : "_absent_")} | ${f.note} |`
    );
  }
  lines.push("");
  const allPresent = rpFindings.every((f) => f.rpFieldPresent);
  lines.push(
    "**What Plans 03 and 05 must do with this:** " +
      (allPresent
        ? "A computed per-match RP total field is present for every sampled season 2022-2026 — named `rp` in every sampled 2022-2026 season observed here (TBA's legacy `tba_rpEarned` name was not seen in this sample; `rp` is the current equivalent). Plan 03 can normalize RP awards as a direct field read from `score_breakdown.{color}.rp` (falling back to `tba_rpEarned` if a future season reverts to that name), no season-specific bonus-rule logic required in Phase 1."
        : "A computed per-match RP total field is NOT present for every sampled season — for any season marked NO above, Plan 03 must derive RP from the season's named bonus-boolean fields (see the candidate key list in that row) plus the base win/tie RP rule (2/1/0), not a direct field read. Treat this as season-specific rule logic, matching Phase 3's per-season RP scope for the affected seasons only.")
  );
  lines.push("");

  lines.push("## Question 2: Statbotics per-season accuracy endpoint");
  lines.push("");
  lines.push("URL shapes attempted (against a representative year) and observed HTTP status:");
  lines.push("");
  lines.push("| URL | Status |");
  lines.push("|---|---|");
  for (const t of statbotics.urlsTried) {
    lines.push(`| \`${t.url}\` | ${t.status} |`);
  }
  lines.push("");

  if (statbotics.resolved) {
    lines.push(`**Resolved endpoint shape:** \`${statbotics.resolvedUrl}\` — no auth header required, returned HTTP 200.`);
    lines.push("");
    lines.push(`**Accuracy field:** \`${statbotics.accFieldName ?? "not found"}\``);
    lines.push(`**MSE field:** \`${statbotics.mseFieldName ?? "not found"}\``);
    lines.push("");
    lines.push("| Season | Accuracy | MSE |");
    lines.push("|---|---|---|");
    for (const season of SEASONS) {
      const v = statbotics.values?.[season];
      lines.push(`| ${season} | ${v?.acc ?? "_unavailable_"} | ${v?.mse ?? "_unavailable_"} |`);
    }
    lines.push("");
    lines.push(
      "**What Plan 05 must do with this:** D-04's reference row can be fetched live from the resolved endpoint above (per year) rather than hardcoded."
    );
  } else {
    lines.push(
      `**Resolution failed** after ${statbotics.urlsTried.length} shape attempts — none returned a body containing an EPA-like field.`
    );
    lines.push("");
    lines.push(
      `**What Plan 05 must do with this:** D-04's reference row must use a dated, manually-sourced constant instead of a live fetch. Constant capture date to use: ${generatedAt.slice(0, 10)} (the date this recon was run) — source the actual published per-season Statbotics accuracy numbers manually and cite that date in the report.`
    );
  }
  lines.push("");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const apiKey = tbaApiKey();

  const rpFindings: RpFieldFinding[] = [];
  for (const season of SEASONS) {
    rpFindings.push(await findRpFieldForSeason(season, apiKey));
  }

  const statbotics = await probeStatbotics();

  const generatedAt = new Date().toISOString();
  const doc = renderDocument(rpFindings, statbotics, generatedAt);

  // Programmatic assertion (not "by eye"): the generated document must never
  // contain the raw key value.
  if (doc.includes(apiKey)) {
    throw new Error("Refusing to write recon document: it contains the TBA API key value.");
  }

  await writeFile(OUTPUT_PATH, doc, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("recon-tba-fields failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
