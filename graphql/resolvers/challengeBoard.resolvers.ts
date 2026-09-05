import type { GraphQLContextWithServices } from "@/graphql/context";
import type { SubmitChallengeResultInput } from "@/domains/challengeBoard/challengeBoard.service";

/**
 * The public board behind a shared challenge link.
 *
 * `submitChallengeResult` is the second public unauthenticated WRITE on this
 * API, after the school enquiry. Every defence — the handle rules, the
 * recomputed scenario id, the server-side replay and the IP throttle — lives
 * in `ChallengeBoardService`. The resolver's only job is to hand over the
 * caller's IP, which the service immediately hashes.
 */
export const challengeBoardResolvers = {
  Query: {
    challengeBoard: (
      _: unknown,
      args: { scenarioId: string; limit?: number | null },
      ctx: GraphQLContextWithServices,
    ) => ctx.services.challengeBoardService.board(args.scenarioId, args.limit ?? 20),
  },

  Mutation: {
    submitChallengeResult: (
      _: unknown,
      { input }: { input: SubmitChallengeResultInput },
      ctx: GraphQLContextWithServices,
    ) => ctx.services.challengeBoardService.submitResult(input, ctx.clientIp ?? null),
  },
};
