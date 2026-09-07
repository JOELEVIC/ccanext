import { describe, expect, it } from "vitest";
import { ChallengeService } from "@/domains/challenge/challenge.service";
import { gameResolvers } from "@/graphql/resolvers/game.resolvers";

/**
 * What a challenge query loads, and why the answer is not "the game row".
 *
 * `Game.white` and `Game.black` are `User!` in the SDL, and their resolvers
 * read what Prisma already loaded rather than fetching anything. So an include
 * of `game: true` produces `undefined` for two non-null fields, which
 * graphql-yoga masks as the generic "Unexpected error."
 *
 * The failure is nastier than a plain 500, and that is the reason this file
 * exists rather than a comment:
 *
 *   · **The write succeeds.** The challenge is created and returned. Only a
 *     nested field throws, so the response carries BOTH data and an error.
 *   · **Every client calls that a failure**, because a non-empty `errors`
 *     array is the only signal they have. So inviting somebody looked broken
 *     while working, and re-sending was the obvious thing to try — which the
 *     dedupe in `createChallenge` quietly absorbed.
 *   · **It was not confined to inviting.** `myChallenges` is polled by the
 *     app while the Play tab is open, so the same error appeared on screens
 *     nobody had touched.
 */

/** A Prisma stand-in that records the arguments it was handed. */
function recordingPrisma(seen: Record<string, unknown>[]) {
  return {
    challenge: {
      create: async (args: Record<string, unknown>) => {
        seen.push(args);
        return { id: "c1" };
      },
      findFirst: async () => null,
      findUnique: async () => null,
      findMany: async (args: Record<string, unknown>) => {
        seen.push(args);
        return [];
      },
      update: async () => ({ id: "c1" }),
    },
    user: {
      findUnique: async () => ({ id: "u2", rating: 100 }),
    },
    game: {
      create: async () => ({ id: "g1" }),
    },
  };
}

type Include = {
  game?: { include?: { white?: unknown; black?: unknown } } | true;
};

function gameInclude(args: Record<string, unknown>): Include["game"] {
  return (args.include as Include).game;
}

describe("the include a challenge is read with", () => {
  it("loads the game's two players, not just the game row", async () => {
    const seen: Record<string, unknown>[] = [];
    const service = new ChallengeService(recordingPrisma(seen) as never);

    await service.createChallenge({
      creatorId: "u1",
      opponentId: "u2",
      creatorColor: "white",
      timeControl: "10+0",
      rated: true,
    });

    const game = gameInclude(seen.at(-1)!);
    expect(game, "game: true loads no players").not.toBe(true);
    expect((game as { include: { white: unknown } }).include.white).toBeTruthy();
    expect((game as { include: { black: unknown } }).include.black).toBeTruthy();
  });

  it("loads each player's profile, because a name may have to be reduced", async () => {
    // §4.3: a non-consented minor resolves to "Brenda A." with no avatar, and
    // that reduction reads the profile. Resolving a player without one would
    // publish the name it exists to withhold.
    const seen: Record<string, unknown>[] = [];
    const service = new ChallengeService(recordingPrisma(seen) as never);

    await service.createChallenge({
      creatorId: "u1",
      opponentId: "u2",
      creatorColor: "black",
      timeControl: "5+0",
      rated: true,
    });

    const game = gameInclude(seen.at(-1)!) as {
      include: { white: { include: Record<string, unknown> } };
    };
    expect(game.include.white.include.profile).toBe(true);
  });

  it("holds for a seek as well, which carries no game at all", async () => {
    // No opponent means no game is created, so nothing throws today. The
    // include still has to be right: `myChallenges` returns open seeks and
    // direct challenges through the same shape.
    const seen: Record<string, unknown>[] = [];
    const service = new ChallengeService(recordingPrisma(seen) as never);

    await service.createChallenge({
      creatorId: "u1",
      creatorColor: "random",
      timeControl: "3+2",
      rated: true,
    });

    expect(gameInclude(seen.at(-1)!)).not.toBe(true);
  });
});

describe("why the include has to carry them", () => {
  it("Game.white returns exactly what was loaded, and fetches nothing", () => {
    // This is the coupling. The resolver is a field read, so a missing
    // relation is `undefined` rather than a lazy query — and `User!` turns
    // `undefined` into the masked error.
    expect(gameResolvers.Game.white({})).toBeUndefined();
    expect(gameResolvers.Game.black({})).toBeUndefined();
    expect(gameResolvers.Game.white({ white: { id: "u1" } })).toEqual({ id: "u1" });
  });
});
