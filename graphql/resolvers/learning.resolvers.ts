import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";

export const learningResolvers = {
  Query: {
    dailyPuzzle: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices
    ) => {
      return context.services.learningService.getDailyPuzzle();
    },

    puzzles: async (
      _: unknown,
      { difficulty }: { difficulty?: number },
      context: GraphQLContextWithServices
    ) => {
      return context.services.learningService.getPuzzles(
        difficulty ? { difficulty } : undefined
      );
    },

    puzzle: async (
      _: unknown,
      { id }: { id: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.learningService.getPuzzleById(id);
    },
  },

  Mutation: {
    checkPuzzleSolution: async (
      _: unknown,
      { puzzleId, solution }: { puzzleId: string; solution: string },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.learningService.checkSolution({
        puzzleId,
        userSolution: solution,
      });
    },
  },
};
