import type { PrismaClient, Prisma } from "@prisma/client";
import { ClubStatus, MembershipStatus, ClubLevel } from "@prisma/client";
import { clubPublicSelect } from "./club.select";
import { publicPlayerSelect } from "@/domains/user/publicPlayer.select";

/**
 * A club is publicly visible unless it has been ARCHIVED. ONBOARDING clubs are
 * visible on purpose: a school that has signed but not yet played is exactly
 * what the "signed schools" credibility surface is for. DORMANT clubs stay
 * listed so their record and honours do not vanish mid-season.
 */
export const PUBLIC_CLUB_STATUSES: ClubStatus[] = [
  ClubStatus.ONBOARDING,
  ClubStatus.ACTIVE,
  ClubStatus.DORMANT,
];

export interface ClubListFilters {
  region?: string | null;
  level?: ClubLevel | null;
  search?: string | null;
  limit: number;
  offset: number;
}

function publicWhere(filters: Partial<ClubListFilters> = {}): Prisma.ClubWhereInput {
  const search = filters.search?.trim();
  return {
    status: { in: PUBLIC_CLUB_STATUSES },
    ...(filters.region ? { region: filters.region } : {}),
    // `level` is the HOST INSTITUTION's education stage, so filtering by it
    // means "clubs hosted at a university" — which is what it has always meant
    // and is only answerable for a club that has a host. An independent club
    // carries a stored SECONDARY that means nothing; without this it would
    // surface under "secondary schools", which is exactly wrong.
    ...(filters.level ? { level: filters.level, schoolId: { not: null } } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { slug: { contains: search, mode: "insensitive" as const } },
            { shortName: { contains: search, mode: "insensitive" as const } },
            { school: { name: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

export class ClubRepository {
  constructor(private prisma: PrismaClient) {}

  list(filters: ClubListFilters) {
    const where = publicWhere(filters);
    return Promise.all([
      this.prisma.club.findMany({
        where,
        select: clubPublicSelect,
        orderBy: [{ name: "asc" }],
        take: filters.limit,
        skip: filters.offset,
      }),
      this.prisma.club.count({ where }),
    ]);
  }

  findBySlug(slug: string) {
    return this.prisma.club.findFirst({
      where: { slug, status: { in: PUBLIC_CLUB_STATUSES } },
      select: {
        ...clubPublicSelect,
        honours: {
          orderBy: { awardedOn: "desc" as const },
          select: {
            id: true,
            title: true,
            kind: true,
            awardedOn: true,
            season: { select: { id: true, slug: true, name: true } },
          },
        },
      },
    });
  }

  /** Just the id, for the roster and standing lookups. */
  idBySlug(slug: string) {
    return this.prisma.club.findFirst({
      where: { slug, status: { in: PUBLIC_CLUB_STATUSES } },
      select: { id: true },
    });
  }

  /**
   * The join flow (P1-8). Looks a club UP by its secret code and returns the
   * code-free public projection — the code goes in, it never comes back out.
   */
  findByJoinCode(code: string) {
    return this.prisma.club.findFirst({
      where: { joinCode: code, status: { in: PUBLIC_CLUB_STATUSES } },
      select: clubPublicSelect,
    });
  }

  /**
   * The roster. `teamOnly` means the A team: a board order has been assigned.
   * Only ACTIVE memberships — PENDING joiners are not yet a public fact about
   * the club, and LEFT/REMOVED ones are history.
   */
  roster(clubId: string, teamOnly: boolean) {
    return this.prisma.clubMembership.findMany({
      where: {
        clubId,
        status: MembershipStatus.ACTIVE,
        ...(teamOnly ? { boardOrder: { not: null } } : {}),
      },
      orderBy: [{ boardOrder: "asc" }, { joinedAt: "asc" }],
      select: {
        schoolYear: true,
        boardOrder: true,
        role: true,
        user: { select: publicPlayerSelect },
        club: { select: { slug: true, name: true, shortName: true, crestJson: true } },
      },
    });
  }

  /** ACTIVE member counts for a set of clubs, in one query (no N+1). */
  async memberCounts(clubIds: string[]): Promise<Map<string, number>> {
    if (clubIds.length === 0) return new Map();
    const rows = await this.prisma.clubMembership.groupBy({
      by: ["clubId"],
      where: { clubId: { in: clubIds }, status: MembershipStatus.ACTIVE },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.clubId, r._count._all]));
  }

  countVisible() {
    return this.prisma.club.count({ where: publicWhere() });
  }

  /** Every ACTIVE membership, counted once. One active membership per user (§2). */
  countActiveMembers() {
    return this.prisma.clubMembership.count({
      where: { status: MembershipStatus.ACTIVE, club: publicWhere() },
    });
  }

  /** Club counts per region key — only regions that actually have clubs. */
  async clubsPerRegion(): Promise<Map<string, number>> {
    const rows = await this.prisma.club.groupBy({
      by: ["region"],
      where: publicWhere(),
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.region, r._count._all]));
  }

  /** The club's division entry in a season, with its division. */
  entryForClubInSeason(clubId: string, seasonId: string) {
    return this.prisma.divisionEntry.findFirst({
      where: { clubId, division: { seasonId } },
      include: { division: true },
    });
  }
}
