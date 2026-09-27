// GENERATED, DO NOT EDIT BY HAND.
// Command: npx tsx scripts/measureChampCutoff.ts --write-tuning
// Generated: 2026-09-27
// Source: data/local-publish/districts through the walk-forward selection over CHAMP_CUTOFF_TUNING_GRID; each season's setting is selected on seasons strictly before it
// Quick task 260927-6bf. `--check-history` regenerates this file and fails on any drift.
import type { ChampCutoffTuningEntry } from "./hypotheticalDcmp.js";

export const CHAMP_CUTOFF_TUNING: readonly ChampCutoffTuningEntry[] = [
  { season: 2017, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1 }, fitSeasons: [], fitCount: 0, fitCoverage: null, fitMae: null },
  { season: 2018, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017], fitCount: 10, fitCoverage: 0.9, fitMae: 13.5 },
  { season: 2019, setting: { weighting: "uniform", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018], fitCount: 20, fitCoverage: 0.8, fitMae: 13.15 },
  { season: 2020, setting: { weighting: "decoration", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 31, fitCoverage: 0.774194, fitMae: 13.580645 },
  { season: 2021, setting: { weighting: "decoration", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 31, fitCoverage: 0.774194, fitMae: 13.580645 },
  { season: 2022, setting: { weighting: "decoration", countMode: "fixed", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019], fitCount: 31, fitCoverage: 0.774194, fitMae: 13.580645 },
  { season: 2023, setting: { weighting: "uniform", countMode: "drawn", spreadScale: 1.75 }, fitSeasons: [2017,2018,2019,2022], fitCount: 41, fitCoverage: 0.756098, fitMae: 17.243902 },
  { season: 2024, setting: { weighting: "decoration", countMode: "drawn", spreadScale: 1.5 }, fitSeasons: [2017,2018,2019,2022,2023], fitCount: 52, fitCoverage: 0.75, fitMae: 16 },
  { season: 2025, setting: { weighting: "decoration", countMode: "drawn", spreadScale: 1.5 }, fitSeasons: [2017,2018,2019,2022,2023,2024], fitCount: 63, fitCoverage: 0.746032, fitMae: 15.301587 },
  { season: 2026, setting: { weighting: "uniform", countMode: "drawn", spreadScale: 1.3 }, fitSeasons: [2017,2018,2019,2022,2023,2024,2025], fitCount: 74, fitCoverage: 0.72973, fitMae: 15.378378 },
  { season: 2027, setting: { weighting: "uniform", countMode: "drawn", spreadScale: 1.3 }, fitSeasons: [2017,2018,2019,2022,2023,2024,2025,2026], fitCount: 88, fitCoverage: 0.738636, fitMae: 15.454545 },
];
