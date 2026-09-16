import type { GraphQLContextWithServices } from "@/graphql/context";
import { markSelfDisclosed } from "@/domains/user/identityVisibility";

/**
 * The game server's two operations. Both check the secret before anything
 * else; neither reads the viewer — there is no signed-in person on the other
 * end, only a process.
 */
export const houseBotResolvers = {
  Query: {
    houseBotPoll: async (_: unknown, { secret }: { secret: string }, context: GraphQLContextWithServices) => {
      context.services.houseBotService.assertSecret(secret);
      return context.services.houseBotService.poll();
    },
  },

  Mutation: {
    houseBotSession: async (
      _: unknown,
      { userId, secret }: { userId: string; secret: string },
      context: GraphQLContextWithServices
    ) => {
      context.services.houseBotService.assertSecret(secret);
      const { token, user } = await context.services.houseBotService.session(userId);
      return { token, user: markSelfDisclosed(user) };
    },
  },
};
