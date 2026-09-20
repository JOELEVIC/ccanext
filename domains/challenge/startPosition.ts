import { Chess, DEFAULT_POSITION, validateFen } from "chess.js";

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Validating a position somebody else chose.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A challenge may name the position it starts from. That string arrives from
 * a client and is worth nothing until it has been through here.
 *
 * ── Duplicated in `cca`, on purpose ──────────────────────────────────────
 *
 * `cca/src/domains/game/start-position.ts` is this file again. The two
 * services share no code, and `startGameSession` is directly reachable and
 * cross-checks nothing against ccanext — so a position this refuses can still
 * be posted straight to the game server. Same argument as `scenarioHash`,
 * which carries the same warning: **if one changes, both change.**
 *
 * ── Why null rather than a stored standard position ──────────────────────
 *
 * Null means "behave exactly as before", and that is the property the whole
 * compatibility story rests on. Every branch downstream is `if (startFen)`.
 * Stored as the standard FEN instead, the same branch becomes a string
 * comparison against a 56-character constant repeated at a dozen sites, one
 * of which somebody will forget — and it would assert something nobody
 * verified about every game row written before the column existed.
 */

/** The longest legal FEN is about ninety characters. */
const MAX_FEN_LENGTH = 128;

export type StartPosition =
  | { ok: true; fen: string | null }
  | { ok: false; reason: string };

export function validateStartFen(raw: unknown): StartPosition {
  // ── Cheap tests first, and that ordering is the point ──────────────────
  //
  // `validateFen` walks the string with regexes and a rank loop, so an
  // unbounded input is work done on an attacker's behalf before knowing it is
  // garbage. The character class also kills newlines and control characters,
  // which is what stops a FEN smuggling anything into a stored string that is
  // later rendered.
  if (raw === null || raw === undefined) return { ok: true, fen: null };
  if (typeof raw !== "string") {
    return { ok: false, reason: "That position could not be read." };
  }
  const fen = raw.trim();
  if (fen === "") return { ok: true, fen: null };
  if (fen.length > MAX_FEN_LENGTH || !/^[A-Za-z0-9/ -]+$/.test(fen)) {
    return { ok: false, reason: "That position could not be read." };
  }

  // Six fields, enforced by `validateFen` itself. A four-field FEN loses the
  // halfmove clock and the fullmove number: the first breaks the fifty-move
  // rule from an endgame, the second makes a board number its moves from one.
  // Reject them; do not helpfully pad.
  if (!validateFen(fen).ok) {
    return { ok: false, reason: "That is not a valid chess position." };
  }

  let chess: Chess;
  try {
    // Belt and braces: `validateFen` and the constructor are two code paths
    // in chess.js and have disagreed across versions.
    chess = new Chess(fen);
  } catch {
    return { ok: false, reason: "That is not a valid chess position." };
  }

  // ── The check chess.js does not do ─────────────────────────────────────
  //
  // `validateFen` checks placement, one king a side, no pawns on the back
  // ranks, and the castling and en-passant fields. It does NOT ask whether
  // the position could be reached — and the unreachable one that matters is
  // "the opponent is in check and it is your move", because chess.js will
  // then happily generate a king capture and the game is nonsense one ply in.
  const them = chess.turn() === "w" ? "b" : "w";
  const king = chess.findPiece({ type: "k", color: them })[0];
  if (king && chess.isAttacked(king, chess.turn())) {
    return {
      ok: false,
      reason: "That position could not have been reached — a king is left in check.",
    };
  }

  // ── And the one whose absence fails worst ──────────────────────────────
  //
  // End detection only runs AFTER a move is applied. A session started on a
  // position that is already mate never reaches it: both players sit on a
  // board with no legal move, and thirty seconds later it is recorded
  // abandoned with the reason "no move in time" — a message describing
  // nothing that happened.
  if (chess.isGameOver()) {
    return {
      ok: false,
      reason: "That position is already finished — there is no game to play.",
    };
  }

  // Normalised, so two callers who mean the same position store the same
  // bytes — and the standard start collapses to null, which is what keeps
  // "null means standard" a real invariant rather than a convention with two
  // spellings.
  const normal = chess.fen();
  return { ok: true, fen: normal === DEFAULT_POSITION ? null : normal };
}

/** Which colour moves first from a position. `"w"` for the standard start. */
export function startTurn(startFen?: string | null): "w" | "b" {
  return startFen && startFen.split(" ")[1] === "b" ? "b" : "w";
}
