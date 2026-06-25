/**
 * Glicko-2 rating update for a single game (rating period = one game), per
 * Mark Glickman's "Example of the Glicko-2 system" (2013). This is the system
 * chess.com uses. Each player is updated against the opponent's PRE-game state,
 * so always read both players' states first, then compute, then persist.
 */

export interface GlickoState {
  rating: number; // human-scale rating (1500-centered)
  rd: number; // rating deviation
  vol: number; // volatility
}

const SCALE = 173.7178; // Glicko-2 internal scale factor
const TAU = 0.5; // system constant: constrains volatility change
const EPSILON = 1e-6; // convergence tolerance
const RD_MIN = 30; // floor — keep an established rating from ossifying
const RD_MAX = 350; // ceiling — an unrated/very stale player

export const DEFAULT_RD = 350;
export const DEFAULT_VOL = 0.06;

/** Returns the new state for `player` after a game vs `opponent` with `score` (1 win / 0.5 draw / 0 loss). */
export function glicko2Update(player: GlickoState, opponent: GlickoState, score: number): GlickoState {
  const mu = (player.rating - 1500) / SCALE;
  const phi = clamp(player.rd, RD_MIN, RD_MAX) / SCALE;
  const muOpp = (opponent.rating - 1500) / SCALE;
  const phiOpp = clamp(opponent.rd, RD_MIN, RD_MAX) / SCALE;

  const g = 1 / Math.sqrt(1 + (3 * phiOpp * phiOpp) / (Math.PI * Math.PI));
  const e = 1 / (1 + Math.exp(-g * (mu - muOpp)));
  const v = 1 / (g * g * e * (1 - e));
  const delta = v * g * (score - e);

  const newVol = solveVolatility(phi, v, delta, player.vol);

  const phiStar = Math.sqrt(phi * phi + newVol * newVol);
  const newPhi = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const newMu = mu + newPhi * newPhi * g * (score - e);

  return {
    rating: newMu * SCALE + 1500,
    rd: clamp(newPhi * SCALE, RD_MIN, RD_MAX),
    vol: newVol,
  };
}

/** Illinois-algorithm root find for the updated volatility. */
function solveVolatility(phi: number, v: number, delta: number, vol: number): number {
  const a = Math.log(vol * vol);
  const phi2 = phi * phi;
  const f = (x: number): number => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi2 - v - ex);
    const den = 2 * Math.pow(phi2 + v + ex, 2);
    return num / den - (x - a) / (TAU * TAU);
  };

  let A = a;
  let B: number;
  if (delta * delta > phi2 + v) {
    B = Math.log(delta * delta - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }

  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > EPSILON && guard++ < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA = fA / 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
