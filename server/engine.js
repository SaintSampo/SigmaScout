'use strict';
/**
 * engine.js — SigmaScout Analytics Core
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  4-DIMENSIONAL TEAM RATING  (EPA, epaSigma, defense, defSigma)         ║
 * ║  + CONTINUOUS TIME-ALLOCATION MODEL  (tOff, tDef, tDead per match)     ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ─── STANDARD KALMAN FILTER ─────────────────────────────────────────────────
 * State:  x   EPA or defense rating (scalar)
 * Noise:  P   estimated variance of that state
 *
 * Predict step  — rating can drift between matches:
 *   P⁻ = P + Q
 *
 * Update step   — fuse new observation z, measurement noise R:
 *   K  = P⁻ / (P⁻ + R)          ← Kalman gain ∈ (0,1)
 *   x' = x + K·(z − x)          ← move toward measurement
 *   P' = (1 − K)·P⁻             ← uncertainty shrinks
 *
 * ─── FRACTIONAL KALMAN EXTENSION ────────────────────────────────────────────
 * When a robot spends only fraction τ of the match in role r, the update
 * weight is scaled by τ so the peak-capability estimate is preserved:
 *
 *   Keff = τ · K
 *   x'   = x + Keff · (z − x)       ← softer pull toward obs when τ < 1
 *   P'   = (1 − Keff) · P⁻          ← less certainty gained when τ < 1
 *
 * τ = 0 → x unchanged; P grows by Q (no info about this dimension this match)
 * τ = 1 → standard Kalman (full observation of this dimension)
 *
 * ─── TIME-COEFFICIENT ESTIMATION ─────────────────────────────────────────────
 * For each robot per match we infer (tOff, tDef, tDead) with tOff+tDef+tDead=1
 * by comparing observed offensive/defensive output against confidence-blended
 * reference peaks.  Opponent defensive pressure is partially credited back to
 * the robot's offensive observation so being heavily defended doesn't inflate
 * its breakdown (tDead) attribution.
 *
 * ─── MONTE CARLO ROLE SAMPLING ───────────────────────────────────────────────
 * For teams with roleVolatility > VOLATILITY_THRESH and ≥ MIN_ROLE_MATCHES:
 *   1. Sample tOff ~ N(avgTOff, roleVolatility), clamped [0,1]
 *   2. Sample tDead ~ N(avgTDead, tDeadSigma), clamped [0, 1−tOff]
 *   3. tDef = remaining time × historical defense-time share
 *   4. Scale effective EPA and defense by (sampled / historical-avg) ratio
 * This lets a historically role-volatile team produce divergent outcomes across
 * simulation runs, correctly widening the predicted score distribution.
 */

// ── HYPERPARAMETERS — CORE KALMAN ──────────────────────────────────────────
// Tune R (measurement noise) and Q (process noise) to balance adaptation speed.

const R_EPA  = 400;   // Measurement noise variance for EPA    (≈ σ_obs = 20 pts)
const R_DEF  = 225;   // Measurement noise variance for defense (≈ σ_obs = 15 pts)
const Q_EPA  = 6;     // Process noise: how many pts² EPA can drift between matches
const Q_DEF  = 2;     // Process noise for defense

const INIT_EPA     = 15;   // Prior mean EPA per robot (reasonable FRC baseline)
const INIT_DEF     = 4;    // Prior mean defensive suppression per robot
const INIT_EPA_VAR = 900;  // Prior variance σ² = 30² — very uncertain at first match
const INIT_DEF_VAR = 400;  // Prior variance σ² = 20²

// ── HYPERPARAMETERS — TIME-ALLOCATION MODEL ────────────────────────────────

const MATCH_CONF_RAMP   = 8;    // Matches before the reference EPA/defense is fully trusted
                                 // Below this count, priors are blended in to stabilise estimates
const OPP_DEF_CREDIT    = 0.30; // Fraction of opponent's defensive obs credited back to a
                                 // suppressed robot's offensive obs (prevents breakdown over-attribution)
const EMA_ALPHA         = 0.30; // Exponential-moving-average weight for avgTOff/avgTDef/avgTDead
                                 // Higher → adapts faster but noisier; lower → smoother but lags
const T_WINDOW          = 10;   // Last N matches used for roleVolatility / tDeadSigma computation
const VOLATILITY_THRESH = 0.15; // roleVolatility (σ of tOff history) above which Monte Carlo
                                 // activates per-run role sampling instead of point estimates
const MIN_ROLE_MATCHES  = 3;    // Minimum matches before role sampling is enabled
const MAX_ROLE_SCALE    = 3.0;  // Cap on (sampled_t / avg_t) scaling ratio to prevent extreme values
const MIN_ROLE_TAU      = 0.08; // Time fraction below which we skip the role-specific Kalman update.
                                 // Below this threshold the equal-share observation (allianceScore/3)
                                 // is dominated by the other two robots' contributions, making
                                 // z/τ extrapolation too noisy to be useful. Only Q is applied
                                 // (process noise grows, reflecting that we learned nothing about
                                 // this dimension this match). Tune down to ~0.04 if you want even
                                 // partial-defense matches to contribute some EPA signal.

// ── HYPERPARAMETERS — MONTE CARLO ──────────────────────────────────────────

const MC_RUNS          = 1000;  // Simulation trials per match prediction
const GAME_NOISE_SIGMA = 8;     // Residual match-level randomness (refs, field, luck) in pts
const MIN_SIGMA        = 3;     // Floor σ used in sampling to avoid degenerate distributions

// ── HELPERS ────────────────────────────────────────────────────────────────

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const lerp    = (a, b, t) => a + (b - a) * t;

function mean(arr) {
  let s = 0; for (const v of arr) s += v; return s / arr.length;
}
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr); let ssq = 0;
  for (const v of arr) ssq += (v - m) ** 2;
  return Math.sqrt(ssq / arr.length);
}

function normalSample(mu, sigma) {
  // Box-Muller transform: exact Gaussian sampling
  const u1 = Math.max(Math.random(), 1e-10);
  const u2 = Math.random();
  return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── TEAM STATE ─────────────────────────────────────────────────────────────

function createTeam(teamKey) {
  return {
    teamKey,

    // ── Core Kalman state ──────────────────────────────────────────────────
    epa:        INIT_EPA,
    epaVar:     INIT_EPA_VAR,    // variance (σ²); √epaVar = "Offensive Reliability"
    defense:    INIT_DEF,
    defenseVar: INIT_DEF_VAR,
    matchCount: 0,

    // Per-match history for trend charts
    epaHistory: [],   // [{epa, sigma}]
    defHistory: [],   // [{defense, sigma}]

    // ── Time-allocation state ──────────────────────────────────────────────
    tOffHistory:  [],   // tOff per match (bounded to last T_WINDOW entries)
    tDefHistory:  [],   // tDef per match
    tDeadHistory: [],   // tDead per match

    // Exponential moving averages — current best estimate of "typical" allocation
    avgTOff:  1.0,   // most robots start assumed to be full-time offense
    avgTDef:  0.0,
    avgTDead: 0.0,

    // Derived volatility metrics (computed after each update)
    roleVolatility: 0.0,   // σ of recent tOff values — how often does this team switch roles?
    tDeadSigma:     0.0,   // σ of recent tDead values — how consistently is breakdown risk?
  };
}

const getEpaSigma = (t) => Math.sqrt(t.epaVar);
const getDefSigma = (t) => Math.sqrt(t.defenseVar);

// ── TIME-COEFFICIENT ESTIMATION ────────────────────────────────────────────
/**
 * Infers (tOff, tDef, tDead) for a robot given its per-match observations.
 *
 * @param {object} team         - current team state (before this match's Kalman update)
 * @param {number} offObs       - observed offensive contribution (allianceScore / 3)
 * @param {number} defObs       - observed defensive suppression (expectedOpp − actualOpp) / 3
 * @param {number} opponentDefObs - opponent's per-robot defensive contribution this match;
 *                                  used to partially restore suppressed offensive output
 *                                  so being defended doesn't over-inflate tDead
 * @returns {{ tOff, tDef, tDead }} fractions summing to 1.0
 *
 * Math overview:
 *   refEpa = lerp(INIT_EPA, team.epa, matchConf)   ← confidence-blended reference peak
 *   corrOff = offObs + OPP_DEF_CREDIT * opponentDefObs
 *   normOff = clamp01(corrOff / refEpa)             ← how much of peak offense was observed?
 *   normDef = clamp01(defObs  / refDef)
 *   tDead   = clamp01(1 − normOff − normDef)        ← activity gap → breakdown / suppression
 *   tOff/tDef split remaining active time proportionally to normOff/normDef
 */
function estimateTimeCoefficients(team, offObs, defObs, opponentDefObs = 0) {
  // Confidence ramp: blend priors in while we have few matches to prevent wild early estimates
  const matchConf = Math.min(1.0, team.matchCount / MATCH_CONF_RAMP);
  const refEpa = lerp(INIT_EPA, Math.max(team.epa, INIT_EPA * 0.3), matchConf);
  const refDef = lerp(INIT_DEF, Math.max(team.defense, 0.5),         matchConf);

  // Opponent-defense credit: restore a fraction of the output that was actively suppressed.
  // Without this, heavy defensive matchups would falsely show high tDead for the
  // offense-side team even when their robot was functioning perfectly.
  const correctedOffObs = Math.max(0, offObs + OPP_DEF_CREDIT * Math.max(0, opponentDefObs));

  // Normalize against reference peaks: 0 = no output, 1 = full output (>1 → clamped to 1)
  const normOff = clamp01(correctedOffObs             / Math.max(refEpa, 0.5));
  const normDef = clamp01(Math.max(0, defObs)         / Math.max(refDef, 0.5));

  const totalSignal = normOff + normDef;

  // tDead: proportion of the match where the robot contributed nothing to either role.
  // This can arise from: mechanical breakdown, very heavy opponent defense, or strategic
  // idleness. The OPP_DEF_CREDIT correction reduces false-positive breakdown attribution.
  const tDead = clamp01(1.0 - Math.min(1.0, totalSignal));

  const activeFrac = 1.0 - tDead;
  let tOff, tDef;

  if (totalSignal > 1e-6) {
    // Split active time in proportion to the normalized outputs
    tOff = (normOff / totalSignal) * activeFrac;
    tDef = (normDef / totalSignal) * activeFrac;
  } else {
    // Robot contributed nothing to either dimension → fully dead this match
    tOff = 0.0;
    tDef = 0.0;
  }

  // Floating-point safety: guarantee exact partition
  const total = tOff + tDef + tDead;
  return { tOff: tOff / total, tDef: tDef / total, tDead: tDead / total };
}

// ── ROLE-AWARE KALMAN UPDATE ───────────────────────────────────────────────
/**
 * Kalman update that preserves peak-capability estimates when a robot spends
 * only fraction τ of the match in a given role.
 *
 * Core idea — observation normalization:
 *   The raw observation z = allianceScore/3 represents what the robot contributed
 *   averaged over the FULL match.  When τ < 1, the robot was only active in this
 *   role for a fraction of the time, so z understimates the per-role-unit rate.
 *
 *   We recover the implied peak rate and propagate the associated noise:
 *     zScaled = z / τ         ← implied peak rate during active role time
 *     RScaled = R / τ²        ← measurement noise amplifies as 1/τ² from the division
 *
 *   Then run the standard Kalman update with (zScaled, RScaled):
 *     K    = P⁻ / (P⁻ + RScaled)
 *     x'   = x + K · (zScaled − x)
 *     P'   = (1 − K) · P⁻
 *
 * Boundary behaviour:
 *   τ = 1  → zScaled = z, RScaled = R  → identical to standard Kalman ✓
 *   τ → 0  → RScaled → ∞ → K → 0 → x' = x, P' = P⁻ = P+Q (no update, Q grows) ✓
 *   τ < MIN_ROLE_TAU → skip update entirely; only process noise Q applied.
 *                       At this threshold the equal-share noise is so dominant
 *                       that z/τ is too noisy to be informative.
 *
 * Net effect: a robot playing defense for 70% of a match will have its EPA updated
 * using an implied rate 3.4× higher than the raw observation (z/0.294), but with
 * measurement noise 11.6× larger (R/0.294²), resulting in a Kalman gain ~1/12 of
 * normal — only a ~1–2 pt EPA shift instead of the ~9 pt drag from naive Keff·K.
 */
function kalmanUpdateRoleAware(x, P, z, R, Q, tau) {
  // Predict: always add process noise — the rating can drift even when unobserved
  const Ppred = P + Q;

  if (tau < MIN_ROLE_TAU) {
    // Insufficient role time: the equal-share observation z is dominated by the
    // other two robots' contributions. Skip the state update; let P grow by Q,
    // reflecting that we gained no information about this dimension this match.
    return { value: x, variance: Ppred };
  }

  const zScaled = z / tau;          // implied peak rate per unit active role time
  const RScaled = R / (tau * tau);  // 1/τ² noise amplification from the division

  const K    = Ppred / (Ppred + RScaled);
  const xNew = x + K * (zScaled - x);
  const PNew = (1 - K) * Ppred;

  return { value: xNew, variance: PNew };
}

// ── PER-MATCH OBSERVATION DECOMPOSITION ───────────────────────────────────
/**
 * From alliance-level scores, derive per-robot offensive and defensive observations.
 *
 * Offensive obs  (per robot) = allianceScore / 3   [equal-share approximation]
 * Defensive obs  (per robot) = (sum(opponent.epa) − opponentScore) / 3
 *   positive → our defense suppressed opponent below their expected output
 *   negative → opponent outperformed their expected EPA (our defense had no effect)
 *
 * The Kalman filter tolerates this noisy equal-share attribution; over many matches
 * the estimates converge toward individual robots' true contributions.
 */
function computeObservations(redTeamObjs, blueTeamObjs, redScore, blueScore) {
  const blueExpectedOff = blueTeamObjs.reduce((s, t) => s + t.epa, 0);
  const redExpectedOff  = redTeamObjs.reduce((s, t) => s + t.epa, 0);

  return {
    redOffObs:  redScore  / 3,
    blueOffObs: blueScore / 3,
    // Signed: positive = defense helped, negative = opponent outperformed
    redDefObs:  (blueExpectedOff - blueScore) / 3,
    blueDefObs: (redExpectedOff  - redScore)  / 3,
  };
}

// ── SINGLE TEAM UPDATE ─────────────────────────────────────────────────────
/**
 * Updates one team's state after a match using:
 *   1. Time-coefficient estimation  → tOff, tDef, tDead
 *   2. EMA + history update         → avgTOff, avgTDef, avgTDead, roleVolatility, tDeadSigma
 *   3. Fractional Kalman update     → EPA gain × tOff, defense gain × tDef
 *
 * @param {object} team           - team state object (mutated in place)
 * @param {number} offObs         - per-robot offensive observation (allianceScore / 3)
 * @param {number} defObs         - per-robot defensive observation
 * @param {number} opponentDefObs - per-robot defensive observation of the OPPOSING alliance
 *                                  (what was being used to suppress this robot's offense)
 */
function applyTeamUpdate(team, offObs, defObs, opponentDefObs = 0) {
  // ── Step 1: Estimate time allocation for this match ───────────────────────
  const { tOff, tDef, tDead } = estimateTimeCoefficients(team, offObs, defObs, opponentDefObs);

  // ── Step 2: Update rolling time-allocation history ────────────────────────
  // Store bounded history window for volatility computation
  team.tOffHistory.push(tOff);
  team.tDefHistory.push(tDef);
  team.tDeadHistory.push(tDead);
  if (team.tOffHistory.length  > T_WINDOW) team.tOffHistory.shift();
  if (team.tDefHistory.length  > T_WINDOW) team.tDefHistory.shift();
  if (team.tDeadHistory.length > T_WINDOW) team.tDeadHistory.shift();

  // Exponential moving averages: track "typical" role split in real time
  // EMA(n) = α·new + (1−α)·old  — initialise from the first observation
  if (team.matchCount === 0) {
    team.avgTOff  = tOff;
    team.avgTDef  = tDef;
    team.avgTDead = tDead;
  } else {
    team.avgTOff  = EMA_ALPHA * tOff  + (1 - EMA_ALPHA) * team.avgTOff;
    team.avgTDef  = EMA_ALPHA * tDef  + (1 - EMA_ALPHA) * team.avgTDef;
    team.avgTDead = EMA_ALPHA * tDead + (1 - EMA_ALPHA) * team.avgTDead;
  }

  // Role volatility: σ of tOff over the last T_WINDOW matches.
  // High value → team switches between offense and defense frequently.
  // Low value  → specialist (consistently offense or consistently defense).
  team.roleVolatility = stdDev(team.tOffHistory);

  // tDead consistency: σ of breakdown rate — used for Monte Carlo dead-time sampling.
  team.tDeadSigma = stdDev(team.tDeadHistory);

  // ── Step 3: Role-aware Kalman updates ────────────────────────────────────
  //
  // EPA update — uses observation normalization (z/tOff, R/tOff²):
  //   • tOff ≈ 1 → standard Kalman update (zScaled ≈ z, RScaled ≈ R)
  //   • tOff ≈ 0.3 → zScaled is the implied peak rate; RScaled is 11× larger
  //     → K becomes ~1/12 of normal → ~1–2 pt EPA shift instead of a 9 pt drag
  //   • tOff < MIN_ROLE_TAU → skip update; only process noise Q applied
  //     → σ (epaSigma) grows, correctly reflecting that we learned nothing new
  //   This preserves the team's peak-capability EPA estimate across defensive matches.
  const epaUpd = kalmanUpdateRoleAware(team.epa, team.epaVar, offObs, R_EPA, Q_EPA, tOff);

  // Defense update — same normalization logic applied to the defensive dimension:
  //   • tDef ≈ 1 → full defensive match → normal defense rating update
  //   • tDef ≈ 0 → robot on offense → preserve peak defensive estimate
  const defUpd = kalmanUpdateRoleAware(team.defense, team.defenseVar, defObs, R_DEF, Q_DEF, tDef);

  team.epa        = epaUpd.value;
  team.epaVar     = epaUpd.variance;
  team.defense    = defUpd.value;
  team.defenseVar = defUpd.variance;
  team.matchCount += 1;

  // Append to trend history
  team.epaHistory.push({ epa: +team.epa.toFixed(2), sigma: +getEpaSigma(team).toFixed(2), tOff: +tOff.toFixed(3) });
  team.defHistory.push({ defense: +team.defense.toFixed(2), sigma: +getDefSigma(team).toFixed(2), tDef: +tDef.toFixed(3) });
}

// ── MATCH-LEVEL UPDATE (mutates teamMap in place) ─────────────────────────

function updateTeamsAfterMatch(redKeys, blueKeys, redScore, blueScore, teamMap) {
  const get  = (k) => { if (!teamMap[k]) teamMap[k] = createTeam(k); return teamMap[k]; };
  const redO = redKeys.map(get);
  const bluO = blueKeys.map(get);

  const { redOffObs, blueOffObs, redDefObs, blueDefObs } =
    computeObservations(redO, bluO, redScore, blueScore);

  // Pass the OPPONENT'S defensive observation as the suppression context:
  //   Red robots' offense was potentially suppressed by blue's defense → pass blueDefObs
  //   Blue robots' offense was potentially suppressed by red's defense → pass redDefObs
  redO.forEach((t) => applyTeamUpdate(t, redOffObs, redDefObs, blueDefObs));
  bluO.forEach((t) => applyTeamUpdate(t, blueOffObs, blueDefObs, redDefObs));
}

// ── EVENT MATCH PROCESSING ─────────────────────────────────────────────────

function processEventMatches(matches) {
  const teamMap = {};
  for (const m of sortAndFilterMatches(matches)) {
    updateTeamsAfterMatch(
      m.alliances.red.team_keys, m.alliances.blue.team_keys,
      m.alliances.red.score,     m.alliances.blue.score,
      teamMap,
    );
  }
  return teamMap;
}

/**
 * Processes matches chronologically, predicting BEFORE each match's update.
 * Completed matches: predict → update ratings.
 * Future matches:   predict only (no update).
 */
function processEventMatchesWithPredictions(matches) {
  const teamMap = {};
  const sorted  = matches
    .filter((m) => m.alliances?.red?.team_keys?.length > 0)
    .sort((a, b) => (a.time || 0) - (b.time || 0));

  const enrichedMatches = sorted.map((m) => {
    const red      = m.alliances.red;
    const blue     = m.alliances.blue;
    const isPlayed = red.score >= 0 && blue.score >= 0;

    const prediction = simulateMatch(red.team_keys, blue.team_keys, teamMap);

    if (isPlayed) {
      updateTeamsAfterMatch(red.team_keys, blue.team_keys, red.score, blue.score, teamMap);
    }

    return {
      key:            m.key,
      comp_level:     m.comp_level,
      match_number:   m.match_number,
      set_number:     m.set_number,
      time:           m.time,
      predicted_time: m.predicted_time,
      red_teams:      red.team_keys,
      blue_teams:     blue.team_keys,
      prediction,
      result: isPlayed ? {
        redScore:  red.score,
        blueScore: blue.score,
        winner: m.winning_alliance || (red.score > blue.score ? 'red' : blue.score > red.score ? 'blue' : 'tie'),
      } : null,
    };
  });

  return { teamMap, enrichedMatches };
}

// ── MONTE CARLO ROLE SAMPLER ───────────────────────────────────────────────
/**
 * Samples a single robot's offensive and defensive contribution for one
 * Monte Carlo trial, with optional role-allocation perturbation for volatile teams.
 *
 * Standard model (low volatility or few matches):
 *   Samples directly from N(epa, σ) and N(defense, σ_def).
 *   The EPA already reflects the team's typical role mix encoded via fractional Kalman.
 *
 * Role-volatile model (roleVolatility > VOLATILITY_THRESH, matchCount ≥ MIN_ROLE_MATCHES):
 *   1. Sample tOff_run ~ N(avgTOff, roleVolatility), clamped [0,1]
 *      → how much of this simulated match will the robot spend on offense?
 *   2. Sample tDead_run ~ N(avgTDead, tDeadSigma), clamped [0, 1−tOff_run]
 *      → how much time is the robot broken down or heavily pinned?
 *   3. Remaining time split by historical tDef/(tOff+tDef) ratio → tDef_run
 *   4. Scale EPA by (tOff_run / avgTOff):
 *      — if avgTOff=0.65 and tOff_run=0.9, the robot is going heavy offense this match
 *        → its scoring rate scales up proportionally (×1.38)
 *      — if tOff_run=0.2, it went heavy defense → scoring rate scales down (×0.31)
 *   5. Similarly scale defense by (tDef_run / avgTDef)
 *   6. Finally sample from N(scaled_epa, σ_epa·offScale) accounting for expanded
 *      distribution when the robot operates far from its typical role mix.
 *
 * Caps offScale/defScale at MAX_ROLE_SCALE to prevent numerically extreme outliers.
 */
function sampleTeamContribution(team) {
  const epaSigma = getEpaSigma(team);
  const defSigma = getDefSigma(team);

  const useRoleSampling =
    team.roleVolatility > VOLATILITY_THRESH &&
    team.matchCount     >= MIN_ROLE_MATCHES;

  if (!useRoleSampling) {
    // Standard path: point-estimate role mix, sample from rating distributions
    return {
      offense: normalSample(team.epa,     Math.max(epaSigma, MIN_SIGMA)),
      defense: Math.max(0, normalSample(team.defense, Math.max(defSigma, MIN_SIGMA))),
    };
  }

  // ── Role-volatile path ────────────────────────────────────────────────────

  // 1. Sample offensive time fraction for this simulation run
  const tOffRun = clamp01(normalSample(team.avgTOff, team.roleVolatility));

  // 2. Sample dead time (breakdown risk) — clamped so total ≤ 1
  const tDeadRun = clamp01(
    normalSample(team.avgTDead, Math.max(team.tDeadSigma, 0.03)),
  );
  const liveAfterOff = Math.max(0, 1 - tOffRun - tDeadRun);

  // 3. Defense gets the remaining live time, scaled by historical tDef ratio
  const defShare = team.avgTDef / Math.max(team.avgTOff + team.avgTDef, 1e-6);
  const tDefRun  = liveAfterOff * defShare;

  // 4+5. Compute scaling ratios capped at MAX_ROLE_SCALE
  // offScale > 1 → more offense than usual → higher scoring rate this match
  // offScale < 1 → less offense than usual → lower scoring rate
  const offScale = Math.min(MAX_ROLE_SCALE, tOffRun  / Math.max(team.avgTOff, 0.1));
  const defScale = Math.min(MAX_ROLE_SCALE, tDefRun  / Math.max(team.avgTDef, 0.05));

  const effectiveEpa = team.epa     * offScale;
  const effectiveDef = team.defense * defScale;

  // 6. Sample from scaled distributions
  // σ also scales so that operating far from typical mix increases spread appropriately
  return {
    offense: normalSample(effectiveEpa, Math.max(epaSigma * offScale, MIN_SIGMA)),
    defense: Math.max(0, normalSample(effectiveDef, Math.max(defSigma * defScale, MIN_SIGMA))),
  };
}

// ── MONTE CARLO MATCH SIMULATION ──────────────────────────────────────────
/**
 * Runs MC_RUNS independent trials of a 3v3 match.
 *
 * Each trial:
 *   • Samples each robot's (offense, defense) via sampleTeamContribution()
 *   • Adds shared game-level noise N(0, GAME_NOISE_SIGMA) — refs, field, luck
 *   • red_net = max(0, Σred_off − Σblue_def + noise)
 *   • blue_net = max(0, Σblue_off − Σred_def − noise)
 *
 * Outputs win probabilities, projected scores, margin σ, and a volatility rating.
 */
function simulateMatch(redKeys, blueKeys, teamMap) {
  const get  = (k) => teamMap[k] || createTeam(k);
  const red  = redKeys.map(get);
  const blue = blueKeys.map(get);

  let redWins = 0, blueWins = 0, ties = 0;
  const redScores = new Float64Array(MC_RUNS);
  const bluScores = new Float64Array(MC_RUNS);
  const margins   = new Float64Array(MC_RUNS);

  for (let i = 0; i < MC_RUNS; i++) {
    let rOff = 0, bOff = 0, rDef = 0, bDef = 0;

    // Use the role-aware sampler for each robot
    for (const t of red) {
      const s = sampleTeamContribution(t);
      rOff += s.offense;
      rDef += s.defense;
    }
    for (const t of blue) {
      const s = sampleTeamContribution(t);
      bOff += s.offense;
      bDef += s.defense;
    }

    // Shared game-level noise (positive → good day for red, bad for blue)
    const gNoise = normalSample(0, GAME_NOISE_SIGMA);

    const rNet = Math.max(0, rOff - bDef + gNoise);
    const bNet = Math.max(0, bOff - rDef - gNoise);

    redScores[i] = rNet;
    bluScores[i] = bNet;
    margins[i]   = rNet - bNet;

    if (rNet > bNet)      redWins++;
    else if (bNet > rNet) blueWins++;
    else                  ties++;
  }

  const avgRed  = mean(redScores);
  const avgBlue = mean(bluScores);
  const mStd    = stdDev(margins);
  const avgMax  = (avgRed + avgBlue) / 2;

  const volatilityRating = Math.min(10, (mStd / Math.max(avgMax, 1)) * 10);

  return {
    redWinProb:         +(redWins  / MC_RUNS).toFixed(4),
    blueWinProb:        +(blueWins / MC_RUNS).toFixed(4),
    tieProb:            +(ties     / MC_RUNS).toFixed(4),
    redProjectedScore:  +avgRed.toFixed(1),
    blueProjectedScore: +avgBlue.toFixed(1),
    marginStdDev:       +mStd.toFixed(1),
    volatilityRating:   +volatilityRating.toFixed(1),
  };
}

// ── TEAM RANKINGS ─────────────────────────────────────────────────────────
/**
 * Composite score formula:
 *   epa × 0.63 + defense × 0.24 − epaSigma × 0.05 − defSigma × 0.04
 *   − roleVolatility × 5
 *
 * The roleVolatility penalty (~1pt per 0.20 σ) is modest — role-switching isn't
 * inherently bad, but it adds predictive uncertainty that scouts should note.
 * avgTDead is surfaced for display but NOT penalised in composite: the EPA
 * already encodes actual average contribution (fractional Kalman means EPA
 * converges to observed output, which includes dead-time drag).
 */
function rankTeams(teamMap) {
  return Object.values(teamMap)
    .map((t) => {
      const epaSigma  = +getEpaSigma(t).toFixed(2);
      const defSigma  = +getDefSigma(t).toFixed(2);
      const composite = +(
        t.epa * 0.63 +
        t.defense * 0.24 -
        epaSigma * 0.05 -
        defSigma * 0.04 -
        t.roleVolatility * 5
      ).toFixed(2);
      return {
        ...t,
        epa:            +t.epa.toFixed(2),
        defense:        +t.defense.toFixed(2),
        epaSigma,
        defSigma,
        composite,
        avgTOff:        +t.avgTOff.toFixed(3),
        avgTDef:        +t.avgTDef.toFixed(3),
        avgTDead:       +t.avgTDead.toFixed(3),
        roleVolatility: +t.roleVolatility.toFixed(3),
      };
    })
    .sort((a, b) => b.composite - a.composite)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}

// ── SORT + FILTER HELPERS ──────────────────────────────────────────────────

function sortAndFilterMatches(matches) {
  return matches
    .filter((m) => {
      const r = m.alliances?.red;
      const b = m.alliances?.blue;
      return r?.team_keys?.length > 0 && b?.team_keys?.length > 0
          && r.score >= 0 && b.score >= 0;
    })
    .sort((a, b) => (a.time || 0) - (b.time || 0));
}

module.exports = {
  createTeam,
  updateTeamsAfterMatch,
  processEventMatches,
  processEventMatchesWithPredictions,
  simulateMatch,
  rankTeams,
};
