// GENERATED, DO NOT EDIT BY HAND.
// Command: npx tsx scripts/measureChampCutoff.ts --write-tuning
// Generated: 2026-10-07
// Source: data/local-publish/districts through the walk-forward selection over CHAMP_CUTOFF_TUNING_GRID; each season's setting is selected on seasons strictly before it
// Quick task 260927-6bf. `--check-history` regenerates this file and fails on any drift.
import type { ChampCutoffTuningEntry } from "./hypotheticalDcmp.js";

export const CHAMP_CUTOFF_TUNING: readonly ChampCutoffTuningEntry[] = [
  { season: 2017, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1 }, fitSeasons: [], fitCount: 0, fitCoverage: null, fitMae: null },
  { season: 2018, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017], fitCount: 9, fitCoverage: 0.888889, fitMae: 14 },
  { season: 2019, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018], fitCount: 19, fitCoverage: 0.842105, fitMae: 13.210526 },
  { season: 2020, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 29, fitCoverage: 0.793103, fitMae: 13.62069 },
  { season: 2021, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 29, fitCoverage: 0.793103, fitMae: 13.62069 },
  { season: 2022, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 29, fitCoverage: 0.793103, fitMae: 13.62069 },
  { season: 2023, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022], fitCount: 37, fitCoverage: 0.702703, fitMae: 17.135135 },
  { season: 2024, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022,2023], fitCount: 47, fitCoverage: 0.723404, fitMae: 16.382979 },
  { season: 2025, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022,2023,2024], fitCount: 56, fitCoverage: 0.714286, fitMae: 16.660714 },
  { season: 2026, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022,2023,2024,2025], fitCount: 67, fitCoverage: 0.716418, fitMae: 17.089552 },
  { season: 2027, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022,2023,2024,2025,2026], fitCount: 81, fitCoverage: 0.716049, fitMae: 17.259259 },
];
