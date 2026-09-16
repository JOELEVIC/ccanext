import { describe, it, expect, vi } from "vitest";
import { GameStatus, GameResult } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { GameService } from "./game.service";

/**
 * `recordGameResult` — the write-back the `cca` live game server calls when a
 * game ends. Two things happen, in order: the outcome is persisted, and THEN
 * Glicko-2 ratings are applied. BUILD_PLAN §4.4 says a fixture board's game
 * must not be rated at completion (it is rated once, later, at arbiter
 * validation) — but its record must still land: one ledger holds both
 * over-the-board and online play.
 *
 * These tests drive the real service against an in-memory Prisma double and
 * assert on the two halves independently.
 */

type Row = Record<string, unknown>;

const BASE = {
  id: "g1",
  whiteId: "white-user",
  blackId: "black-user",
  moves: "",
  result: null,
  status: GameStatus.ACTIVE,
  rated: true,
  white: { rating: 1200 },
  black: { rating: 1200 },
};

function harness(game: Row) {
  const calls = {
    gameUpdates: [] as Row[],
    ratingReads: [] as string[],
    ratingUpserts: [] as Row[],
    userUpdates: [] as Row[],
    transactions: 0,
  };
  let current: Row = { ...game };

  const prisma = {
    game: {
      findUnique: async () => ({ ...current }),
      update: async ({ data }: { data: Row }) => {
        calls.gameUpdates.push({ ...data });
        current = { ...current, ...data };
        return { ...current };
      },
    },
    playerRating: {
      // No prior Glicko row: the service seeds from users.rating. Keeps the
      // double honest without reimplementing the rating table.
      findUnique: async ({ where }: { where: { userId: string } }) => {
        calls.ratingReads.push(where.userId);
        return null;
      },
      upsert: (args: Row) => {
        calls.ratingUpserts.push(args);
        return { __op: "playerRating.upsert" };
      },
    },
    user: {
      update: (args: Row) => {
        calls.userUpdates.push(args);
        return { __op: "user.update" };
      },
    },
    $transaction: async (ops: unknown[]) => {
      calls.transactions += 1;
      return ops;
    },
  };

  return { service: new GameService(prisma as unknown as PrismaClient), calls };
}

/**
 * `recordGameResult` swallows rating errors on purpose (a not-yet-migrated
 * player_ratings table must not lose the result), so an incomplete double could
 * masquerade as "no rating applied". Fail loudly if anything was swallowed.
 */
async function run(
  game: Row,
  params: {
    result: GameResult | null;
    moves?: string;
    userId?: string;
  }
) {
  const { service, calls } = harness(game);
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const updated = await service.recordGameResult({
      gameId: "g1",
      userId: params.userId ?? "white-user",
      result: params.result,
      moves: params.moves,
    });
    expect(spy).not.toHaveBeenCalled();
    return { updated: updated as Row, calls };
  } finally {
    spy.mockRestore();
  }
}

/** Every write PlayerRating (and its users.rating mirror) could have taken. */
function ratingWrites(calls: ReturnType<typeof harness>["calls"]) {
  return calls.ratingReads.length + calls.ratingUpserts.length + calls.userUpdates.length;
}

describe("recordGameResult — outcome always persists", () => {
  it("behaviour 1: a fixture game (PENDING) is COMPLETED with result + moves, and is NOT rated", async () => {
    const { updated, calls } = await run(
      { ...BASE, validationState: "PENDING" },
      { result: GameResult.WHITE_WIN, moves: "e4 e5 Nf3" }
    );

    // The record survives...
    expect(updated.status).toBe(GameStatus.COMPLETED);
    expect(updated.result).toBe(GameResult.WHITE_WIN);
    expect(updated.moves).toBe("e4 e5 Nf3");
    expect(calls.gameUpdates).toEqual([
      { status: GameStatus.COMPLETED, result: GameResult.WHITE_WIN, moves: "e4 e5 Nf3" },
    ]);

    // ...and PlayerRating is untouched: not read, not written, no transaction.
    expect(ratingWrites(calls)).toBe(0);
    expect(calls.transactions).toBe(0);
  });

  it("VALIDATED and DISPUTED are likewise not rated here, but still persist", async () => {
    for (const state of ["VALIDATED", "DISPUTED"]) {
      const { updated, calls } = await run(
        { ...BASE, validationState: state },
        { result: GameResult.DRAW, moves: "d4 d5" }
      );
      expect(updated.status).toBe(GameStatus.COMPLETED);
      expect(updated.result).toBe(GameResult.DRAW);
      expect(updated.moves).toBe("d4 d5");
      expect(ratingWrites(calls)).toBe(0);
    }
  });
});

describe("recordGameResult — ordinary games rate exactly as before", () => {
  it("behaviour 2: NOT_REQUIRED rates both players in one transaction", async () => {
    const { updated, calls } = await run(
      { ...BASE, validationState: "NOT_REQUIRED" },
      { result: GameResult.WHITE_WIN, moves: "e4 e5" }
    );

    expect(updated.status).toBe(GameStatus.COMPLETED);
    expect(updated.result).toBe(GameResult.WHITE_WIN);
    expect(calls.ratingReads).toEqual(["white-user", "black-user"]);
    expect(calls.ratingUpserts).toHaveLength(2);
    expect(calls.userUpdates).toHaveLength(2);
    expect(calls.transactions).toBe(1);

    // The winner's mirrored display rating went up, the loser's down.
    const [w, b] = calls.userUpdates as Array<{
      where: { id: string };
      data: { rating: number };
    }>;
    expect(w.where.id).toBe("white-user");
    expect(b.where.id).toBe("black-user");
    expect(w.data.rating).toBeGreaterThan(1200);
    expect(b.data.rating).toBeLessThan(1200);
  });

  it("behaviour 4: a legacy row with validationState null rates", async () => {
    const { calls } = await run(
      { ...BASE, validationState: null },
      { result: GameResult.WHITE_WIN }
    );
    expect(calls.ratingUpserts).toHaveLength(2);
    expect(calls.transactions).toBe(1);
  });

  it("behaviour 4: a row with no validationState field at all rates", async () => {
    const { calls } = await run({ ...BASE }, { result: GameResult.BLACK_WIN });
    expect(calls.ratingUpserts).toHaveLength(2);
    expect(calls.transactions).toBe(1);
  });

  it("behaviour 4: an unrecognised validationState falls back to NOT_REQUIRED and rates", async () => {
    const { calls } = await run(
      { ...BASE, validationState: "SOMETHING_NEW" },
      { result: GameResult.DRAW }
    );
    expect(calls.ratingUpserts).toHaveLength(2);
    expect(calls.transactions).toBe(1);
  });

  it("a casual game (rated: false) still records the outcome and still skips rating", async () => {
    const { updated, calls } = await run(
      { ...BASE, rated: false, validationState: "NOT_REQUIRED" },
      { result: GameResult.WHITE_WIN, moves: "e4" }
    );
    expect(updated.status).toBe(GameStatus.COMPLETED);
    expect(updated.moves).toBe("e4");
    expect(ratingWrites(calls)).toBe(0);
  });
});

describe("recordGameResult — aborts and idempotency", () => {
  it("behaviour 3: a null result marks the game ABANDONED and rates nobody", async () => {
    const { updated, calls } = await run(
      { ...BASE, validationState: "NOT_REQUIRED" },
      { result: null, moves: "e4" }
    );
    expect(updated.status).toBe(GameStatus.ABANDONED);
    expect(updated.result).toBeNull();
    expect(updated.moves).toBe("e4");
    expect(calls.gameUpdates).toEqual([{ status: GameStatus.ABANDONED, moves: "e4" }]);
    expect(ratingWrites(calls)).toBe(0);
  });

  it("behaviour 3: an aborted fixture game is ABANDONED too — the guard changes nothing here", async () => {
    const { updated, calls } = await run(
      { ...BASE, validationState: "PENDING" },
      { result: null, moves: "e4" }
    );
    expect(updated.status).toBe(GameStatus.ABANDONED);
    expect(ratingWrites(calls)).toBe(0);
  });

  it("an already-finished game is returned untouched (no second rating)", async () => {
    const { updated, calls } = await run(
      { ...BASE, status: GameStatus.COMPLETED, result: GameResult.DRAW, validationState: "NOT_REQUIRED" },
      { result: GameResult.WHITE_WIN }
    );
    expect(updated.status).toBe(GameStatus.COMPLETED);
    expect(updated.result).toBe(GameResult.DRAW);
    expect(calls.gameUpdates).toHaveLength(0);
    expect(ratingWrites(calls)).toBe(0);
  });

  it("a non-participant cannot record a result", async () => {
    const { service } = harness({ ...BASE, validationState: "PENDING" });
    await expect(
      service.recordGameResult({
        gameId: "g1",
        userId: "someone-else",
        result: GameResult.WHITE_WIN,
      })
    ).rejects.toThrow(/not a participant/i);
  });
});
