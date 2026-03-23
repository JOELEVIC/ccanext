import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import type { UserRole } from "@prisma/client";

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

    users: async (
      _: unknown,
      { filters }: { filters?: { role?: UserRole; schoolId?: string; search?: string } },
      context: GraphQLContextWithServices
    ) => {
      return context.services.userService.getUsers(filters);
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

      return context.services.userService.createUser({
        email: input.email as string,
        username: input.username as string,
        password: input.password as string,
        role: input.role as UserRole,
        schoolId: input.schoolId as string | undefined,
        profile: profileData,
      });
    },

    login: async (
      _: unknown,
      { input }: { input: { email: string; password: string } },
      context: GraphQLContextWithServices
    ) => {
      return context.services.userService.authenticateUser(input);
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
