import type { PrismaClient, Prisma } from "@prisma/client";
import { Competition, FixtureStatus } from "@prisma/client";
import { clubPublicSelect } from "@/domains/club/club.select";
import { publicPlayerSelect } from "@/domains/user/publicPlayer.select";

/**
 * The public projection of a fixture.
 *
 * Clubs come through `clubPublicSelect`, so `joinCode` is never read. Players
 * come through `publicPlayerSelect` and are reduced by `toPublicPlayer()` in the
 * service before they reach a resolver — a fixture board is one of the four
 * name-bearing public surfaces named in BUILD_PLAN §4.3.
 */
export const fixturePublicSelect = {
  id: true,
  seasonId: true,
  divisionId: true,
  competition: true,
  stage: true,
  matchDay: true,
  homeClubId: true,
  awayClubId: true,
  homeSourceLabel: true,
  awaySourceLabel: true,
  isBye: true,
  scheduledAt: true,
  venue: true,
  boardCount: true,
  status: true,
  homeScore: true,
  awayScore: true,
  validatedAt: true,
  createdAt: true,
  updatedAt: true,
  season: true,
  division: true,
  homeClub: { select: clubPublicSelect },
  awayClub: { select: clubPublicSelect },
  boards: {
    orderBy: { boardNumber: "asc" as const },
    select: {
      id: true,
      boardNumber: true,
      homeColor: true,
      source: true,
      gameId: true,
      result: true,
      scoresheetUrl: true,
      moveCount: true,
      recordedAt: true,
      homeUser: { select: publicPlayerSelect },
      awayUser: { select: publicPlayerSelect },
    },
  },
  events: { orderBy: { occurredAt: "asc" as const } },
} satisfies Prisma.FixtureSelect;

export type FixturePublicRow = Prisma.FixtureGetPayload<{ select: typeof fixturePublicSelect }>;

export type FixtureOrder = "SCHEDULED_ASC" | "SCHEDULED_DESC";

export interface FixtureListFilters {
  seasonId: string;
  clubId?: string | null;
  divisionId?: string | null;
  competition?: Competition | null;
  status?: FixtureStatus | null;
  from?: Date | null;
  to?: Date | null;
  orderBy: FixtureOrder;
  limit: number;
}

export class FixtureRepository {
  constructor(private prisma: PrismaClient) {}

  list(filters: FixtureListFilters) {
    const where: Prisma.FixtureWhereInput = {
      seasonId: filters.seasonId,
      ...(filters.divisionId ? { divisionId: filters.divisionId } : {}),
      ...(filters.competition ? { competition: filters.competition } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      // A club's fixture list is home OR away — a bye is a home fixture with no
      // away club, so it lands here too, which is what the club page wants.
      ...(filters.clubId
        ? { OR: [{ homeClubId: filters.clubId }, { awayClubId: filters.clubId }] }
        : {}),
      ...(filters.from || filters.to
        ? {
            scheduledAt: {
              ...(filters.from ? { gte: filters.from } : {}),
              ...(filters.to ? { lte: filters.to } : {}),
            },
          }
        : {}),
    };

    return this.prisma.fixture.findMany({
      where,
      select: fixturePublicSelect,
      orderBy: [
        { scheduledAt: filters.orderBy === "SCHEDULED_DESC" ? "desc" : "asc" },
        { id: "asc" },
      ],
      take: filters.limit,
    });
  }

  findById(id: string) {
    return this.prisma.fixture.findUnique({ where: { id }, select: fixturePublicSelect });
  }

  events(fixtureId: string) {
    return this.prisma.fixtureEvent.findMany({
      where: { fixtureId },
      orderBy: { occurredAt: "asc" },
    });
  }

  live(limit: number) {
    return this.prisma.fixture.findMany({
      where: { status: FixtureStatus.LIVE },
      select: fixturePublicSelect,
      orderBy: [{ scheduledAt: "asc" }],
      take: limit,
    });
  }

  /**
   * The cup bracket, placeholder ties included. A tie whose feeding ties have
   * not resolved has NULL club ids and renders `homeSourceLabel` /
   * `awaySourceLabel` instead — those rows are real and must not be filtered
   * out. Postgres orders an enum by its declaration order, so ordering by
   * `stage` gives R32 → R16 → QF → SF → FINAL for free.
   */
  cupBracket(seasonId: string) {
    return this.prisma.fixture.findMany({
      where: { seasonId, competition: Competition.CUP },
      select: fixturePublicSelect,
      orderBy: [{ stage: "asc" }, { scheduledAt: "asc" }, { id: "asc" }],
    });
  }

  /**
   * Every scored board of every VALIDATED fixture in the season — the raw
   * material for `playerStandings` (BUILD_PLAN §6: "computed from VALIDATED
   * fixture boards in the season"). Ratings and career ledgers read
   * FixtureBoard, never Game, so a moveless OTB board still counts.
   *
   * The linked game (when there is one) carries the rating snapshot taken when
   * it was created; that is the only season-start rating this schema records.
   */
  validatedBoardsForSeason(seasonId: string) {
    return this.prisma.fixtureBoard.findMany({
      where: {
        result: { not: null },
        fixture: { seasonId, status: FixtureStatus.VALIDATED },
      },
      select: {
        homeUserId: true,
        awayUserId: true,
        homeColor: true,
        result: true,
        fixture: { select: { scheduledAt: true } },
        game: { select: { whiteId: true, whiteRating: true, blackRating: true } },
      },
      orderBy: { fixture: { scheduledAt: "asc" } },
    });
  }

  usersByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.user.findMany({ where: { id: { in: ids } }, select: publicPlayerSelect });
  }
}
