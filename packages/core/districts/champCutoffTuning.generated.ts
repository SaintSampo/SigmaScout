// GENERATED, DO NOT EDIT BY HAND.
// Command: npx tsx scripts/measureChampCutoff.ts --write-tuning
// Generated: 2026-09-27
// Source: data/local-publish/districts through the walk-forward selection over CHAMP_CUTOFF_TUNING_GRID; each season's setting is selected on seasons strictly before it
// Quick task 260927-6bf. `--check-history` regenerates this file and fails on any drift.
import type { ChampCutoffTuningEntry } from "./hypotheticalDcmp.js";

export const CHAMP_CUTOFF_TUNING: readonly ChampCutoffTuningEntry[] = [
  { season: 2017, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1 }, fitSeasons: [], fitCount: 0, fitCoverage: null, fitMae: null },
  { season: 2018, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017], fitCount: 10, fitCoverage: 0.9, fitMae: 13.6 },
  { season: 2019, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018], fitCount: 20, fitCoverage: 0.85, fitMae: 13.2 },
  { season: 2020, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 31, fitCoverage: 0.806452, fitMae: 13.612903 },
  { season: 2021, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 31, fitCoverage: 0.806452, fitMae: 13.612903 },
  { season: 2022, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 31, fitCoverage: 0.806452, fitMae: 13.612903 },
  { season: 2023, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022], fitCount: 41, fitCoverage: 0.731707, fitMae: 17.073171 },
  { season: 2024, setting: { weighting: "decoration", countMode: "fixed", spreadScale: 1.5 }, fitSeasons: [2017,2018,2019,2022,2023], fitCount: 52, fitCoverage: 0.730769, fitMae: 15.961538 },
  { season: 2025, setting: { weighting: "decoration", countMode: "fixed", spreadScale: 1.5 }, fitSeasons: [2017,2018,2019,2022,2023,2024], fitCount: 63, fitCoverage: 0.730159, fitMae: 15.333333 },
  { season: 2026, setting: { weighting: "decoration", countMode: "drawn", spreadScale: 1.3 }, fitSeasons: [2017,2018,2019,2022,2023,2024,2025], fitCount: 74, fitCoverage: 0.743243, fitMae: 15.405405 },
  { season: 2027, setting: { weighting: "decoration", countMode: "fixed", spreadScale: 1.3 }, fitSeasons: [2017,2018,2019,2022,2023,2024,2025,2026], fitCount: 88, fitCoverage: 0.727273, fitMae: 15.477273 },
];
