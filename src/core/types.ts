// Shared, framework-free types. Imported by BOTH the React app (browser) and
// the Node/TS pipeline, so the training-time and serving-time contracts can
// never drift apart.

export type TeamKey = number; // FRC team number, e.g. 254
export type Season = number; // e.g. 2024
export type ComponentId = string; // e.g. "auto", "teleop", "endgame"

/** A single team's latent skill on one scoring component: a Gaussian posterior. */
export interface SkillEstimate {
  /** Posterior mean contribution (in that component's points). */
  mean: number;
  /** Posterior variance — the model's uncertainty about `mean`. */
  variance: number;
}

/** Everything the model believes about one team, for one season. */
export interface TeamState {
  team: TeamKey;
  /** Skill estimate per component id. */
  components: Record<ComponentId, SkillEstimate>;
  /** Number of matches observed this season (drives how settled the estimate is). */
  matchesPlayed: number;
  /** ISO timestamp of the last match folded into this estimate. */
  lastUpdated: string;
  /**
   * Season-agnostic strength: the z-score of this team's overall rating within
   * its season (mean 0, sd 1 across established teams). Comparable ACROSS
   * seasons/games, unlike the raw point-scale means. Undefined for teams with
   * too few matches to place reliably.
   */
  normalizedRating?: number;
}

/** Per-season description of the game's scoring structure and fitted noise. */
export interface SeasonModel {
  season: Season;
  /** Ordered scoring components that sum to alliance score. */
  components: ComponentId[];
  /**
   * Irreducible per-alliance residual variance for each component — the part of
   * an alliance's score NOT explained by summing the three teams (game-piece
   * contention, refs, luck). Added once per alliance, not per team.
   */
  residualVariance: Record<ComponentId, number>;
  /**
   * Fitted hyperparameters for THIS season, partially pooled toward the global
   * prior. See HyperParameters.
   */
  hyper: HyperParameters;
}

/**
 * The knobs that govern how the state-space filter behaves. These are fit by
 * maximizing walk-forward predictive accuracy, per season, shrunk toward a
 * global (all-seasons) prior.
 */
export interface HyperParameters {
  /** Random-walk process noise per match — "how fast the model learns." */
  processNoise: Record<ComponentId, number>;
  /**
   * Extra process noise injected across an event boundary (weeks of build/fixes
   * between events cause bigger jumps than match-to-match). Multiplier on
   * processNoise.
   */
  eventGapInflation: number;
  /** Prior variance for a brand-new/rookie team (high = "we know nothing yet"). */
  priorVariance: Record<ComponentId, number>;
  /** Prior mean for a new team, per component (typically a low baseline). */
  priorMean: Record<ComponentId, number>;
}

/** The complete model-state artifact shipped to the browser for one season. */
export interface SeasonStateFile {
  model: SeasonModel;
  teams: TeamState[];
}

/** A scheduled or hypothetical match: two alliances of team numbers. */
export interface MatchupInput {
  red: TeamKey[];
  blue: TeamKey[];
}

/** Predicted Gaussian for one alliance's score. */
export interface AlliancePrediction {
  mean: number;
  variance: number;
  /** Contribution breakdown by component (means). */
  byComponent: Record<ComponentId, number>;
}

/** Full prediction for a matchup. */
export interface MatchPrediction {
  red: AlliancePrediction;
  blue: AlliancePrediction;
  /** P(red score > blue score). */
  redWinProbability: number;
  /** Expected red − blue margin. */
  predictedMargin: number;
  /** Teams requested but missing from the model (treated with season prior). */
  missingTeams: TeamKey[];
}

/** Global (all-seasons) tuned hyperparameters — the top tier of the hierarchy. */
export interface GlobalTuning {
  /** Learning-rate multiplier (process noise Q = alpha * R). */
  alpha: number;
  /** Cross-season carryover strength in [0,1]. */
  rho: number;
  /** Adaptive-gain strength (0 = off). */
  kappa: number;
}

/** Top-level manifest the client loads first to discover available data. */
export interface Manifest {
  generatedAt: string;
  seasons: Season[];
  /** Global tuned hyperparameters shared across seasons. */
  tuning: GlobalTuning;
}

// --- Site data model (browsable pages: teams, events, matches) ---

/** A prediction snapshot: for a played match, as of just before it started; for
 *  an unplayed match, the current best estimate. */
export interface PredictionSnapshot {
  /** P(red wins). */
  redWinProb: number;
  /** Predicted alliance score means. */
  redScore: number;
  blueScore: number;
}

/** A single match: schedule + (if played) result + its prediction snapshot. */
export interface MatchRecord {
  key: string;
  event: string;
  compLevel: string; // qm | ef | qf | sf | f
  setNumber: number;
  matchNumber: number;
  time?: string; // ISO
  red: TeamKey[];
  blue: TeamKey[];
  played: boolean;
  /** Actual alliance totals — present only when played. */
  redActual?: number;
  blueActual?: number;
  /** Actual ranking points earned per alliance — present only for played quals. */
  redRp?: number;
  blueRp?: number;
  /** The prediction shown for this match (pre-match if played, else current). */
  prediction: PredictionSnapshot;
}

/** Event metadata for display. */
export interface EventInfo {
  key: string;
  name: string;
  shortName?: string;
  week?: number;
  city?: string;
  startDate?: string;
  endDate?: string;
  /** Level bucket for RP thresholds: regular events vs championship-level. */
  level?: "regular" | "champ";
  /** True for official competition events (excludes off/pre-season). */
  official?: boolean;
  /** True for offseason events (e.g. IRI) — shown in the directory, but not
   *  used to fit the RP model. */
  offseason?: boolean;
}

/** One team's participation in a single event. */
export interface TeamEventSummary {
  event: string;
  name: string;
  week?: number;
  wins: number;
  losses: number;
  ties: number;
}

/** Everything a team's season page needs, self-contained for one fetch. */
export interface TeamSeasonData {
  team: TeamKey;
  season: Season;
  name?: string;
  /** End-of-season rating. */
  components: Record<ComponentId, SkillEstimate>;
  overall: number;
  normalizedRating?: number;
  /**
   * Match-to-match tolerance in points: the standard deviation of how far this
   * team's alliance landed from its prediction each match (± points). Lower =
   * steadier. Naturally scales with scoring level (a 400-pt team swings more in
   * absolute points than a 20-pt team). In that season's point scale. Undefined
   * if too few matches to estimate.
   */
  tolerance?: number;
  componentIds: ComponentId[];
  matchesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  events: TeamEventSummary[];
  /** This team's matches, time-ordered, with pre-match predictions + results. */
  matches: MatchRecord[];
}

/** One row in a season's team directory/index. */
export interface TeamIndexEntry {
  team: TeamKey;
  name?: string;
  overall: number;
  normalizedRating?: number;
  /** Match-to-match tolerance in points (± points; lower = steadier). */
  tolerance?: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
}

/** A season's team directory, loaded for the team browser. */
export interface SeasonTeamsIndex {
  season: Season;
  teams: TeamIndexEntry[];
}

// --- Ranking points, rankings, alliances, event data, simulation ---

/** A logistic model for one bonus RP: P = sigmoid(bias + Σ weight_c · score_c),
 *  with separate coefficients for regular vs championship-level events. */
export interface RpBonusModel {
  name: string;
  byLevel: Record<
    "regular" | "champ",
    { bias: number; weights: Record<ComponentId, number> }
  >;
}

/** Per-season ranking-point model consumed by the simulator (shipped as JSON). */
export interface RpSeasonModel {
  season: Season;
  /** Base RP for win / tie / loss. */
  win: number;
  tie: number;
  loss: number;
  /** Bonus RPs, each predicted from the alliance's earned component scores. */
  bonuses: RpBonusModel[];
  componentIds: ComponentId[];
}

/** One row of an event's actual ranking table. */
export interface RankingRow {
  rank: number;
  team: TeamKey;
  /** Ranking score = average RP (the primary sort). */
  rankingScore: number;
  /** Total ranking points. */
  rp: number;
  wins: number;
  losses: number;
  ties: number;
  matchesPlayed: number;
}

/** A playoff alliance: captain plus its picks, in selection order. */
export interface AllianceSelection {
  number: number;
  picks: TeamKey[]; // [captain, pick1, pick2, (backup)]
}

/** A team as it appears on an event page (rating for the simulator + name). */
export interface EventTeam {
  team: TeamKey;
  name?: string;
  components: Record<ComponentId, SkillEstimate>;
}

/** Everything an event page needs, self-contained for one fetch. */
export interface EventData {
  event: EventInfo;
  componentIds: ComponentId[];
  /** Irreducible per-alliance score variance per component — for the simulator. */
  residualVariance: Record<ComponentId, number>;
  teams: EventTeam[];
  qualMatches: MatchRecord[];
  elimMatches: MatchRecord[];
  alliances: AllianceSelection[];
  rankings: RankingRow[];
}

/** One row in the events directory. */
export interface EventIndexEntry {
  key: string;
  name: string;
  week?: number;
  teamCount: number;
  startDate?: string;
}

export interface SeasonEventsIndex {
  season: Season;
  events: EventIndexEntry[];
}

/** Simulated ranking outcome distribution for one team. */
export interface TeamSimResult {
  team: TeamKey;
  meanRank: number;
  medianRank: number;
  sdRank: number;
  /** 5th and 95th percentile ranks. */
  p5Rank: number;
  p95Rank: number;
  /** Probabilities across N sims. */
  pRank1: number;
  pTop8: number;
  /** Projected final ranking points (mean). */
  meanRp: number;
}

export interface SimSettings {
  /** Simulate qual matches at or after this qual match number; earlier ones use
   *  actual results. */
  fromQualMatch: number;
  iterations: number;
}

