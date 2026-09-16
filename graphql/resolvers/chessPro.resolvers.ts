import { GraphQLError } from "graphql";
import type { GraphQLContextWithServices } from "@/graphql/context";
import type { Prisma } from "@prisma/client";

const TOURNAMENT_INCLUDE = {
  school: true,
  participants: { include: { user: { include: { profile: true } } } },
} as const;

function parseRadar(raw: unknown) {
  const o = raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
  return {
    sacrifice: Number(o.sacrifice ?? 0),
    endgame: Number(o.endgame ?? 0),
    positional: Number(o.positional ?? 0),
    matingAttack: Number(o.matingAttack ?? 0),
    tactics: Number(o.tactics ?? 0),
    opening: Number(o.opening ?? 0),
  };
}

export const chessProResolvers = {
  Query: {
    platformMetrics: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      const rows = await context.prisma.platformMetric.findMany({
        where: { key: { in: ["players_total", "playing_now"] } },
      });
      const map = Object.fromEntries(rows.map((r) => [r.key, r.intValue ?? 0]));
      return {
        playersTotal: map.players_total ?? 0,
        playingNow: map.playing_now ?? 0,
      };
    },

    playersLeaderboard: async (
      _: unknown,
      { limit }: { limit?: number },
      context: GraphQLContextWithServices
    ) => {
      const take = Math.min(Math.max(limit ?? 25, 1), 100);
      const users = await context.prisma.user.findMany({
        orderBy: { rating: "desc" },
        take,
        include: { profile: true },
      });
      const rows = await Promise.all(
        users.map(async (u, index) => {
          const gamesPlayed = await context.prisma.game.count({
            where: {
              status: "COMPLETED",
              OR: [{ whiteId: u.id }, { blackId: u.id }],
            },
          });
          const trendRaw = u.profile?.ratingTrendJson;
          const ratingTrend = Array.isArray(trendRaw)
            ? (trendRaw as unknown[]).map((x) => Number(x))
            : [];
          return {
            rank: index + 1,
            user: u,
            rating: u.rating,
            gamesPlayed,
            ratingTrend,
          };
        })
      );
      return rows;
    },

    ratingDistribution: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      const users = await context.prisma.user.findMany({ select: { rating: true } });
      const bucketSize = 200;
      const buckets = new Map<number, number>();
      for (const u of users) {
        const floor = Math.floor(u.rating / bucketSize) * bucketSize;
        buckets.set(floor, (buckets.get(floor) ?? 0) + 1);
      }
      return Array.from(buckets.entries())
        .sort(([a], [b]) => a - b)
        .map(([ratingMin, count]) => ({
          ratingMin,
          ratingMax: ratingMin + bucketSize - 1,
          count,
        }));
    },

    soonestTournaments: async (
      _: unknown,
      { limit }: { limit?: number },
      context: GraphQLContextWithServices
    ) => {
      const take = Math.min(Math.max(limit ?? 6, 1), 20);
      const weekAgo = new Date(Date.now() - 7 * 86400000);
      return context.prisma.tournament.findMany({
        where: {
          startDate: { gte: weekAgo },
          status: { in: ["UPCOMING", "ONGOING"] },
        },
        orderBy: { startDate: "asc" },
        take,
        include: TOURNAMENT_INCLUDE,
      });
    },

    tournamentSchedule: async (
      _: unknown,
      {
        rangeStart,
        rangeEnd,
        search,
        chessVariant,
        joinedOnly,
      }: {
        rangeStart: string;
        rangeEnd: string;
        search?: string | null;
        chessVariant?: string | null;
        joinedOnly?: boolean | null;
      },
      context: GraphQLContextWithServices
    ) => {
      const start = new Date(rangeStart);
      const end = new Date(rangeEnd);
      const and: Prisma.TournamentWhereInput[] = [
        {
          startDate: { gte: start, lte: end },
        },
      ];
      if (search?.trim()) {
        and.push({
          name: { contains: search.trim(), mode: "insensitive" },
        });
      }
      if (chessVariant?.trim()) {
        and.push({ chessVariant: chessVariant.trim() });
      }
      if (joinedOnly && context.user) {
        and.push({
          participants: { some: { userId: context.user.userId } },
        });
      }
      return context.prisma.tournament.findMany({
        where: { AND: and },
        orderBy: { startDate: "asc" },
        include: TOURNAMENT_INCLUDE,
      });
    },

    puzzleDashboard: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      const stats = await context.prisma.puzzleUserStats.findUnique({
        where: { userId: context.user.userId },
      });
      if (!stats) return null;
      return {
        periodDays: stats.periodDays,
        solvedCount: stats.solvedCount,
        performanceRating: stats.performanceRating,
        successRate: stats.successRate,
        radar: parseRadar(stats.radarSkillsJson),
      };
    },

    learnCourses: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      const uid = context.user.userId;
      const courses = await context.prisma.course.findMany({
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
        include: {
          progress: { where: { userId: uid } },
        },
      });
      return courses.map((c) => {
        const p = c.progress[0];
        return {
          id: c.id,
          slug: c.slug,
          title: c.title,
          category: c.category,
          sortOrder: c.sortOrder,
          completed: p?.completed ?? false,
          bookmarked: p?.bookmarked ?? false,
        };
      });
    },

    meTournamentStats: async (_: unknown, __: unknown, context: GraphQLContextWithServices) => {
      if (!context.user) {
        throw new GraphQLError("Not authenticated", {
          extensions: { code: "UNAUTHENTICATED" },
        });
      }
      const parts = await context.prisma.tournamentParticipant.findMany({
        where: { userId: context.user.userId },
        include: { tournament: true },
      });
      const byVariant = new Map<string, number>();
      for (const p of parts) {
        const v = p.tournament.chessVariant;
        byVariant.set(v, (byVariant.get(v) ?? 0) + 1);
      }
      return {
        totalJoined: parts.length,
        breakdown: Array.from(byVariant.entries()).map(([variant, count]) => ({
          variant,
          count,
        })),
      };
    },
  },
};
