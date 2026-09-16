import type { PrismaClient } from "@prisma/client";
import { GameStatus } from "@prisma/client";

import type { ChallengeService } from "@/domains/challenge/challenge.service";
import { generateToken } from "@/utils/jwt";
import { AuthenticationError, AuthorizationError } from "@/utils/types";

import { isHouseBotSecretValid } from "./secret";

/**
 * ══════════════════════════════════════════════════════════════════════════
 * The house players, as the cca game server sees them.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Two operations, both behind `HOUSE_BOT_SECRET`:
 *
 *   session(userId)  an ordinary player JWT for one house player. The game
 *                    server then uses it exactly as a phone would — to accept
 *                    a challenge, and for the result write-back — so nothing
 *                    downstream has to know the player is not a person.
 *   poll()           everything the server's loop needs in one round trip:
 *                    who the house players are, which seeks and direct
 *                    challenges are waiting, and which games involving a
 *                    house player are still open (so a restarted server can
 *                    adopt them rather than leave a human on an empty board).
 *
 * Minting is refused for any account not flagged `isHouseBot`, whatever the
 * secret. The secret is a credential for those eight rows and no others.
 */
export class HouseBotService {
  constructor(
    private prisma: PrismaClient,
    private challenges: ChallengeService,
    private opts: { secret?: string; mint?: (userId: string, role: string) => string } = {}
  ) {}

  assertSecret(given: string): void {
    if (!isHouseBotSecretValid(this.opts.secret, given)) {
      throw new AuthenticationError("House players are not enabled");
    }
  }

  async session(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AuthenticationError("House players are not enabled");
    if (!user.isHouseBot) throw new AuthorizationError("Not a house player");
    const mint = this.opts.mint ?? generateToken;
    return { token: mint(user.id, user.role), user };
  }

  async poll() {
    const [bots, { seeks, direct }, activeGames] = await Promise.all([
      this.prisma.user.findMany({
        where: { isHouseBot: true },
        select: { id: true, username: true, rating: true },
        orderBy: { rating: "asc" },
      }),
      this.challenges.openChallengesForHouseBots(),
      this.prisma.game.findMany({
        where: {
          status: { in: [GameStatus.PENDING, GameStatus.ACTIVE] },
          OR: [{ white: { isHouseBot: true } }, { black: { isHouseBot: true } }],
        },
        include: {
          white: { include: { profile: true, school: true } },
          black: { include: { profile: true, school: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 20,
      }),
    ]);
    return { bots, seeks, direct, activeGames };
  }
}
