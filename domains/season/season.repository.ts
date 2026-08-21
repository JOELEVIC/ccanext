import type { PrismaClient } from "@prisma/client";
import { SeasonStatus, ClubLevel } from "@prisma/client";
import { clubPublicSelect } from "@/domains/club/club.select";

export class SeasonRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Every ACTIVE season. Returns a LIST on purpose: exactly one may be active
   * (BUILD_PLAN §4.1) and the service enforces that rather than silently taking
   * the first of several and hiding a data fault.
   */
  activeSeasons() {
    return this.prisma.season.findMany({
      where: { status: SeasonStatus.ACTIVE },
      orderBy: { startsOn: "desc" },
    });
  }

  latestArchived() {
    return this.prisma.season.findFirst({
      where: { status: SeasonStatus.ARCHIVED },
      orderBy: { endsOn: "desc" },
    });
  }

  all() {
    return this.prisma.season.findMany({ orderBy: { startsOn: "desc" } });
  }

  findById(id: string) {
    return this.prisma.season.findUnique({ where: { id } });
  }

  findBySlug(slug: string) {
    return this.prisma.season.findUnique({ where: { slug } });
  }

  divisions(seasonId: string, level?: ClubLevel | null) {
    return this.prisma.division.findMany({
      where: { seasonId, ...(level ? { level } : {}) },
      orderBy: [{ level: "asc" }, { zone: "asc" }, { name: "asc" }],
    });
  }

  divisionById(id: string) {
    return this.prisma.division.findUnique({ where: { id } });
  }

  divisionsBySeasonIds(seasonIds: string[]) {
    return this.prisma.division.findMany({
      where: { seasonId: { in: seasonIds } },
      orderBy: [{ level: "asc" }, { zone: "asc" }, { name: "asc" }],
    });
  }

  /** Every club holding a place in the division, with its persisted row. */
  entriesForDivision(divisionId: string) {
    return this.prisma.divisionEntry.findMany({
      where: { divisionId },
      include: { club: { select: clubPublicSelect } },
    });
  }

  entriesForDivisions(divisionIds: string[]) {
    return this.prisma.divisionEntry.findMany({
      where: { divisionId: { in: divisionIds } },
      include: { club: { select: clubPublicSelect } },
    });
  }

  /**
   * Every fixture of a division, with only the board fields scoring reads.
   * `computeDivisionTable` filters to VALIDATED itself (§3.3 #2), so the whole
   * set is handed over rather than pre-filtered here — that keeps the "what
   * counts" rule in ONE place, the pure module.
   */
  fixturesForDivision(divisionId: string) {
    return this.prisma.fixture.findMany({
      where: { divisionId },
      orderBy: [{ matchDay: "asc" }, { scheduledAt: "asc" }],
      select: {
        id: true,
        status: true,
        isBye: true,
        homeClubId: true,
        awayClubId: true,
        matchDay: true,
        scheduledAt: true,
        boards: { select: { boardNumber: true, homeColor: true, result: true } },
      },
    });
  }

  fixturesForDivisions(divisionIds: string[]) {
    return this.prisma.fixture.findMany({
      where: { divisionId: { in: divisionIds } },
      orderBy: [{ matchDay: "asc" }, { scheduledAt: "asc" }],
      select: {
        id: true,
        divisionId: true,
        status: true,
        isBye: true,
        homeClubId: true,
        awayClubId: true,
        matchDay: true,
        scheduledAt: true,
        boards: { select: { boardNumber: true, homeColor: true, result: true } },
      },
    });
  }

  /** How many distinct match days of a season have at least one VALIDATED fixture. */
  async matchDaysPlayed(seasonId: string): Promise<number> {
    const rows = await this.prisma.fixture.groupBy({
      by: ["matchDay"],
      where: { seasonId, status: "VALIDATED", matchDay: { not: null } },
    });
    return rows.length;
  }

  /** Persist a recomputed table. Phase 2 / the seed call this; public reads do not. */
  async saveEntry(
    id: string,
    data: {
      played: number;
      won: number;
      drawn: number;
      lost: number;
      byes: number;
      matchPoints: number;
      boardPoints: number;
      position: number | null;
      previousPosition: number | null;
      formJson: string[];
    }
  ) {
    return this.prisma.divisionEntry.update({ where: { id }, data });
  }
}
