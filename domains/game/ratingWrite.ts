import type { PrismaClient } from "@prisma/client";

import { glicko2Update, DEFAULT_RD, DEFAULT_VOL, type GlickoState } from "./glicko2";

/**
 * ══════════════════════════════════════════════════════════════════════════
 * The one place a Glicko-2 result is written.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Extracted from `GameService.applyGlickoRatings`, which was the only caller
 * until fixture validation needed the same write. There must be exactly one:
 * the two paths differ in *when* they fire (a game ends / an arbiter signs)
 * and must not differ in what they do, or an over-the-board board and an
 * online game would move a player's rating by different amounts.
 *
 * BUILD_PLAN is explicit that ratings read `FixtureBoard`, not `Game` — an
 * over-the-board board with no moves recorded still counts and no `Game` row
 * need exist for it. So this module takes two player ids and a score, and
 * knows nothing about games.
 *
 * **Both updates use the opponent's pre-game state.** Sequencing them would
 * make the result depend on which player is processed first, which is the
 * classic way to get a rating system that disagrees with itself.
 */

/** 0 / 0.5 / 1 from White's point of view. */
export type WhiteScore = 0 | 0.5 | 1;

async function getOrInitRating(
  prisma: PrismaClient,
  userId: string,
  fallbackRating: number
): Promise<GlickoState> {
  const row = await prisma.playerRating.findUnique({ where: { userId } });
  if (row) return { rating: row.rating, rd: row.deviation, vol: row.volatility };
  return { rating: fallbackRating, rd: DEFAULT_RD, vol: DEFAULT_VOL };
}

/** `users.rating` mirrors a rounded copy of the Glicko rating, for display. */
export function toDisplayRating(rating: number): number {
  return Math.round(rating);
}

function upsertRating(prisma: PrismaClient, userId: string, state: GlickoState) {
  return prisma.playerRating.upsert({
    where: { userId },
    create: { userId, rating: state.rating, deviation: state.rd, volatility: state.vol },
    update: { rating: state.rating, deviation: state.rd, volatility: state.vol },
  });
}

/**
 * Rate one decided game between two players.
 *
 * `extraWrites` are Prisma promises committed in the **same transaction** as
 * the two rating rows. Fixture validation passes the `ratedAt` stamp through
 * it, which is what makes BUILD_PLAN §3.3 invariant 3 — "a board rates exactly
 * once" — true rather than merely intended: the stamp and the rating either
 * both land or neither does.
 */
export async function applyPairRating(
  prisma: PrismaClient,
  args: {
    whiteId: string;
    blackId: string;
    /** `users.rating`, the seed used when a player has no `PlayerRating` yet. */
    whiteFallbackRating: number;
    blackFallbackRating: number;
    whiteScore: WhiteScore;
    extraWrites?: Parameters<PrismaClient["$transaction"]>[0];
  }
): Promise<void> {
  const whiteState = await getOrInitRating(prisma, args.whiteId, args.whiteFallbackRating);
  const blackState = await getOrInitRating(prisma, args.blackId, args.blackFallbackRating);

  const whiteNew = glicko2Update(whiteState, blackState, args.whiteScore);
  const blackNew = glicko2Update(blackState, whiteState, 1 - args.whiteScore);

  await prisma.$transaction([
    upsertRating(prisma, args.whiteId, whiteNew),
    upsertRating(prisma, args.blackId, blackNew),
    prisma.user.update({
      where: { id: args.whiteId },
      data: { rating: toDisplayRating(whiteNew.rating) },
    }),
    prisma.user.update({
      where: { id: args.blackId },
      data: { rating: toDisplayRating(blackNew.rating) },
    }),
    ...((args.extraWrites ?? []) as never[]),
  ]);
}
