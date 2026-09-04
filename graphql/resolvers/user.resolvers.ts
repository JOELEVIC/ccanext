import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import type { UserRole } from "@prisma/client";
import { markSelfDisclosed } from "@/domains/user/identityVisibility";

/**
 * Owner or staff — the same test `identityVisibility.isPrivilegedViewer`
 * makes, restated here because these two fields are not §4.3 fields and must
 * not look like they are. §4.3 reduces a name; this simply withholds a
 * setting from everybody it does not belong to.
 */
function isSelfOrStaff(
  context: GraphQLContextWithServices,
  userId: string,
): boolean {
  return context.viewer.isStaff || context.viewer.userId === userId;
}

export const userResolvers = {
  Query: {
    me: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.userService.getUserById(context.user.userId);
    },

    user: async (
      _: unknown,
      { id }: { id: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.userService.getUserById(id);
    },

    /**
     * Unauthenticated. The viewer is handed to the service because `filters.search`
     * is itself a read of `User.email` unless it is scoped — see
     * `UserRepository.findMany` — and because an uncapped public list is a
     * one-request scrape of the whole roster.
     *
     * `context.viewer.isStaff` comes from the admin token alone; a player token
     * claiming `role: "NATIONAL_ADMIN"` widens nothing here.
     */
    users: async (
      _: unknown,
      { filters }: { filters?: { role?: UserRole; schoolId?: string; search?: string } },
      context: GraphQLContextWithServices
    ) => {
      return context.services.userService.getUsers(filters, context.viewer);
    },

    /**
     * The consent-gated public view of one player (BUILD_PLAN §4.3 / §6).
     * Routed through toPublicPlayer() in the service — never through the `User`
     * type, which carries the real name and is for authenticated surfaces.
     */
    publicPlayer: async (
      _: unknown,
      { id }: { id: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.userService.getPublicPlayer(id);
    },
  },

  Mutation: {
    register: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      context: GraphQLContextWithServices
    ) => {
      const profileData =
        input.firstName && input.lastName
          ? {
              firstName: input.firstName as string,
              lastName: input.lastName as string,
            }
          : undefined;

      const registered = await context.services.userService.createUser({
        email: input.email as string,
        username: input.username as string,
        password: input.password as string,
        role: input.role as UserRole,
        schoolId: input.schoolId as string | undefined,
        // BUILD_PLAN §6: register "exists; extend with optional joinCode".
        joinCode: input.joinCode as string | undefined,
        profile: profileData,
      });
      // The caller just proved they own this account, but the request carried
      // no token, so `context.user` is empty. Mark it self so `User.email`
      // still answers — see `markSelfDisclosed`.
      return { ...registered, user: markSelfDisclosed(registered.user) };
    },

    login: async (
      _: unknown,
      { input }: { input: { email: string; password: string } },
      context: GraphQLContextWithServices
    ) => {
      const authed = await context.services.userService.authenticateUser(input);
      return { ...authed, user: markSelfDisclosed(authed.user) };
    },

    loginWithGoogle: async (
      _: unknown,
      { idToken }: { idToken: string },
      context: GraphQLContextWithServices
    ) => {
      const authed = await context.services.userService.loginWithGoogle(idToken);
      return { ...authed, user: markSelfDisclosed(authed.user) };
    },

    updateProfile: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.userService.updateProfile(
        context.user.userId,
        input as { firstName?: string; lastName?: string; dateOfBirth?: Date; country?: string }
      );
    },
  },

  User: {
    /**
     * BUILD_PLAN §4.3 / the acceptance line "no full name of a non-consented
     * minor appears in any public response".
     *
     * An email is not a display field — no public surface renders one — so it
     * has no consent branch at all: the account owner and academy staff, and
     * nobody else. The guard sits on the TYPE, so every query that returns a
     * `User` inherits it: `user`, `users`, `school.students`, `schoolLeaderboard`,
     * `playersLeaderboard`, `liveGames`, tournament participants, and whatever
     * public resolver is added next.
     */
    email: (parent: { id: string; email?: string | null }, _: unknown, context: GraphQLContextWithServices) =>
      context.identity.email(parent),
    profile: (parent: { profile?: unknown }) => parent.profile,
    school: (parent: { school?: unknown }) => parent.school,
    variantRatings: async (
      parent: { id: string },
      _: unknown,
      context: GraphQLContextWithServices
    ) => {
      return context.prisma.userVariantRating.findMany({
        where: { userId: parent.id },
        orderBy: { variant: "asc" },
      });
    },
    totalGamesPlayed: async (
      parent: { id: string },
      _: unknown,
      context: GraphQLContextWithServices
    ) => {
      return context.prisma.game.count({
        where: {
          status: "COMPLETED",
          OR: [{ whiteId: parent.id }, { blackId: parent.id }],
        },
      });
    },
  },

  Profile: {
    /**
     * The §4.3 truth table, applied to the fields `Profile` carries. The
     * decision itself is `canShowFullIdentity()` in `publicPlayer.ts` — the same
     * function `toPublicPlayer()` uses — reached through `context.identity`.
     *
     * `firstName` is NOT guarded, deliberately: §4.3's reduced identity is
     * "Brenda A.", so the given name survives in full and only the surname
     * collapses to an initial. See the header of `identityVisibility.ts`.
     */
    lastName: (parent: { userId: string; lastName?: string | null }, _: unknown, context: GraphQLContextWithServices) =>
      context.identity.lastName(parent),
    dateOfBirth: (parent: { userId: string; dateOfBirth?: Date | null }, _: unknown, context: GraphQLContextWithServices) =>
      context.identity.dateOfBirth(parent),
    avatarUrl: (parent: { userId: string; avatarUrl?: string | null }, _: unknown, context: GraphQLContextWithServices) =>
      context.identity.avatarUrl(parent),
    /**
     * The two switches, visible to their owner and to staff and to nobody
     * else.
     *
     * Whether somebody is open to a game is their business rather than a
     * browsable attribute: a list of exactly which children have left the
     * default on is the list a person looking for an easy target would want,
     * and it is not a list this API should be able to produce.
     *
     * The pool queries filter on the column server-side and never return it,
     * so the setting does its work without ever being readable.
     */
    openToChallenges: (
      parent: { userId: string; openToChallenges?: boolean | null },
      _: unknown,
      context: GraphQLContextWithServices,
    ) =>
      isSelfOrStaff(context, parent.userId) ? (parent.openToChallenges ?? true) : null,

    gamesPublic: (
      parent: { userId: string; gamesPublic?: boolean | null },
      _: unknown,
      context: GraphQLContextWithServices,
    ) => (isSelfOrStaff(context, parent.userId) ? (parent.gamesPublic ?? true) : null),

    level: (parent: { xp: number }) => {
      return 1 + Math.floor((parent.xp ?? 0) / 100);
    },
    ratingTrend: (parent: { ratingTrendJson?: unknown }) => {
      const j = parent.ratingTrendJson;
      if (!Array.isArray(j)) return [];
      return j.map((x) => Number(x));
    },
    badges: async (
      parent: { id: string },
      _: unknown,
      context: GraphQLContextWithServices
    ) => {
      return context.services.learningService.getUserBadges(parent.id);
    },
  },

  UserVariantRating: {
    variant: (parent: { variant: string }) => parent.variant,
    rating: (parent: { rating: number }) => parent.rating,
    ratingDelta: (parent: { ratingDelta: number }) => parent.ratingDelta,
    gamesPlayed: (parent: { gamesPlayed: number }) => parent.gamesPlayed,
  },
};
