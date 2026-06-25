/**
 * Placement rating estimator — authoritative, server-side.
 *
 * Two independent signals are fused by inverse-variance (precision) weighting:
 *
 *   Signal A — RESULTS vs calibrated bots. Each bot is a fixed-rating opponent;
 *     we run the same Glicko-2 update the live system uses, sequentially from a
 *     wide prior. Bot RD is inflated because Stockfish's UCI_Elo is only an
 *     approximation of human Elo (and is fuzzy below ~1320). Output (μ_r, σ_r).
 *
 *   Signal B — MOVE QUALITY (dominant signal; ~30-40 data points per game). The
 *     client analyses every user move with Stockfish and sends centipawn loss +
 *     lichess move-accuracy (+ optional complexity). We aggregate to a weighted
 *     ACPL and mean accuracy, map each to Elo via calibration curves, and average.
 *     σ_m shrinks with the number of moves and widens when the two sub-estimates
 *     disagree. Output (μ_m, σ_m).
 *
 * Fusion: μ = Σ(μ_i/σ_i²) / Σ(1/σ_i²),  σ = sqrt(1 / Σ(1/σ_i²)).
 *
 * The curves below are heuristic v1 anchors. They are intended to be re-fit from
 * real data (placement features → eventually-settled rating) via the admin panel.
 */

import { glicko2Update, type GlickoState } from "../game/glicko2";

export interface PlacementMoveStat {
  /** Centipawns lost vs the engine's best move, mover POV (>= 0). */
  cpLoss: number;
  /** lichess per-move accuracy 0-100. */
  accuracy: number;
  /** Optional 0-1 position complexity (MultiPV spread); 0 = only-move trivial. */
  complexity?: number;
}

export interface PlacementGameResult {
  botId: string;
  botElo: number;
  color: "w" | "b";
  /** User-perspective score: 1 win, 0.5 draw, 0 loss. */
  score: number;
  /** Per-move stats for the USER's moves only (book/dead/forced already filtered client-side). */
  userMoves: PlacementMoveStat[];
}

export interface PlacementEstimate {
  rating: number; // fused, clamped, rounded — overwrites the player's rating
  rd: number; // provisional Glicko RD to carry into real games
  confidence: number; // posterior σ (smaller = more confident)
  resultRating: number; // Signal A (μ_r)
  resultRd: number; // Signal A (σ_r)
  moveRating: number; // Signal B (μ_m)
  moveRd: number; // Signal B (σ_m)
  acplRating: number; // ACPL→Elo sub-estimate (diagnostic)
  accuracyRating: number; // accuracy→Elo sub-estimate (diagnostic)
  weightedAcpl: number;
  meanAccuracy: number;
  totalUserMoves: number;
  gamesScored: number;
}

const RATING_MIN = 100;
const RATING_MAX = 2900;

/** Bot rating uncertainty — wider than a player's per-game RD to reflect that
 *  UCI_Elo ≈ human Elo only roughly. */
const BOT_RD = 80;
/** Prior for the results estimator: neutral and uninformative. */
const PRIOR: GlickoState = { rating: 1000, rd: 350, vol: 0.06 };

/** Piecewise-linear interpolation over (x → y) anchors sorted by x ascending. */
function interp(anchors: [number, number][], x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [x0, y0] = anchors[i];
    const [x1, y1] = anchors[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Average centipawn loss → Elo. Anchors are rough rapid-play values; monotonic
 * decreasing (lower ACPL ⇒ stronger). Re-fit later from real data.
 */
const ACPL_TO_ELO: [number, number][] = [
  [8, 2700],
  [15, 2400],
  [22, 2150],
  [30, 1950],
  [40, 1750],
  [50, 1550],
  [62, 1400],
  [78, 1200],
  [95, 1050],
  [115, 900],
  [140, 720],
  [175, 520],
  [220, 320],
  [280, 150],
];

/** Mean per-move accuracy (%) → Elo. Monotonic increasing. */
const ACCURACY_TO_ELO: [number, number][] = [
  [50, 250],
  [55, 420],
  [60, 600],
  [65, 800],
  [70, 1000],
  [75, 1200],
  [80, 1420],
  [85, 1680],
  [90, 1950],
  [94, 2250],
  [97, 2500],
  [99, 2750],
];

function acplToElo(acpl: number): number {
  return interp(ACPL_TO_ELO, acpl);
}
function accuracyToElo(acc: number): number {
  return interp(ACCURACY_TO_ELO, acc);
}

/** Signal A — sequential Glicko-2 over the game results vs (fixed-rating) bots. */
function estimateFromResults(games: PlacementGameResult[]): { rating: number; rd: number } {
  let state: GlickoState = { ...PRIOR };
  for (const g of games) {
    const opp: GlickoState = { rating: g.botElo, rd: BOT_RD, vol: 0.06 };
    state = glicko2Update(state, opp, g.score);
  }
  return { rating: state.rating, rd: state.rd };
}

/** Signal B — move quality → Elo, with confidence from move count + sub-estimate agreement. */
function estimateFromMoves(games: PlacementGameResult[]): {
  rating: number;
  rd: number;
  acplRating: number;
  accuracyRating: number;
  weightedAcpl: number;
  meanAccuracy: number;
  moveCount: number;
} {
  let wSum = 0;
  let cpWeighted = 0;
  let accSum = 0;
  let n = 0;
  for (const g of games) {
    for (const m of g.userMoves) {
      // Mild complexity weighting: sharp positions (high complexity) count a little
      // more, since precision there is more telling. Default weight 1 when absent.
      const w = 1 + 0.5 * (m.complexity ?? 0);
      wSum += w;
      cpWeighted += w * Math.max(0, m.cpLoss);
      accSum += m.accuracy;
      n++;
    }
  }
  if (n === 0) {
    // No analysable moves — fall back to a neutral, very low-confidence estimate.
    return {
      rating: 1000,
      rd: 400,
      acplRating: 1000,
      accuracyRating: 1000,
      weightedAcpl: 0,
      meanAccuracy: 0,
      moveCount: 0,
    };
  }
  const weightedAcpl = cpWeighted / wSum;
  const meanAccuracy = accSum / n;
  const acplRating = acplToElo(weightedAcpl);
  const accuracyRating = accuracyToElo(meanAccuracy);

  // Blend the two move-quality sub-estimates (equal weight).
  const rating = (acplRating + accuracyRating) / 2;

  // Confidence: base shrinks with sqrt(moves); inflate when the two sub-estimates
  // disagree (a sign the position mix is unusual / noisy).
  const base = 1700 / Math.sqrt(n);
  const disagreement = Math.abs(acplRating - accuracyRating);
  const rd = clamp(base + 0.25 * disagreement, 70, 400);

  return {
    rating,
    rd,
    acplRating,
    accuracyRating,
    weightedAcpl,
    meanAccuracy,
    moveCount: n,
  };
}

/** Fuse all signals into the final placement estimate. */
export function estimatePlacement(games: PlacementGameResult[]): PlacementEstimate {
  const result = estimateFromResults(games);
  const moves = estimateFromMoves(games);

  // Inverse-variance fusion.
  const wr = 1 / (result.rd * result.rd);
  const wm = 1 / (moves.rd * moves.rd);
  const fused = (result.rating * wr + moves.rating * wm) / (wr + wm);
  const fusedSigma = Math.sqrt(1 / (wr + wm));

  const rating = Math.round(clamp(fused, RATING_MIN, RATING_MAX));
  // Provisional RD: keep it loose enough that the first real games still move the
  // rating, but tighter than a brand-new unrated player.
  const rd = Math.round(clamp(fusedSigma, 80, 180));

  return {
    rating,
    rd,
    confidence: Math.round(fusedSigma),
    resultRating: Math.round(result.rating),
    resultRd: Math.round(result.rd),
    moveRating: Math.round(moves.rating),
    moveRd: Math.round(moves.rd),
    acplRating: Math.round(moves.acplRating),
    accuracyRating: Math.round(moves.accuracyRating),
    weightedAcpl: Math.round(moves.weightedAcpl * 10) / 10,
    meanAccuracy: Math.round(moves.meanAccuracy * 10) / 10,
    totalUserMoves: moves.moveCount,
    gamesScored: games.length,
  };
}
