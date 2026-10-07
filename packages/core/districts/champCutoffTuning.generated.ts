// GENERATED, DO NOT EDIT BY HAND.
// Command: npx tsx scripts/measureChampCutoff.ts --write-tuning
// Generated: 2026-10-07
// Source: data/local-publish/districts through the walk-forward selection over CHAMP_CUTOFF_TUNING_GRID; each season's setting is selected on seasons strictly before it
// Quick task 260927-6bf. `--check-history` regenerates this file and fails on any drift.
import type { ChampCutoffTuningEntry } from "./hypotheticalDcmp.js";

export const CHAMP_CUTOFF_TUNING: readonly ChampCutoffTuningEntry[] = [
  { season: 2017, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1 }, fitSeasons: [], fitCount: 0, fitCoverage: null, fitMae: null },
  { season: 2018, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017], fitCount: 10, fitCoverage: 0.9, fitMae: 14.4 },
  { season: 2019, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018], fitCount: 20, fitCoverage: 0.85, fitMae: 13.45 },
  { season: 2020, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 31, fitCoverage: 0.806452, fitMae: 13.741935 },
  { season: 2021, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 31, fitCoverage: 0.806452, fitMae: 13.741935 },
  { season: 2022, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 31, fitCoverage: 0.806452, fitMae: 13.741935 },
  { season: 2023, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022], fitCount: 42, fitCoverage: 0.738095, fitMae: 17.214286 },
  { season: 2024, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022,2023], fitCount: 53, fitCoverage: 0.754717, fitMae: 16.509434 },
  { season: 2025, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022,2023,2024], fitCount: 64, fitCoverage: 0.75, fitMae: 16.609375 },
  { season: 2026, setting: { weighting: "uniform", countMode: "drawn", spreadScale: 1.3 }, fitSeasons: [2017,2018,2019,2022,2023,2024,2025], fitCount: 75, fitCoverage: 0.72, fitMae: 15.493333 },
  { season: 2027, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022,2023,2024,2025,2026], fitCount: 89, fitCoverage: 0.741573, fitMae: 17.168539 },
];
