import { describe, expect, it } from "vitest";
import { startTurn, validateStartFen } from "@/domains/challenge/startPosition";

/**
 * The gate a position passes before it can become a game.
 *
 * ── This table is duplicated, deliberately ───────────────────────────────
 *
 * `cca/src/domains/game/start-position.test.ts` runs the same cases against
 * the same validator, written twice because the two services share no code
 * and `startGameSession` is directly reachable. A position one accepts and
 * the other refuses is a game that can be created and never played. **If one
 * changes, both change.**
 */

const STANDARD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

describe("nothing to validate", () => {
  it("treats absence as the standard start", () => {
    expect(validateStartFen(null)).toEqual({ ok: true, fen: null });
    expect(validateStartFen(undefined)).toEqual({ ok: true, fen: null });
    expect(validateStartFen("")).toEqual({ ok: true, fen: null });
    expect(validateStartFen("   ")).toEqual({ ok: true, fen: null });
  });

  it("collapses the standard position to null", () => {
    // The invariant every `if (startFen)` downstream depends on: there is one
    // spelling of "standard start", and it is null.
    expect(validateStartFen(STANDARD)).toEqual({ ok: true, fen: null });
  });

  it("refuses something that is not a string at all", () => {
    expect(validateStartFen(42).ok).toBe(false);
    expect(validateStartFen({ fen: STANDARD }).ok).toBe(false);
  });
});

describe("what it refuses", () => {
  it("caps the length before it parses anything", () => {
    // Order matters: `validateFen` walks the string with regexes and a rank
    // loop, so an unbounded input is work done on an attacker's behalf before
    // knowing it is garbage.
    expect(validateStartFen("r".repeat(500)).ok).toBe(false);
  });

  it("refuses control characters and newlines", () => {
    expect(validateStartFen(`${STANDARD}\n`).ok).toBe(true); // trimmed
    expect(validateStartFen("8/8/8/8/8/8/8/8 w\t- - 0 1").ok).toBe(false);
  });

  it("refuses a four-field FEN rather than padding it", () => {
    // The halfmove clock and the fullmove number are not decoration: the
    // first is how the fifty-move rule works from an endgame, the second is
    // how a board numbers its moves.
    expect(validateStartFen("4k3/8/4K3/8/8/8/8/4R3 w -").ok).toBe(false);
  });

  it("refuses obvious nonsense", () => {
    expect(validateStartFen("not a fen").ok).toBe(false);
    expect(validateStartFen("9999999/8/8/8/8/8/8/8 w - - 0 1").ok).toBe(false);
  });

  it("refuses a position that leaves the side not to move in check", () => {
    // chess.js loads this happily and then generates a king capture, and the
    // game is nonsense one ply in. It is the check `validateFen` does not do,
    // and the only thing standing between it and a board is this assertion.
    //
    // This is the real Philidor FEN the catalogue shipped for months: Black to
    // move, White's king on e6 already attacked by the rook on a6.
    const result = validateStartFen("4k3/8/r3K3/4P3/8/8/8/4R3 b - - 0 1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/check/i);
  });

  it("refuses a position that is already finished", () => {
    // The failure whose absence is worst: end detection only runs after a
    // move is applied, so a session started on mate is a board neither player
    // can move on, recorded thirty seconds later as "no move in time".
    const mate = validateStartFen("7k/6Q1/5K2/8/8/8/8/8 b - - 0 1");
    expect(mate.ok).toBe(false);
    // The reason, not just the refusal: the first version of this used a
    // position whose kings were adjacent, so it passed on the check above and
    // proved nothing about game-over detection.
    if (!mate.ok) expect(mate.reason).toMatch(/finished/i);

    const stalemate = validateStartFen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    expect(stalemate.ok).toBe(false);

    const bare = validateStartFen("7k/8/6K1/8/8/8/8/8 w - - 0 1");
    expect(bare.ok).toBe(false);
  });
});

describe("what it accepts", () => {
  it("takes a real position and hands back a canonical spelling", () => {
    // The Immortal Game before 18.Bd6 — the position the catalogue ships,
    // not the mate that ends it. A finished position is refused, which the
    // case below this one covers.
    const immortal =
      "rnb1k1nr/p2p1ppp/8/1pbN1N1P/4PBP1/3P1Q2/PqP5/R4KR1 w kq - 0 18";
    const result = validateStartFen(immortal);
    expect(result).toEqual({ ok: true, fen: immortal });
  });

  it("takes a black-to-move position", () => {
    // Not a special case and must not be treated as one: more than a quarter
    // of the catalogue is Black to move.
    const philidor = "4k3/8/r7/3KP3/8/8/8/4R3 b - - 0 1";
    expect(validateStartFen(philidor)).toEqual({ ok: true, fen: philidor });
  });

  it("trims without otherwise rewriting", () => {
    const philidor = "4k3/8/r7/3KP3/8/8/8/4R3 b - - 0 1";
    expect(validateStartFen(`  ${philidor}  `)).toEqual({
      ok: true,
      fen: philidor,
    });
  });
});

describe("who moves first", () => {
  it("is White for the standard start and for nothing", () => {
    expect(startTurn(null)).toBe("w");
    expect(startTurn(undefined)).toBe("w");
    expect(startTurn(STANDARD)).toBe("w");
  });

  it("is read off the FEN's own second field", () => {
    expect(startTurn("4k3/8/r7/3KP3/8/8/8/4R3 b - - 0 1")).toBe("b");
    expect(startTurn("4k3/8/r7/3KP3/8/8/8/4R3 w - - 0 1")).toBe("w");
  });
});
