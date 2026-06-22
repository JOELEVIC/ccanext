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
  // Checks first — guarantees we always look at mate-delivering moves
  // before quiet moves under tight deadlines.
  if (m.san?.endsWith("#")) s += 50_000;
  else if (m.san?.endsWith("+")) s += 50;
  return s;
}

/** Scan root moves for an immediate checkmate. Cheap, always runs first. */
function findMateInOne(c: Chess, moves: Move[]): Move | null {
  for (const m of moves) {
    if (m.san?.endsWith("#")) return m;
    c.move(m);
    const mate = c.isCheckmate();
    c.undo();
    if (mate) return m;
  }
  return null;
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => moveScore(b) - moveScore(a));
}

/**
 * Quiescence search — at the leaf, keep searching captures and promotions
 * until the position is "quiet". Without this the fixed-depth negamax has a
 * horizon effect and happily hangs pieces to a recapture one ply past the
 * limit. This is the single biggest strength fix for the fallback engine.
 */
function quiescence(
  c: Chess,
  alpha: number,
  beta: number,
  deadline: number,
): number {
  if (c.isGameOver()) return evaluate(c);
  const standPat = evaluate(c);
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;
  if (Date.now() > deadline) return alpha;

  const tactical = orderMoves(
    c.moves({ verbose: true }).filter((m) => m.captured || m.promotion),
  );
  for (const m of tactical) {
    c.move(m);
    const score = -quiescence(c, -beta, -alpha, deadline);
    c.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
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
  if (c.isGameOver()) return { score: evaluate(c), move: null };
  if (depth === 0) return { score: quiescence(c, alpha, beta, deadline), move: null };
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
  // Depth scales with Elo so the strength slider actually does something
  // above 1500 (previously every Elo from 1501–3200 was identical depth 3).
  // Combined with quiescence search, each extra ply is a real strength jump.
  if (elo <= 500) return { depth: 1, topK: 6 };
  if (elo <= 900) return { depth: 2, topK: 4 };
  if (elo <= 1300) return { depth: 3, topK: 3 };
  if (elo <= 1700) return { depth: 3, topK: 2 };
  if (elo <= 2200) return { depth: 4, topK: 1 };
  return { depth: 5, topK: 1 };
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

  const { depth: maxDepth, topK } = configForElo(elo);
  // Snappy budget — the bot should answer fast. Iterative deepening below
  // means we always have a complete result to fall back on if we run out.
  const deadline = Date.now() + 1200;
  const allMoves = c.moves({ verbose: true });

  // Mate-in-1 fast path — never miss a forced mate.
  const mate = findMateInOne(c, allMoves);
  if (mate) return `${mate.from}${mate.to}${mate.promotion ?? ""}`;

  const rootMoves = orderMoves(allMoves);
  // Iterative deepening: keep the deepest ranking that FULLY completed, so a
  // mid-search timeout never leaves us choosing from a partial (and thus
  // capture-biased) scan. maxDepth caps strength per Elo; weak bots stay
  // shallow even when there's time to spare.
  let scored: { move: Move; score: number }[] = rootMoves.map((m) => ({ move: m, score: 0 }));
  for (let d = 1; d <= maxDepth; d++) {
    const partial: { move: Move; score: number }[] = [];
    let completed = true;
    for (const m of rootMoves) {
      if (Date.now() > deadline) {
        completed = false;
        break;
      }
      c.move(m);
      const { score } = negamax(c, d - 1, -Infinity, Infinity, deadline);
      c.undo();
      partial.push({ move: m, score: -score });
    }
    if (!completed) break;
    partial.sort((a, b) => b.score - a.score);
    scored = partial;
  }

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
