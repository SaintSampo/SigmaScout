// Fit + emit the per-season RP model, with a calibration sanity check.
//   npm run rp -- 2026

import { fetchSeasonMatches, fetchEvents } from "./fetch";
import { fitRpModel } from "./rp-model";
import { rpConfigFor } from "./rp-config";
import type { ComponentId, Season } from "../src/core/types";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  /* rely on env */
}

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const COMPS: ComponentId[] = ["auto", "teleop", "endgame"];

async function main() {
  const season = (Number(process.argv[2]) || 2026) as Season;
  console.log(`Fitting RP model for ${season}…`);
  const [matches, events] = await Promise.all([
    fetchSeasonMatches(season, true), // refetch for the new RP fields
    fetchEvents(season),
  ]);
  const levelOf = new Map(events.map((e) => [e.key, e]));
  const model = fitRpModel(season, matches, events);

  const full = resolve(DATA_DIR, `rp/${season}.json`);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, JSON.stringify(model));
  console.log(`wrote rp/${season}.json  (win=${model.win} tie=${model.tie} loss=${model.loss})`);

  // Calibration check: over official regular-event alliance-matches, compare
  // predicted P(bonus) to actual achievement, in predicted-probability deciles.
  const cfg = rpConfigFor(season);
  for (let i = 0; i < cfg.bonuses.length; i++) {
    const bm = model.bonuses[i];
    const rows: { p: number; y: number }[] = [];
    let brier = 0;
    for (const m of matches) {
      const ev = levelOf.get(m.eventKey);
      if (!ev?.official || m.redBonuses.length !== cfg.bonuses.length) continue;
      const level = ev.level ?? "regular";
      for (const side of ["red", "blue"] as const) {
        const feats = side === "red" ? m.redByComponent : m.blueByComponent;
        const flags = side === "red" ? m.redBonuses : m.blueBonuses;
        const coef = bm.byLevel[level];
        let z = coef.bias;
        for (const c of COMPS) z += coef.weights[c] * (feats[c] ?? 0);
        const p = sigmoid(z);
        const y = flags[i] ? 1 : 0;
        rows.push({ p, y });
        brier += (p - y) ** 2;
      }
    }
    const rate = rows.reduce((s, r) => s + r.y, 0) / rows.length;
    // 5 buckets by predicted p
    const buckets = [0, 0, 0, 0, 0].map(() => ({ ps: 0, ys: 0, n: 0 }));
    for (const r of rows) {
      const b = Math.min(4, Math.floor(r.p * 5));
      buckets[b].ps += r.p;
      buckets[b].ys += r.y;
      buckets[b].n += 1;
    }
    console.log(`\n  ${bm.name}: actual rate ${(rate * 100).toFixed(0)}%, Brier ${(brier / rows.length).toFixed(3)}`);
    console.log("    predicted→actual by bucket:", buckets
      .filter((b) => b.n > 0)
      .map((b) => `${(100 * b.ps / b.n).toFixed(0)}→${(100 * b.ys / b.n).toFixed(0)}%`)
      .join("  "));
  }
}

main().catch((e) => {
  console.error("\nRP build failed:\n" + (e?.message ?? e));
  process.exit(1);
});
