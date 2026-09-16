import type { PrismaClient } from "@prisma/client";
import { ChallengeStatus, GameStatus } from "@prisma/client";
import {
  ValidationError,
  NotFoundError,
  AuthorizationError,
} from "@/utils/types";
import { GameRepository } from "../game/game.repository";

/** Open challenges auto-expire after this long. */
const CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

const COLORS = ["white", "black", "random"] as const;

export class ChallengeService {
  private gameRepository: GameRepository;

  constructor(private prisma: PrismaClient) {
    this.gameRepository = new GameRepository(prisma);
  }

  /**
   * ── `game` must load its players, and this is not a nicety ──────────────
   *
   * `Game.white` and `Game.black` are `User!` in the schema, and their
   * resolvers are `parent.white` / `parent.black` — they read what Prisma
   * loaded and do no fetching of their own. `game: true` loads the Game row
   * WITHOUT those relations, so both come back `undefined`, which for a
   * non-null field is an error graphql-yoga masks as "Unexpected error."
   *
   * The symptom was a challenge that had in fact been created: the mutation
   * returned the row, the errors array was non-empty because one nested field
   * threw, and every client treats a non-empty errors array as failure. So
   * inviting somebody looked broken while working, and `myChallenges` — which
   * the app polls — failed the same way on any screen that was open.
   *
   * `profile` and `school` ride along because `PublicPlayer` reduces a
   * non-consented minor's name from the profile (§4.3); resolving a player
   * without it would publish a name that must not be published.
   */
  private include = {
    creator: { include: { profile: true } },
    opponent: { include: { profile: true } },
    game: {
      include: {
        white: { include: { profile: true, school: true } },
        black: { include: { profile: true, school: true } },
      },
    },
  };

  async createChallenge(data: {
    creatorId: string;
    opponentId?: string | null;
    creatorColor: string;
    timeControl: string;
    rated: boolean;
  }) {
    const color = (COLORS as readonly string[]).includes(data.creatorColor)
      ? data.creatorColor
      : "random";

    if (!/^\d+\+\d+$/.test(data.timeControl))
      throw new ValidationError(
        'Invalid time control. Use format: "minutes+increment"'
      );

    let gameId: string | null = null;

    if (data.opponentId) {
      if (data.opponentId === data.creatorId)
        throw new ValidationError("You can't challenge yourself");
      const opp = await this.prisma.user.findUnique({
        where: { id: data.opponentId },
      });
      if (!opp) throw new ValidationError("Opponent not found");

      // Dedupe — never stack multiple live challenges on the same person.
      // Re-sending just returns the existing one (and its game), so the
      // challenger lands back in the same waiting game.
      const existing = await this.prisma.challenge.findFirst({
        where: {
          status: ChallengeStatus.OPEN,
          creatorId: data.creatorId,
          opponentId: data.opponentId,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: this.include,
      });
      if (existing) return existing;

      // Direct challenge: both players are known, so create the game up-front
      // (PENDING). The challenger is dropped straight into it to wait; the
      // opponent joins the very same game when they accept.
      const resolved = color === "random" ? (Math.random() < 0.5 ? "white" : "black") : color;
      const whiteId = resolved === "white" ? data.creatorId : data.opponentId;
      const blackId = resolved === "white" ? data.opponentId : data.creatorId;
      const game = await this.gameRepository.create({
        whiteId,
        blackId,
        timeControl: data.timeControl,
        rated: data.rated,
      });
      gameId = game.id;
    }

    return this.prisma.challenge.create({
      data: {
        creatorId: data.creatorId,
        opponentId: data.opponentId ?? null,
        creatorColor: color,
        timeControl: data.timeControl,
        rated: data.rated,
        status: ChallengeStatus.OPEN,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        gameId,
      },
      include: this.include,
    });
  }

  /** Accept an open challenge: create the game (colors resolved), link it, return the game. */
  async acceptChallenge(challengeId: string, userId: string) {
    const ch = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });
    if (!ch) throw new NotFoundError("Challenge not found");

    // Idempotent: if it's already been accepted, hand back the existing game.
    if (ch.status === ChallengeStatus.ACCEPTED && ch.gameId) {
      return this.gameRepository.findById(ch.gameId);
    }
    if (ch.status !== ChallengeStatus.OPEN)
      throw new ValidationError("This challenge is no longer open");
    if (ch.expiresAt && ch.expiresAt.getTime() < Date.now()) {
      await this.prisma.challenge.update({
        where: { id: challengeId },
        data: { status: ChallengeStatus.EXPIRED },
      });
      throw new ValidationError("This challenge has expired");
    }
    if (userId === ch.creatorId)
      throw new ValidationError("You can't accept your own challenge");
    if (ch.opponentId && ch.opponentId !== userId)
      throw new AuthorizationError("This challenge isn't addressed to you");

    // Direct challenges already have a PENDING game with both players assigned —
    // just join it. Open invites have no game yet, so create it now.
    let gameId = ch.gameId;
    if (!gameId) {
      const color =
        ch.creatorColor === "random"
          ? Math.random() < 0.5
            ? "white"
            : "black"
          : ch.creatorColor;
      const whiteId = color === "white" ? ch.creatorId : userId;
      const blackId = color === "white" ? userId : ch.creatorId;
      const game = await this.gameRepository.create({
        whiteId,
        blackId,
        timeControl: ch.timeControl,
        rated: ch.rated,
      });
      gameId = game.id;
    }

    await this.prisma.challenge.update({
      where: { id: challengeId },
      data: {
        status: ChallengeStatus.ACCEPTED,
        opponentId: userId,
        gameId,
      },
    });

    return this.gameRepository.findById(gameId);
  }

  async declineChallenge(challengeId: string, userId: string) {
    const ch = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });
    if (!ch) throw new NotFoundError("Challenge not found");
    if (ch.status !== ChallengeStatus.OPEN)
      throw new ValidationError("This challenge is no longer open");
    if (ch.opponentId !== userId)
      throw new AuthorizationError("This challenge isn't addressed to you");
    await this.abandonPendingGame(ch.gameId);
    return this.prisma.challenge.update({
      where: { id: challengeId },
      data: { status: ChallengeStatus.DECLINED },
      include: this.include,
    });
  }

  /** End the up-front game if the challenge is rejected/cancelled before play. */
  private async abandonPendingGame(gameId: string | null) {
    if (!gameId) return;
    await this.prisma.game.updateMany({
      where: { id: gameId, status: GameStatus.PENDING },
      data: { status: GameStatus.ABANDONED },
    });
  }

  async cancelChallenge(challengeId: string, userId: string) {
    const ch = await this.prisma.challenge.findUnique({
      where: { id: challengeId },
    });
    if (!ch) throw new NotFoundError("Challenge not found");
    if (ch.creatorId !== userId)
      throw new AuthorizationError("Only the creator can cancel this challenge");
    if (ch.status !== ChallengeStatus.OPEN)
      throw new ValidationError("This challenge is no longer open");
    await this.abandonPendingGame(ch.gameId);
    return this.prisma.challenge.update({
      where: { id: challengeId },
      data: { status: ChallengeStatus.CANCELLED },
      include: this.include,
    });
  }

  async getChallenge(challengeId: string) {
    return this.prisma.challenge.findUnique({
      where: { id: challengeId },
      include: this.include,
    });
  }

  /** Open challenges that involve me — ones I sent and ones addressed to me. */
  async myChallenges(userId: string) {
    return this.prisma.challenge.findMany({
      where: {
        status: ChallengeStatus.OPEN,
        OR: [{ opponentId: userId }, { creatorId: userId }],
        // Expired rows used to come back and sit in a list nobody could act
        // on. `acceptChallenge` only flips a row to EXPIRED when somebody
        // tries to take it, so an invitation nobody opened stays OPEN for
        // ever as far as this query is concerned — and a dead invitation on
        // screen is worse than an empty list, because somebody taps it.
        //
        // `NOT lte` rather than `gt`: a null `expiresAt` means "never", and
        // `gt` would silently drop every row written before the TTL existed.
        NOT: { expiresAt: { lte: new Date() } },
      },
      include: this.include,
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * The seek pool: open invites with no named opponent, which anybody may
   * take.
   *
   * ── This is the whole of matchmaking ─────────────────────────────────────
   *
   * There is no queue, no matcher and no new model. "Find me a game" is: take
   * the oldest open invite at this cadence, or post one and be taken. Two
   * people who both post are matched by whichever of them looks second, which
   * is the same answer a queue would reach and needs nothing to run between
   * requests.
   *
   * Oldest first — `asc`, not the `desc` this used to return. A pool read
   * newest-first pairs the two most recent seekers and leaves whoever has
   * waited longest waiting longer, which is exactly backwards.
   *
   * ── Who is in it ─────────────────────────────────────────────────────────
   *
   * Filtering is by CREATOR, not by viewer: somebody who has switched
   * themselves out of the open pool should not have their own invitations
   * offered to strangers either. `openToChallenges` defaults true and
   * `Club.poolOptOut` defaults false, so the ordinary case adds no rows to
   * the join and the ordinary player is in the pool.
   */
  async openChallenges(userId?: string, timeControl?: string | null) {
    return this.prisma.challenge.findMany({
      where: {
        status: ChallengeStatus.OPEN,
        opponentId: null,
        ...(userId ? { creatorId: { not: userId } } : {}),
        ...(timeControl ? { timeControl } : {}),
        NOT: { expiresAt: { lte: new Date() } },
        creator: {
          profile: { is: { openToChallenges: true } },
          memberships: { none: { status: "ACTIVE", club: { poolOptOut: true } } },
        },
      },
      include: this.include,
      orderBy: { createdAt: "asc" },
      take: 50,
    });
  }

  /**
   * What the house players may answer: every open seek a human has posted,
   * and every open challenge a human has addressed to a house player.
   *
   * Deliberately WITHOUT `openChallenges`'s two pool filters. Those decide
   * who may be challenged by a stranger — a student who opted out of the
   * pool, a club that opted its children out. A seeker is not being
   * challenged by anybody; they asked for a game, and the house is not a
   * stranger. It also serves the accounts with no Profile row, which the
   * `profile: { is: … }` filter makes invisible to the pool.
   *
   * Never a seek by a house player (they do not seek) and never a direct
   * challenge from one — two bots playing each other is a game nobody is
   * watching and nobody's rating should move for.
   */
  async openChallengesForHouseBots() {
    const live = { status: ChallengeStatus.OPEN, NOT: { expiresAt: { lte: new Date() } } };
    const [seeks, direct] = await Promise.all([
      this.prisma.challenge.findMany({
        where: { ...live, opponentId: null, creator: { isHouseBot: false } },
        include: this.include,
        orderBy: { createdAt: "asc" },
        take: 50,
      }),
      this.prisma.challenge.findMany({
        where: { ...live, opponent: { isHouseBot: true }, creator: { isHouseBot: false } },
        include: this.include,
        orderBy: { createdAt: "asc" },
        take: 50,
      }),
    ]);
    return { seeks, direct };
  }
}
