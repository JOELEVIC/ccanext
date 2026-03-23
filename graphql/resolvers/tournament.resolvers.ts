import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import type { TournamentStatus } from "@prisma/client";

export const tournamentResolvers = {
  Query: {
    tournament: async (
      _: unknown,
      { id }: { id: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.tournamentService.getTournamentById(id);
    },

    schoolTournaments: async (
      _: unknown,
      { schoolId }: { schoolId: string },
      context: GraphQLContextWithServices
    ) => {
      return context.services.tournamentService.getSchoolTournaments(schoolId);
    },

    tournaments: async (
      _: unknown,
      { status }: { status?: TournamentStatus },
      context: GraphQLContextWithServices
    ) => {
      return context.services.tournamentService.getTournaments(
        status ? { status } : undefined
      );
    },
  },

  Mutation: {
    createTournament: async (
      _: unknown,
      { input }: { input: Record<string, unknown> },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.tournamentService.createTournament({
        name: input.name as string,
        schoolId: input.schoolId as string,
        startDate: new Date(input.startDate as string),
        endDate: input.endDate
          ? new Date(input.endDate as string)
          : undefined,
      });
    },

    joinTournament: async (
      _: unknown,
      { tournamentId }: { tournamentId: string },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      await context.services.tournamentService.addParticipant({
        tournamentId,
        userId: context.user.userId,
      });
      return context.services.tournamentService.getTournamentById(tournamentId);
    },

    startTournament: async (
      _: unknown,
      { tournamentId }: { tournamentId: string },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.tournamentService.startTournament(tournamentId);
    },

    completeTournament: async (
      _: unknown,
      { tournamentId }: { tournamentId: string },
      context: GraphQLContextWithServices
    ) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      return context.services.tournamentService.completeTournament(tournamentId);
    },
  },

  Tournament: {
    school: (parent: { school?: unknown }) => parent.school,
    participants: (parent: { participants?: unknown }) => parent.participants,
    games: (parent: { games?: unknown }) => parent.games,
    currentPlayers: (parent: { participants?: { length: number }[] }) =>
      parent.participants?.length ?? 0,
    prizePoolJson: (parent: { prizePoolJson?: unknown }) =>
      parent.prizePoolJson == null
        ? null
        : typeof parent.prizePoolJson === "string"
          ? parent.prizePoolJson
          : JSON.stringify(parent.prizePoolJson),
  },

  TournamentParticipant: {
    user: (parent: { user?: unknown }) => parent.user,
  },
};
