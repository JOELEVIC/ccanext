import type { GraphQLContextWithServices } from "@/graphql/context";
import type { ClubLevel } from "@prisma/client";
import type { PublicClub } from "@/domains/club/club.select";

/**
 * Public club surface (BUILD_PLAN §6).
 *
 * `clubRoster` is one of the four name-bearing public surfaces named in §4.3;
 * it is reduced by `toPublicPlayer()` inside `ClubService.getRoster()`, so
 * nothing here re-derives a name. Note there is deliberately no `joinCode`
 * resolver: the field is absent from the `Club` type and the column is never
 * selected on a public read.
 */
export const clubResolvers = {
  Query: {
    clubs: (
      _: unknown,
      args: {
        region?: string | null;
        level?: ClubLevel | null;
        search?: string | null;
        limit?: number | null;
        offset?: number | null;
      },
      ctx: GraphQLContextWithServices
    ) => ctx.services.clubService.listClubs(args),

    club: (_: unknown, { slug }: { slug: string }, ctx: GraphQLContextWithServices) =>
      ctx.services.clubService.getClubBySlug(slug),

    clubByJoinCode: (_: unknown, { code }: { code: string }, ctx: GraphQLContextWithServices) =>
      ctx.services.clubService.getClubByJoinCode(code),

    clubRoster: (
      _: unknown,
      { slug, teamOnly }: { slug: string; teamOnly?: boolean | null },
      ctx: GraphQLContextWithServices
    ) => ctx.services.clubService.getRoster(slug, teamOnly ?? false),

    clubStanding: (_: unknown, { slug }: { slug: string }, ctx: GraphQLContextWithServices) =>
      ctx.services.clubService.getClubStanding(slug),

    clubNetworkSummary: (_: unknown, __: unknown, ctx: GraphQLContextWithServices) =>
      ctx.services.clubService.getNetworkSummary(),
  },

  Club: {
    // The list and single-club reads attach this in one grouped query; a club
    // reached through a fixture or a standings row has not been counted yet, so
    // it falls back rather than reporting a confident zero.
    memberCount: (
      parent: PublicClub,
      _: unknown,
      ctx: GraphQLContextWithServices
    ): number | Promise<number> =>
      parent.memberCount ?? ctx.services.clubService.memberCount(parent.id),

    honours: (parent: PublicClub) => parent.honours ?? [],
    school: (parent: PublicClub & { school?: unknown }) => parent.school ?? null,

    /**
     * Derived, never stored. `schoolId IS NULL` already answers "is this a
     * school club?", and a stored column beside it would be a second writable
     * source of truth for one fact — free to say SCHOOL while `school` is null.
     */
    kind: (parent: PublicClub & { schoolId?: string | null; school?: unknown }) =>
      parent.schoolId || parent.school ? "SCHOOL" : "INDEPENDENT",
  },

  ClubHonour: {
    season: (parent: { season?: unknown }) => parent.season ?? null,
  },
};
