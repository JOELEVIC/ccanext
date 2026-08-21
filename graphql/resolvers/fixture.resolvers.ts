import type { GraphQLContextWithServices } from "@/graphql/context";
import type { ClubLevel, Competition, FixtureStatus } from "@prisma/client";
import type { FixtureOrder } from "@/domains/fixture/fixture.repository";

/**
 * Fixtures, the live match day, the cup bracket and the two record tables
 * (BUILD_PLAN §6).
 *
 * Fixture board players and `playerStandings` rows are both reduced by
 * `toPublicPlayer()` inside `FixtureService` — two of the four name-bearing
 * public surfaces of §4.3.
 */
export const fixtureResolvers = {
  Query: {
    fixtures: (
      _: unknown,
      args: {
        seasonId: string;
        clubId?: string | null;
        divisionId?: string | null;
        competition?: Competition | null;
        status?: FixtureStatus | null;
        from?: Date | null;
        to?: Date | null;
        orderBy?: FixtureOrder | null;
        limit?: number | null;
      },
      ctx: GraphQLContextWithServices
    ) => ctx.services.fixtureService.listFixtures(args),

    fixture: (_: unknown, { id }: { id: string }, ctx: GraphQLContextWithServices) =>
      ctx.services.fixtureService.getFixture(id),

    fixtureEvents: (
      _: unknown,
      { fixtureId }: { fixtureId: string },
      ctx: GraphQLContextWithServices
    ) => ctx.services.fixtureService.getFixtureEvents(fixtureId),

    liveFixtures: (_: unknown, __: unknown, ctx: GraphQLContextWithServices) =>
      ctx.services.fixtureService.getLiveFixtures(),

    cupBracket: (
      _: unknown,
      { seasonId }: { seasonId: string },
      ctx: GraphQLContextWithServices
    ) => ctx.services.fixtureService.getCupBracket(seasonId),

    playerStandings: (
      _: unknown,
      args: {
        seasonId: string;
        region?: string | null;
        level?: ClubLevel | null;
        limit?: number | null;
      },
      ctx: GraphQLContextWithServices
    ) => ctx.services.fixtureService.getPlayerStandings(args),

    schoolStandings: (
      _: unknown,
      args: { seasonId: string; region?: string | null; limit?: number | null },
      ctx: GraphQLContextWithServices
    ) => ctx.services.fixtureService.getSchoolStandings(args),
  },
};
