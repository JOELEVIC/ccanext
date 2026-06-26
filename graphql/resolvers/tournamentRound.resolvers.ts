import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";

function requireAdmin(ctx: GraphQLContextWithServices) {
  if (!ctx.admin) {
    throw new GraphQLError("Admin authentication required", {
      extensions: { code: "ADMIN_UNAUTHENTICATED" },
    });
  }
  return ctx.admin;
}

export const tournamentRoundResolvers = {
  Query: {
    // Public — anyone can view rounds + standings.
    tournamentRounds: (_: unknown, { tournamentId }: { tournamentId: string }, ctx: GraphQLContextWithServices) =>
      ctx.services.tournamentRoundService.listRounds(tournamentId),
    tournamentStandings: (_: unknown, { tournamentId }: { tournamentId: string }, ctx: GraphQLContextWithServices) =>
      ctx.services.tournamentRoundService.standings(tournamentId),
  },
  Mutation: {
    adminTournamentStartRound: (
      _: unknown,
      { tournamentId }: { tournamentId: string },
      ctx: GraphQLContextWithServices
    ) => {
      requireAdmin(ctx);
      return ctx.services.tournamentRoundService.startRound(tournamentId);
    },
    adminTournamentRecordResult: (
      _: unknown,
      { pairingId, result }: { pairingId: string; result: string },
      ctx: GraphQLContextWithServices
    ) => {
      requireAdmin(ctx);
      return ctx.services.tournamentRoundService.recordResult(pairingId, result);
    },
    adminTournamentCompleteRound: (
      _: unknown,
      { roundId }: { roundId: string },
      ctx: GraphQLContextWithServices
    ) => {
      requireAdmin(ctx);
      return ctx.services.tournamentRoundService.completeRound(roundId);
    },
    adminTournamentFinalize: (
      _: unknown,
      { tournamentId }: { tournamentId: string },
      ctx: GraphQLContextWithServices
    ) => {
      requireAdmin(ctx);
      return ctx.services.tournamentRoundService.finalize(tournamentId);
    },
  },
};
