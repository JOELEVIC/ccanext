import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import type { GameStatus } from "@prisma/client";

export const gameResolvers = {
  Query: {
    game: async (
      _: unknown,
      { id }: { id: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.gameService.getGameById(id);
    },

    myGames: async (
      _: unknown,
      { status }: { status?: GameStatus },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.gameService.getUserGames(
        context.user.userId,
        status
      );
    },

    liveGames: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices
    ) => {
      return context.services.gameService.getActiveGames();
    },
  },

  Mutation: {
    createGame: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.gameService.createGame(input as {
        whiteId: string;
        blackId: string;
        timeControl: string;
        tournamentId?: string;
      });
    },

    makeMove: async (
      _: unknown,
      { gameId, move }: { gameId: string; move: string },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.gameService.makeMove({
        gameId,
        move,
        userId: context.user.userId,
      });
    },

    resignGame: async (
      _: unknown,
      { gameId }: { gameId: string },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.gameService.resignGame(
        gameId,
        context.user.userId
      );
    },

    recordGameCompleted: async (
      _: unknown,
      { gameId }: { gameId: string },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.gameService.recordGameCompleted(
        gameId,
        context.user.userId
      );
    },
  },

  Game: {
    white: (parent: { white?: unknown }) => parent.white,
    black: (parent: { black?: unknown }) => parent.black,
    tournament: (parent: { tournament?: unknown }) => parent.tournament,
    analysisJson: (parent: { analysisJson?: unknown }) =>
      parent.analysisJson == null
        ? null
        : typeof parent.analysisJson === "string"
          ? parent.analysisJson
          : JSON.stringify(parent.analysisJson),
  },
};
