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
  },

  Profile: {
    badges: async (
      parent: { id: string },
      _: unknown,
      context: GraphQLContextWithServices
    ) => {
      return context.services.learningService.getUserBadges(parent.id);
    },
  },
};
