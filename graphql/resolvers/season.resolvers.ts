import type { GraphQLContextWithServices } from "@/graphql/context";
import type { ClubLevel } from "@prisma/client";

/**
 * Seasons, divisions and division tables (BUILD_PLAN §6).
 *
 * `divisionTable` and `clubStanding` are DERIVED at read time from VALIDATED
 * fixtures by `domains/fixture/scoring.ts` (§3.3 #2), tie-breaks included, so
 * the public table and the scoring tests are the same code.
 */
export const seasonResolvers = {
  Query: {
    currentSeason: (_: unknown, __: unknown, ctx: GraphQLContextWithServices) =>
      ctx.services.seasonService.getCurrentSeason(),

    seasons: (_: unknown, __: unknown, ctx: GraphQLContextWithServices) =>
      ctx.services.seasonService.getSeasons(),

    divisions: (
      _: unknown,
      { seasonId, level }: { seasonId: string; level?: ClubLevel | null },
      ctx: GraphQLContextWithServices
    ) => ctx.services.seasonService.getDivisions(seasonId, level ?? null),

    divisionTable: (
      _: unknown,
      { divisionId }: { divisionId: string },
      ctx: GraphQLContextWithServices
    ) => ctx.services.seasonService.getDivisionTable(divisionId),
  },

  Season: {
    divisions: (
      parent: { id: string; divisions?: unknown[] },
      _: unknown,
      ctx: GraphQLContextWithServices
    ) => parent.divisions ?? ctx.services.seasonService.getDivisions(parent.id, null),
  },
};
