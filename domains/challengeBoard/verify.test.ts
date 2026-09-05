import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";

import { fullMoves, verifyGame } from "./verify";

/**
 * The leaderboard's only defence, so it gets adversarial cases rather than
 * happy ones: the forgeries somebody would actually try are a win that never
 * happened and a game that never was legal.
 */

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
/** Fool's mate — Black mates on move two. */
const FOOLS = ["f3", "e5", "g4", "Qh4#"];

describe("a game that proves itself", () => {
  it("accepts a checkmate delivered by the submitter", () => {
    const out = verifyGame({ startFen: START, movesSAN: FOOLS, colour: "b", outcome: "won" });
    expect(out).toEqual({ ok: true, verified: true, plies: 4, reason: "checkmate" });
  });

  it("accepts the same game from the losing side", () => {
    const out = verifyGame({ startFen: START, movesSAN: FOOLS, colour: "w", outcome: "lost" });
    expect(out.ok && out.verified).toBe(true);
  });

  it("accepts a longer mate the submitter walked into", () => {
    // 1.e4 e5 2.Qh5 Ke7 3.Qxe5# — Black's own king step makes it mate.
    const out = verifyGame({
      startFen: START,
      movesSAN: ["e4", "e5", "Qh5", "Ke7", "Qxe5#"],
      colour: "w",
      outcome: "won",
    });
    expect(out).toMatchObject({ ok: true, verified: true, reason: "checkmate" });
  });

  it("verifies a stalemate as a draw", () => {
    // A known stalemate position, Black to move with no legal move.
    const fen = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
    const out = verifyGame({ startFen: fen, movesSAN: [], colour: "b", outcome: "drew" });
    expect(out).toMatchObject({ ok: true, verified: true, reason: "stalemate" });
  });

  it("verifies bare kings as insufficient material", () => {
    const out = verifyGame({
      startFen: "7k/8/6K1/8/8/8/8/8 w - - 0 1",
      movesSAN: [],
      colour: "w",
      outcome: "drew",
    });
    expect(out).toMatchObject({ ok: true, verified: true, reason: "insufficient" });
  });
});

describe("a claim the board refuses", () => {
  it("refuses a win that the final position contradicts", () => {
    // Fool's mate really happened, but White claims to have won it.
    const out = verifyGame({ startFen: START, movesSAN: FOOLS, colour: "w", outcome: "won" });
    expect(out).toEqual({ ok: false, error: "CONTRADICTED" });
  });

  it("refuses a draw claimed over a checkmate", () => {
    const out = verifyGame({ startFen: START, movesSAN: FOOLS, colour: "b", outcome: "drew" });
    expect(out).toEqual({ ok: false, error: "CONTRADICTED" });
  });

  it("refuses an illegal move rather than skipping it", () => {
    // White has no knight that can reach f6 on move two.
    const out = verifyGame({
      startFen: START,
      movesSAN: ["e4", "e5", "Nf6"],
      colour: "w",
      outcome: "won",
    });
    expect(out).toEqual({ ok: false, error: "ILLEGAL_MOVE" });
  });

  it("refuses notation that is merely close", () => {
    // Legal move, wrong SAN: the mate is `Qh4#`, and `Qh4` alone is not it.
    const out = verifyGame({
      startFen: START,
      movesSAN: ["f3", "e5", "g4", "Qh4"],
      colour: "b",
      outcome: "won",
    });
    expect(out).toEqual({ ok: false, error: "ILLEGAL_MOVE" });
  });

  it("refuses a position it cannot even load", () => {
    const out = verifyGame({
      startFen: "not a fen at all",
      movesSAN: [],
      colour: "w",
      outcome: "won",
    });
    expect(out).toEqual({ ok: false, error: "BAD_FEN" });
  });

  it("refuses a move list long enough to be an attack", () => {
    const out = verifyGame({
      startFen: START,
      movesSAN: Array.from({ length: 601 }, () => "e4"),
      colour: "w",
      outcome: "won",
    });
    expect(out).toEqual({ ok: false, error: "TOO_LONG" });
  });
});

describe("what it honestly cannot prove", () => {
  it("records a resignation as legal but unverified", () => {
    const out = verifyGame({
      startFen: START,
      movesSAN: ["e4", "e5"],
      colour: "w",
      outcome: "lost",
    });
    expect(out).toEqual({ ok: true, verified: false, plies: 2, reason: "unproven" });
  });

  it("does not let an unproven claim pass as a verified win", () => {
    const out = verifyGame({
      startFen: START,
      movesSAN: ["e4", "e5"],
      colour: "w",
      outcome: "won",
    });
    expect(out.ok && out.verified).toBe(false);
  });

  it("accepts a game starting from a mid-game position", () => {
    // Back-rank mate: White to move, Ra8#.
    const fen = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
    expect(new Chess(fen).moves()).toContain("Ra8#");
    const out = verifyGame({
      startFen: fen,
      movesSAN: ["Ra8#"],
      colour: "w",
      outcome: "won",
    });
    expect(out).toMatchObject({ ok: true, verified: true, reason: "checkmate" });
  });
});

describe("fullMoves", () => {
  it("counts the way a person does", () => {
    expect(fullMoves(0)).toBe(0);
    expect(fullMoves(1)).toBe(1);
    expect(fullMoves(4)).toBe(2);
    expect(fullMoves(31)).toBe(16);
  });
});
