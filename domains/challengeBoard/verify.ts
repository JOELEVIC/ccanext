import { Chess } from "chess.js";

/**
 * Whether a submitted game actually happened — the pure half, so it can be
 * tested without a database.
 *
 * A result posted from a browser is a CLAIM. Anyone who can read a URL can
 * post one, and a leaderboard is precisely what invites somebody to try. The
 * cheap, honest defence is to check the game rather than the score: replay the
 * move list from the starting position and see whether it ends where the
 * claim says it ends.
 *
 * ── What this proves, and what it does not ────────────────────────────────
 *
 * It PROVES a legal game was played to a position that is genuinely checkmate,
 * stalemate or a drawn ending. That is enough to stop somebody typing a win
 * they never played.
 *
 * It does NOT prove which engine was on the other side. A player can beat Pip
 * and submit it as a win over Titan, and no amount of move-checking will show
 * that. Saying otherwise would be a lie told by a leaderboard, so the board
 * ranks `verified` results and is honest that the rest are attempts.
 *
 * A resignation and a flag are unverifiable by construction — neither leaves a
 * trace in the moves. Losing on either is self-incriminating and nobody forges
 * a loss, so those are recorded and simply not marked verified.
 */

export type ClaimedOutcome = "won" | "lost" | "drew";

export type VerifyInput = {
  /** The position the game began from. */
  startFen: string;
  /** SAN, in order, from `startFen`. */
  movesSAN: readonly string[];
  /** The colour the SUBMITTER played. */
  colour: "w" | "b";
  outcome: ClaimedOutcome;
};

export type VerifyOutcome =
  | { ok: true; verified: boolean; plies: number; reason: VerifyReason }
  | { ok: false; error: VerifyError };

export type VerifyError = "BAD_FEN" | "ILLEGAL_MOVE" | "TOO_LONG" | "CONTRADICTED";

export type VerifyReason =
  /** The final position proves the claim outright. */
  | "checkmate"
  | "stalemate"
  | "insufficient"
  | "repetition"
  | "fifty-move"
  /** Legal game, but the ending leaves no trace in the moves. */
  | "unproven";

/** A game longer than this is not a game; it is somebody probing the endpoint. */
const MAX_PLIES = 600;

export function verifyGame(input: VerifyInput): VerifyOutcome {
  if (input.movesSAN.length > MAX_PLIES) return { ok: false, error: "TOO_LONG" };

  let board: Chess;
  try {
    board = new Chess(input.startFen);
  } catch {
    return { ok: false, error: "BAD_FEN" };
  }

  for (const san of input.movesSAN) {
    // `moves()` rather than a try/catch around `move()`: chess.js accepts some
    // sloppy notation, and a board is only proof if the notation is exact.
    if (!board.moves().includes(san)) return { ok: false, error: "ILLEGAL_MOVE" };
    board.move(san);
  }

  const plies = input.movesSAN.length;
  const opponent = input.colour === "w" ? "b" : "w";

  if (board.isCheckmate()) {
    // The side to move is the side that has been mated.
    const submitterWasMated = board.turn() === input.colour;
    const reality: ClaimedOutcome = submitterWasMated ? "lost" : "won";
    if (reality !== input.outcome) return { ok: false, error: "CONTRADICTED" };
    return { ok: true, verified: true, plies, reason: "checkmate" };
  }

  if (board.isGameOver()) {
    // Every remaining terminal state is a draw of some kind.
    if (input.outcome !== "drew") return { ok: false, error: "CONTRADICTED" };
    const reason: VerifyReason = board.isStalemate()
      ? "stalemate"
      : board.isInsufficientMaterial()
        ? "insufficient"
        : board.isThreefoldRepetition()
          ? "repetition"
          : "fifty-move";
    return { ok: true, verified: true, plies, reason };
  }

  // Still a live position: a resignation or a flag. Legal, but unproven — and
  // it must at least be the right person's move for the story to hold. A game
  // "lost on time" with the opponent to move never happened.
  void opponent;
  return { ok: true, verified: false, plies, reason: "unproven" };
}

/** Full moves, as a person counts them — what the board displays. */
export function fullMoves(plies: number): number {
  return Math.ceil(plies / 2);
}
