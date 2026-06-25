import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import type { PlacementGameInput } from "@/domains/placement/placement.service";

function requireUser(context: GraphQLContextWithServices) {
  if (!context.user) {
    throw new GraphQLError("Not authenticated", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return context.user;
}

export const placementResolvers = {
  Query: {
    placementStatus: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices
    ) => {
      const user = requireUser(context);
      return context.services.placementService.getStatus(user.userId);
    },
  },
  Mutation: {
    startPlacement: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices
    ) => {
      const user = requireUser(context);
      return context.services.placementService.start(user.userId, "self");
    },

    savePlacementProgress: async (
      _: unknown,
      { runId, games }: { runId: string; games: PlacementGameInput[] },
      context: GraphQLContextWithServices
    ) => {
      const user = requireUser(context);
      return context.services.placementService.saveProgress(user.userId, runId, games);
    },

    submitPlacement: async (
      _: unknown,
      { runId, games }: { runId: string; games: PlacementGameInput[] },
      context: GraphQLContextWithServices
    ) => {
      const user = requireUser(context);
      return context.services.placementService.submit(user.userId, runId, games);
    },
  },
};
