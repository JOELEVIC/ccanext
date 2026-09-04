import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import { toPublicPlayer } from "@/domains/user/publicPlayer";
import { publicPlayerSelect } from "@/domains/user/publicPlayer.select";

/**
 * Friends, and finding somebody to be one.
 *
 * ── Every player-bearing field goes through toPublicPlayer ───────────────
 *
 * Including a person's own friends. Being somebody's friend is not consent to
 * publish their name, and §4.3 answers a different question from "may I
 * invite them" — so a non-consented minor is "Brenda A." with no avatar in a
 * friend list exactly as they are on a roster.
 */

function requireUser(context: GraphQLContextWithServices) {
  if (!context.user) {
    throw new GraphQLError("Sign in to do that", {
      extensions: { code: "UNAUTHENTICATED" },
    });
  }
  return context.user;
}

/**
 * A crude per-process limiter for the one query that confirms whether an
 * address belongs to an account.
 *
 * Not a substitute for a real one — this process is serverless and the map
 * dies with the instance, so a determined caller gets a fresh budget by
 * waiting for a cold start. It is here because the alternative is nothing at
 * all, and it stops the obvious case: a script walking a contact list at
 * speed from one session.
 *
 * The proper answer is a limiter at the edge, and this comment is the note
 * saying so.
 */
const lookups = new Map<string, { count: number; windowStart: number }>();
const LOOKUP_WINDOW_MS = 60_000;
const LOOKUP_MAX = 20;

function tooManyLookups(userId: string): boolean {
  const now = Date.now();
  const seen = lookups.get(userId);
  if (!seen || now - seen.windowStart > LOOKUP_WINDOW_MS) {
    lookups.set(userId, { count: 1, windowStart: now });
    return false;
  }
  seen.count += 1;
  return seen.count > LOOKUP_MAX;
}

export const friendResolvers = {
  Query: {
    myFriends: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices,
    ) => {
      const user = requireUser(context);
      const ids = await context.services.friendService.friendsOf(user.userId);
      if (ids.length === 0) return [];
      const rows = await context.prisma.user.findMany({
        where: { id: { in: ids } },
        select: publicPlayerSelect,
      });
      const now = new Date();
      return rows.map((row) => toPublicPlayer(row, { now }));
    },

    myFriendRequests: async (
      _: unknown,
      __: unknown,
      context: GraphQLContextWithServices,
    ) => {
      const user = requireUser(context);
      const rows = await context.services.friendService.pendingFor(user.userId);
      if (rows.length === 0) return [];

      // One read for every person on both sides of every row, rather than a
      // per-row lookup in a field resolver. A pending list is small, and this
      // is the shape the roster resolvers already use.
      const ids = [...new Set(rows.flatMap((r) => [r.requesterId, r.addresseeId]))];
      const people = await context.prisma.user.findMany({
        where: { id: { in: ids } },
        select: publicPlayerSelect,
      });
      const now = new Date();
      const byId = new Map(people.map((p) => [p.id, toPublicPlayer(p, { now })]));

      return rows.map((row) => ({
        id: row.id,
        requester: byId.get(row.requesterId),
        addressee: byId.get(row.addresseeId),
        status: row.status,
        awaitingMe: row.addresseeId === user.userId,
        createdAt: row.createdAt,
        respondedAt: row.respondedAt,
      }));
    },

    findPlayer: async (
      _: unknown,
      { query }: { query: string },
      context: GraphQLContextWithServices,
    ) => {
      const user = requireUser(context);
      if (tooManyLookups(user.userId)) {
        throw new GraphQLError("Too many searches. Try again in a minute.", {
          extensions: { code: "RATE_LIMITED" },
        });
      }
      const rows = await context.services.playerLookupService.find(query, user.userId);
      const now = new Date();
      return rows.map((row) => toPublicPlayer(row, { now }));
    },

    openPool: async (
      _: unknown,
      { limit }: { limit?: number | null },
      context: GraphQLContextWithServices,
    ) => {
      const user = requireUser(context);
      const rows = await context.services.playerLookupService.openPool(
        user.userId,
        Math.min(Math.max(limit ?? 30, 1), 50),
      );
      const now = new Date();
      return rows.map((row) => toPublicPlayer(row, { now }));
    },
  },

  Mutation: {
    sendFriendRequest: async (
      _: unknown,
      { userId }: { userId: string },
      context: GraphQLContextWithServices,
    ) => {
      const user = requireUser(context);
      const row = await context.services.friendService.request(user.userId, userId);
      return hydrate(context, row, user.userId);
    },

    respondToFriendRequest: async (
      _: unknown,
      { friendshipId, accept }: { friendshipId: string; accept: boolean },
      context: GraphQLContextWithServices,
    ) => {
      const user = requireUser(context);
      const row = await context.services.friendService.respond(
        user.userId,
        friendshipId,
        accept,
      );
      return hydrate(context, row, user.userId);
    },

    removeFriend: async (
      _: unknown,
      { userId }: { userId: string },
      context: GraphQLContextWithServices,
    ) => {
      const user = requireUser(context);
      return context.services.friendService.remove(user.userId, userId);
    },

    blockPlayer: async (
      _: unknown,
      { userId }: { userId: string },
      context: GraphQLContextWithServices,
    ) => {
      const user = requireUser(context);
      await context.services.friendService.block(user.userId, userId);
      return true;
    },

    updateMySettings: async (
      _: unknown,
      {
        input,
      }: {
        input: {
          openToChallenges?: boolean | null;
          gamesPublic?: boolean | null;
          phone?: string | null;
        };
      },
      context: GraphQLContextWithServices,
    ) => {
      const user = requireUser(context);
      return context.services.playerSettingsService.update(user.userId, input);
    },
  },
};

/**
 * Turn a friendship row into the SDL shape.
 *
 * A declined request has already been deleted by the service, so the row it
 * hands back is a shape rather than a record — the two people on it are still
 * real and still reduced, which is what the client needs to draw the answer.
 */
async function hydrate(
  context: GraphQLContextWithServices,
  row: {
    id: string;
    requesterId: string;
    addresseeId: string;
    status: string;
    createdAt: Date;
    respondedAt: Date | null;
  },
  viewerId: string,
) {
  const people = await context.prisma.user.findMany({
    where: { id: { in: [row.requesterId, row.addresseeId] } },
    select: publicPlayerSelect,
  });
  const now = new Date();
  const byId = new Map(people.map((p) => [p.id, toPublicPlayer(p, { now })]));
  return {
    id: row.id,
    requester: byId.get(row.requesterId),
    addressee: byId.get(row.addresseeId),
    status: row.status,
    awaitingMe: row.addresseeId === viewerId && row.status === "PENDING",
    createdAt: row.createdAt,
    respondedAt: row.respondedAt,
  };
}
