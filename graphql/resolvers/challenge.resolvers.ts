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
      { timeControl }: { timeControl?: string | null },
      context: GraphQLContextWithServices
    ) => {
      return context.services.challengeService.openChallenges(
        context.user?.userId,
        timeControl ?? null
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

  Challenge: {
    /**
     * Through `toPublicPlayer()` like every other public name (§4.3). One
     * lookup per challenge rather than a wider include: a person has a
     * handful of challenges at a time, and the alternative is threading the
     * public-player select through every challenge query for a field two
     * screens read.
     */
    creatorPlayer: async (
      challenge: { creatorId: string },
      _: unknown,
      context: GraphQLContextWithServices
    ) => {
      const player = await context.services.userService.getPublicPlayer(
        challenge.creatorId
      );
      if (!player) throw new GraphQLError("Challenge creator no longer exists");
      return player;
    },

    opponentPlayer: async (
      challenge: { opponentId: string | null },
      _: unknown,
      context: GraphQLContextWithServices
    ) => {
      if (!challenge.opponentId) return null;
      return context.services.userService.getPublicPlayer(challenge.opponentId);
    },
  },
};
