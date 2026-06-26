import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import type { GameStatus, GameResult } from "@prisma/client";

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

    cancelGame: async (
      _: unknown,
      { gameId }: { gameId: string },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.gameService.cancelGame(
        gameId,
        context.user.userId
      );
    },

    recordGameResult: async (
      _: unknown,
      {
        gameId,
        result,
        reason,
        moves,
      }: {
        gameId: string;
        result?: GameResult | null;
        reason?: string | null;
        moves?: string | null;
      },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      const game = await context.services.gameService.recordGameResult({
        gameId,
        userId: context.user.userId,
        result: result ?? null,
        reason,
        moves,
      });

      // If this was a tournament board, mirror the outcome onto its pairing and
      // (auto-)advance the round. Best-effort: never let a tournament sync error
      // fail the core result recording.
      const g = game as { id: string; status?: string; result?: string | null; tournamentId?: string | null };
      if (g.tournamentId && g.status === "COMPLETED" && g.result) {
        try {
          await context.services.tournamentRoundService.syncGameResult(g.id, g.result);
        } catch (err) {
          console.error("[recordGameResult] tournament pairing sync failed:", err);
        }
      }
      return game;
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
