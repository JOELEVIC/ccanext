import { describe, expect, it } from "vitest";
import { ChallengeService } from "@/domains/challenge/challenge.service";

/**
 * Challenges that carry a position, and challenges that back a link.
 *
 * Two of these hold shut bugs that would otherwise have shipped, and both are
 * invisible in a happy-path test:
 *
 *   · **A link would have been eaten by the open pool.** An OPEN challenge
 *     with a null opponentId is a shareable invite AND the exact row
 *     `openChallenges` deals to the next stranger who taps Start. Without
 *     `viaLink` they are the same row.
 *   · **An old client would have been dropped into a position it cannot
 *     draw.** Nothing in a request carries a client version, so the client
 *     has to declare the capability, and `acceptChallenge` is the one place
 *     every route into a game passes through.
 */

const PHILIDOR = "4k3/8/r7/3KP3/8/8/8/4R3 b - - 0 1";
const STANDARD = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

type Args = Record<string, any>;

function fakePrisma(opts: {
  challenge?: Args;
  onChallengeCreate?: (a: Args) => void;
  onGameCreate?: (a: Args) => void;
  onFindMany?: (a: Args) => void;
}) {
  return {
    challenge: {
      create: async (a: Args) => {
        opts.onChallengeCreate?.(a);
        return { id: "c1" };
      },
      findFirst: async () => null,
      findUnique: async () => opts.challenge ?? null,
      findMany: async (a: Args) => {
        opts.onFindMany?.(a);
        return [];
      },
      update: async () => ({ id: "c1" }),
    },
    user: { findUnique: async () => ({ id: "u2", rating: 1200 }) },
    game: {
      create: async (a: Args) => {
        opts.onGameCreate?.(a);
        return { id: "g1" };
      },
      findUnique: async () => ({ id: "g1" }),
    },
  };
}

describe("a challenge from a position", () => {
  it("stores the position on the challenge and on its game", async () => {
    const challenges: Args[] = [];
    const games: Args[] = [];
    const service = new ChallengeService(
      fakePrisma({
        onChallengeCreate: (a) => challenges.push(a),
        onGameCreate: (a) => games.push(a),
      }) as never
    );

    await service.createChallenge({
      creatorId: "u1",
      opponentId: "u2",
      creatorColor: "white",
      timeControl: "10+0",
      rated: true,
      startFen: PHILIDOR,
      positionSlug: "philidor-position",
    });

    expect(challenges[0].data.startFen).toBe(PHILIDOR);
    expect(challenges[0].data.positionSlug).toBe("philidor-position");
    // A direct challenge creates its game up front, and the position has to
    // travel with it — the live server reads it off the Game, not the
    // Challenge.
    expect(games[0].data.startFen).toBe(PHILIDOR);
    expect(games[0].data.positionSlug).toBe("philidor-position");
  });

  it("is casual, whatever the client asked for", async () => {
    // A Glicko result is a claim about playing strength and is only that claim
    // if both players started equal. Decided server-side because `rated` is a
    // client-supplied boolean.
    const challenges: Args[] = [];
    const games: Args[] = [];
    const service = new ChallengeService(
      fakePrisma({
        onChallengeCreate: (a) => challenges.push(a),
        onGameCreate: (a) => games.push(a),
      }) as never
    );

    await service.createChallenge({
      creatorId: "u1",
      opponentId: "u2",
      creatorColor: "white",
      timeControl: "10+0",
      rated: true,
      startFen: PHILIDOR,
    });

    expect(challenges[0].data.rated).toBe(false);
    expect(games[0].data.rated).toBe(false);
  });

  it("leaves an ordinary challenge rated", async () => {
    const challenges: Args[] = [];
    const service = new ChallengeService(
      fakePrisma({ onChallengeCreate: (a) => challenges.push(a) }) as never
    );

    await service.createChallenge({
      creatorId: "u1",
      creatorColor: "white",
      timeControl: "10+0",
      rated: true,
    });

    expect(challenges[0].data.rated).toBe(true);
    expect(challenges[0].data.startFen).toBeNull();
  });

  it("refuses to coin-flip the colour", async () => {
    // A link whose point is "play Morphy's side against me" must not deal
    // either side, and the sender has to be able to see what they sent.
    const service = new ChallengeService(fakePrisma({}) as never);

    await expect(
      service.createChallenge({
        creatorId: "u1",
        creatorColor: "random",
        timeControl: "10+0",
        rated: false,
        startFen: PHILIDOR,
      })
    ).rejects.toThrow(/colour/i);
  });

  it("refuses a bad position before writing anything", async () => {
    let wrote = false;
    const service = new ChallengeService(
      fakePrisma({ onChallengeCreate: () => (wrote = true) }) as never
    );

    await expect(
      service.createChallenge({
        creatorId: "u1",
        creatorColor: "white",
        timeControl: "10+0",
        rated: false,
        startFen: "not a position",
      })
    ).rejects.toThrow();
    expect(wrote).toBe(false);
  });

  it("treats the standard position as no position at all", async () => {
    const challenges: Args[] = [];
    const service = new ChallengeService(
      fakePrisma({ onChallengeCreate: (a) => challenges.push(a) }) as never
    );

    await service.createChallenge({
      creatorId: "u1",
      creatorColor: "white",
      timeControl: "10+0",
      rated: true,
      startFen: STANDARD,
    });

    expect(challenges[0].data.startFen).toBeNull();
    expect(challenges[0].data.rated).toBe(true);
  });
});

describe("a link is not a seek", () => {
  it("is invisible to the open pool", async () => {
    const queries: Args[] = [];
    const service = new ChallengeService(
      fakePrisma({ onFindMany: (a) => queries.push(a) }) as never
    );

    await service.openChallenges("u9", "10+0");
    expect(queries[0].where.viaLink).toBe(false);
  });

  it("is invisible to the house-bot poll", async () => {
    // More urgent than the pool: the bots poll this, so a link left for one
    // interval would be answered by a machine rather than by the person it
    // was sent to.
    const queries: Args[] = [];
    const service = new ChallengeService(
      fakePrisma({ onFindMany: (a) => queries.push(a) }) as never
    );

    await service.openChallengesForHouseBots();
    const seeks = queries.find((q) => q.where.opponentId === null);
    expect(seeks?.where.viaLink).toBe(false);
  });

  it("lives longer than a seek", async () => {
    // A day is right for an invitation in a pool and wrong for a link sent on
    // a Friday night to somebody who opens their phone on Sunday.
    const challenges: Args[] = [];
    const service = new ChallengeService(
      fakePrisma({ onChallengeCreate: (a) => challenges.push(a) }) as never
    );

    await service.createChallenge({
      creatorId: "u1",
      creatorColor: "white",
      timeControl: "10+0",
      rated: true,
      viaLink: true,
    });
    const link = challenges[0].data.expiresAt.getTime();

    await service.createChallenge({
      creatorId: "u1",
      creatorColor: "white",
      timeControl: "10+0",
      rated: true,
    });
    const seek = challenges[1].data.expiresAt.getTime();

    expect(challenges[0].data.viaLink).toBe(true);
    expect(challenges[1].data.viaLink).toBe(false);
    expect(link).toBeGreaterThan(seek);
  });
});

describe("the capability gate on accept", () => {
  const open = {
    id: "c1",
    creatorId: "u1",
    opponentId: null,
    creatorColor: "white",
    timeControl: "10+0",
    rated: false,
    status: "OPEN",
    gameId: null,
    expiresAt: null,
    startFen: PHILIDOR,
    positionSlug: "philidor-position",
  };

  it("refuses a client that did not say it can draw the position", async () => {
    let madeGame = false;
    const service = new ChallengeService(
      fakePrisma({
        challenge: open,
        onGameCreate: () => (madeGame = true),
      }) as never
    );

    await expect(service.acceptChallenge("c1", "u2")).rejects.toThrow(
      /update the app/i
    );
    expect(madeGame).toBe(false);
  });

  it("accepts one that did, and carries the position onto the game", async () => {
    const games: Args[] = [];
    const service = new ChallengeService(
      fakePrisma({
        challenge: open,
        onGameCreate: (a) => games.push(a),
      }) as never
    );

    await service.acceptChallenge("c1", "u2", { supportsStartFen: true });
    expect(games[0].data.startFen).toBe(PHILIDOR);
  });

  it("leaves an ordinary challenge alone", async () => {
    // The regression net for every client in the field: none of them sends
    // the flag, and none of them may be affected by it.
    const games: Args[] = [];
    const service = new ChallengeService(
      fakePrisma({
        challenge: { ...open, startFen: null, positionSlug: null },
        onGameCreate: (a) => games.push(a),
      }) as never
    );

    await service.acceptChallenge("c1", "u2");
    expect(games[0].data.startFen).toBeNull();
  });
});
