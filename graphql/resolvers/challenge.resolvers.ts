import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";

function requireUser(context: GraphQLContextWithServices) {
  if (!context.user) {
    throw new GraphQLError("Not authenticated", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return context.user;
}

export const challengeResolvers = {
  Query: {
    challenge: async (
      _: unknown,
      { id }: { id: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.challengeService.getChallenge(id);
    },

    myChallenges: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices
    ) => {
      const user = requireUser(context);
      return context.services.challengeService.myChallenges(user.userId);
    },

    openChallenges: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices
    ) => {
      return context.services.challengeService.openChallenges(
        context.user?.userId
      );
    },
  },

  Mutation: {
    createChallenge: async (
      _: unknown,
      {
        input,
      }: {
        input: {
          opponentId?: string | null;
          creatorColor: string;
          timeControl: string;
          rated: boolean;
        };
      },
      context: GraphQLContextWithServices
    ) => {
      const user = requireUser(context);
      return context.services.challengeService.createChallenge({
        creatorId: user.userId,
        opponentId: input.opponentId ?? null,
        creatorColor: input.creatorColor,
        timeControl: input.timeControl,
        rated: input.rated,
      });
    },

    acceptChallenge: async (
      _: unknown,
      { challengeId }: { challengeId: string },
      context: GraphQLContextWithServices
    ) => {
      const user = requireUser(context);
      return context.services.challengeService.acceptChallenge(
        challengeId,
        user.userId
      );
    },

    declineChallenge: async (
      _: unknown,
      { challengeId }: { challengeId: string },
      context: GraphQLContextWithServices
    ) => {
      const user = requireUser(context);
      return context.services.challengeService.declineChallenge(
        challengeId,
        user.userId
      );
    },

    cancelChallenge: async (
      _: unknown,
      { challengeId }: { challengeId: string },
      context: GraphQLContextWithServices
    ) => {
      const user = requireUser(context);
      return context.services.challengeService.cancelChallenge(
        challengeId,
        user.userId
      );
    },
  },
};
