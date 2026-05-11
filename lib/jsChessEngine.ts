/**
 * Pure-JS chess engine — server-side mirror of
 * `ccaui/src/lib/jsChessEngine.ts`. Negamax + alpha-beta over a
 * material + piece-square-table evaluation. No native binary, no WASM,
 * runs in any Node runtime (including Vercel functions).
 *
 * Used by the `engineBestMove` / `engineEvaluation` GraphQL resolvers
 * as a fallback when a client can't run Stockfish in the browser.
 */

import { Chess, type Move } from "chess.js";

const PIECE_VALUE: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20_000,
};

// prettier-ignore
const PST: Record<string, number[]> = {
  p: [
      0,   0,   0,   0,   0,   0,   0,   0,
     50,  50,  50,  50,  50,  50,  50,  50,
     10,  10,  20,  30,  30,  20,  10,  10,
      5,   5,  10,  25,  25,  10,   5,   5,
      0,   0,   0,  20,  20,   0,   0,   0,
      5,  -5, -10,   0,   0, -10,  -5,   5,
      5,  10,  10, -20, -20,  10,  10,   5,
      0,   0,   0,   0,   0,   0,   0,   0,
  ],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20,   0,   0,   0,   0, -20, -40,
    -30,   0,  10,  15,  15,  10,   0, -30,
    -30,   5,  15,  20,  20,  15,   5, -30,
    -30,   0,  15,  20,  20,  15,   0, -30,
    -30,   5,  10,  15,  15,  10,   5, -30,
    -40, -20,   0,   5,   5,   0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,  10,  10,   5,   0, -10,
    -10,   5,   5,  10,  10,   5,   5, -10,
    -10,   0,  10,  10,  10,  10,   0, -10,
    -10,  10,  10,  10,  10,  10,  10, -10,
    -10,   5,   0,   0,   0,   0,   5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  r: [
      0,   0,   0,   0,   0,   0,   0,   0,
      5,  10,  10,  10,  10,  10,  10,   5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
     -5,   0,   0,   0,   0,   0,   0,  -5,
      0,   0,   0,   5,   5,   0,   0,   0,
  ],
  q: [
    -20, -10, -10,  -5,  -5, -10, -10, -20,
    -10,   0,   0,   0,   0,   0,   0, -10,
    -10,   0,   5,   5,   5,   5,   0, -10,
     -5,   0,   5,   5,   5,   5,   0,  -5,
      0,   0,   5,   5,   5,   5,   0,  -5,
    -10,   5,   5,   5,   5,   5,   0, -10,
    -10,   0,   5,   0,   0,   0,   0, -10,
    -20, -10, -10,  -5,  -5, -10, -10, -20,
  ],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
     20,  20,   0,   0,   0,   0,  20,  20,
     20,  30,  10,   0,   0,  10,  30,  20,
  ],
};

function pstIndex(rankIdx: number, fileIdx: number, isWhite: boolean): number {
  return isWhite ? rankIdx * 8 + fileIdx : (7 - rankIdx) * 8 + fileIdx;
}

/** Position evaluation from the side-to-move's perspective (centipawns). */
function evaluate(c: Chess): number {
  if (c.isCheckmate()) return -100_000;
  if (c.isDraw() || c.isStalemate() || c.isThreefoldRepetition()) return 0;
  const board = c.board();
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = board[r]?.[f];
      if (!sq) continue;
      const base = PIECE_VALUE[sq.type] ?? 0;
      const pst = PST[sq.type]?.[pstIndex(r, f, sq.color === "w")] ?? 0;
      const sign = sq.color === "w" ? 1 : -1;
      score += sign * (base + pst);
    }
  }
  return c.turn() === "w" ? score : -score;
}

function moveScore(m: Move): number {
  let s = 0;
  if (m.captured) {
    s += 10 * (PIECE_VALUE[m.captured] ?? 0) - (PIECE_VALUE[m.piece] ?? 0);
  }
  if (m.promotion) s += PIECE_VALUE[m.promotion] ?? 0;
  if ((m.flags ?? "").includes("c")) s += 5;
  return s;
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => moveScore(b) - moveScore(a));
}

interface NegamaxResult {
  score: number;
  move: Move | null;
}

function negamax(
  c: Chess,
  depth: number,
  alpha: number,
  beta: number,
  deadline: number,
): NegamaxResult {
  if (Date.now() > deadline) return { score: evaluate(c), move: null };
  if (depth === 0 || c.isGameOver()) return { score: evaluate(c), move: null };
  const moves = orderMoves(c.moves({ verbose: true }));
  if (moves.length === 0) return { score: evaluate(c), move: null };

  let bestMove: Move | null = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    c.move(m);
    const { score } = negamax(c, depth - 1, -beta, -alpha, deadline);
    c.undo();
    const flipped = -score;
    if (flipped > bestScore) {
      bestScore = flipped;
      bestMove = m;
    }
    alpha = Math.max(alpha, flipped);
    if (alpha >= beta) break;
  }
  return { score: bestScore, move: bestMove };
}

interface EngineConfig {
  depth: number;
  topK: number;
}

function configForElo(elo: number): EngineConfig {
  if (elo <= 500) return { depth: 1, topK: 8 };
  if (elo <= 900) return { depth: 2, topK: 5 };
  if (elo <= 1500) return { depth: 3, topK: 3 };
  return { depth: 3, topK: 1 };
}

/** Return the engine's best move in UCI form, or null if the game is over. */
export function getBestMoveJS(fen: string, elo: number = 1600): string | null {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return null;
  }
  if (c.isGameOver()) return null;

  const { depth, topK } = configForElo(elo);
  const deadline = Date.now() + 600;
  const rootMoves = orderMoves(c.moves({ verbose: true }));
  const scored: { move: Move; score: number }[] = [];
  for (const m of rootMoves) {
    c.move(m);
    const { score } = negamax(c, depth - 1, -Infinity, Infinity, deadline);
    c.undo();
    scored.push({ move: m, score: -score });
    if (Date.now() > deadline) break;
  }
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const pool = scored.slice(0, Math.min(topK, scored.length));
  const pick = pool[Math.floor(Math.random() * pool.length)] ?? scored[0];
  const m = pick.move;
  return `${m.from}${m.to}${m.promotion ?? ""}`;
}

export interface JsEvaluation {
  cp: number | null;
  mate: number | null;
}

/** Centipawn evaluation from white's perspective. */
export function getEvaluationJS(fen: string): JsEvaluation {
  let c: Chess;
  try {
    c = new Chess(fen);
  } catch {
    return { cp: null, mate: null };
  }
  if (c.isCheckmate()) {
    // Side to move is checkmated → losing side. Express mate-in-0 from
    // white's perspective.
    return { cp: null, mate: c.turn() === "w" ? -1 : 1 };
  }
  // Single ply lookahead: pick the best move for the side to move and
  // return the resulting eval from white's perspective.
  const deadline = Date.now() + 400;
  const { score } = negamax(c, 3, -Infinity, Infinity, deadline);
  // `score` is from side-to-move's perspective; flip for black.
  const stm = c.turn();
  const whiteScore = stm === "w" ? score : -score;
  return { cp: Math.round(whiteScore), mate: null };
}
