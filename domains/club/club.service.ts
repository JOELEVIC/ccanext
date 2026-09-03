import type { PrismaClient, ClubLevel } from "@prisma/client";
import { ClubRepository } from "./club.repository";
import { toPublicClub, toPublicClubOrNull, type PublicClub } from "./club.select";
import { SeasonService, type PublicDivisionEntry } from "@/domains/season/season.service";
import { toPublicPlayer, type PublicPlayer, type Crest } from "@/domains/user/publicPlayer";
import { parseCrest } from "@/domains/user/publicPlayer";
import { REGION_KEYS, REGION_OPENS_IN, normalizeRegion } from "@/domains/region/regions";
import { decideJoin, type HeldMembership } from "./joinByCode";
import { ValidationError } from "@/utils/types";

export interface ClubConnection {
  nodes: PublicClub[];
  totalCount: number;
  hasMore: boolean;
}

/** The join flow's confirmation card: name + crest only (BUILD_PLAN §6). */
export interface ClubSummary {
  slug: string;
  name: string;
  shortName: string;
  crest: Crest | null;
}

export interface RegionCount {
  region: string;
  clubCount: number;
  opensIn: number | null;
}

export interface NetworkSummary {
  clubCount: number;
  playerCount: number;
  activeRegionCount: number;
  matchDaysPlayed: number;
  matchDaysTotal: number;
  clubsByRegion: RegionCount[];
}

const MAX_PAGE = 60;

export class ClubService {
  private repo: ClubRepository;
  private seasons: SeasonService;

  constructor(private prisma: PrismaClient) {
    this.repo = new ClubRepository(prisma);
    this.seasons = new SeasonService(prisma);
  }

  // ── Directory ──────────────────────────────────────────────────────────────

  async listClubs(args: {
    region?: string | null;
    level?: ClubLevel | null;
    search?: string | null;
    limit?: number | null;
    offset?: number | null;
  }): Promise<ClubConnection> {
    const limit = Math.min(Math.max(args.limit ?? 24, 1), MAX_PAGE);
    const offset = Math.max(args.offset ?? 0, 0);
    // A client may still send legacy French free text; canonicalise it rather
    // than returning a confusing empty list (domains/region/regions.ts).
    const region = args.region ? normalizeRegion(args.region) : null;

    const [rows, totalCount] = await this.repo.list({
      region,
      level: args.level ?? null,
      search: args.search ?? null,
      limit,
      offset,
    });
    const counts = await this.repo.memberCounts(rows.map((r) => r.id));

    return {
      nodes: rows.map((r) => toPublicClub(r, counts.get(r.id) ?? 0)),
      totalCount,
      hasMore: offset + rows.length < totalCount,
    };
  }

  /** Never returns `joinCode` — the column is not even selected (club.select.ts). */
  async getClubBySlug(slug: string): Promise<(PublicClub & { honours: unknown[] }) | null> {
    const row = await this.repo.findBySlug(slug);
    if (!row) return null;
    const { honours, ...club } = row;
    const counts = await this.repo.memberCounts([club.id]);
    return { ...toPublicClub(club, counts.get(club.id) ?? 0), honours };
  }

  async getClubByJoinCode(code: string): Promise<ClubSummary | null> {
    const trimmed = code?.trim();
    if (!trimmed) return null;
    const row = await this.repo.findByJoinCode(trimmed);
    if (!row) return null;
    return {
      slug: row.slug,
      name: row.name,
      shortName: row.shortName,
      crest: parseCrest(row.crestJson),
    };
  }

  // ── Roster ─────────────────────────────────────────────────────────────────

  /**
   * CONSENT-GATED. Every row goes through `toPublicPlayer()` (BUILD_PLAN §4.3),
   * so a minor without granted consent reaches the client as "Brenda A." with
   * no avatar. `ccaweb` must render what it is given and never re-derive a name.
   */
  async getRoster(slug: string, teamOnly: boolean): Promise<PublicPlayer[]> {
    // An unknown slug yields an empty roster rather than an error. A club page
    // issues club / clubRoster / clubStanding together: `club` already returns
    // null for a bad slug, and throwing here would turn a 404 page into a 500.
    const club = await this.repo.idBySlug(slug);
    if (!club) return [];
    const rows = await this.repo.roster(club.id, teamOnly);
    const now = new Date();
    return rows.map((row) =>
      toPublicPlayer(
        {
          ...row.user,
          // The membership being listed is the authority for this club's roster,
          // not whichever membership happens to be first on the user record.
          membership: {
            schoolYear: row.schoolYear,
            boardOrder: row.boardOrder,
            club: row.club,
          },
        },
        { now }
      )
    );
  }

  // ── Standing ───────────────────────────────────────────────────────────────

  async getClubStanding(slug: string): Promise<PublicDivisionEntry | null> {
    const club = await this.repo.idBySlug(slug);
    if (!club) return null;
    const season = await this.seasons.getCurrentSeason();
    if (!season) return null;
    return this.seasons.getClubStanding(club.id, season.id);
  }

  // ── Network summary ────────────────────────────────────────────────────────

  /**
   * The home page's stat strip and region tile map (T1.3). `clubsByRegion`
   * returns EVERY canonical region including the zeros — the map has ten tiles
   * whether or not a region has signed a school yet, and a region with none
   * carries the editorial `opensIn` year from domains/region/regions.ts.
   */
  async getNetworkSummary(): Promise<NetworkSummary> {
    const [clubCount, playerCount, perRegionRaw, season] = await Promise.all([
      this.repo.countVisible(),
      this.repo.countActiveMembers(),
      this.repo.clubsPerRegion(),
      this.seasons.getCurrentSeason(),
    ]);

    // Fold any legacy / mis-cased region value onto its canonical key so the
    // map's ten tiles always add up to the club count.
    const perRegion = new Map<string, number>();
    for (const [raw, count] of perRegionRaw) {
      const key = normalizeRegion(raw);
      if (!key) continue;
      perRegion.set(key, (perRegion.get(key) ?? 0) + count);
    }

    const clubsByRegion: RegionCount[] = REGION_KEYS.map((region) => {
      const count = perRegion.get(region) ?? 0;
      return {
        region,
        clubCount: count,
        opensIn: count === 0 ? REGION_OPENS_IN[region] : null,
      };
    });

    const progress = await this.seasons.getMatchDayProgress(season?.id ?? null);

    return {
      clubCount,
      playerCount,
      activeRegionCount: clubsByRegion.filter((r) => r.clubCount > 0).length,
      matchDaysPlayed: progress.played,
      matchDaysTotal: progress.total,
      clubsByRegion,
    };
  }

  /** Used by the `Club.memberCount` field resolver when the parent lacks one. */
  // ── The member's own view — PLATFORM_ROADMAP 4.2 ──────────────────────────

  /**
   * Every club the caller belongs to, from their own point of view.
   *
   * Deliberately **not** filtered to `ACTIVE`. A student who has entered a
   * join code is `PENDING` until a patron admits them, and that is precisely
   * the person with the most urgent question — "did it work?". Hiding pending
   * memberships would leave them looking at an empty screen after doing the
   * one thing the join flow asked of them.
   *
   * `LEFT` and `REMOVED` are excluded: they are history, and a club you are no
   * longer in is not "my club".
   *
   * This is the caller's own row, so there is no consent question to answer —
   * `boardOrder` and `schoolYear` are facts about the person asking. Everything
   * about *other* members on the screens this feeds comes from `clubRoster`,
   * which is the public, already-reduced path (BUILD_PLAN §4.3).
   */
  async myMemberships(userId: string) {
    const rows = await this.prisma.clubMembership.findMany({
      where: { userId, status: { in: ["PENDING", "ACTIVE"] } },
      orderBy: [{ status: "asc" }, { joinedAt: "asc" }],
      select: {
        id: true,
        role: true,
        status: true,
        schoolYear: true,
        boardOrder: true,
        joinedAt: true,
        club: {
          select: {
            id: true, slug: true, name: true, shortName: true,
            region: true, level: true, status: true, crestJson: true,
            school: { select: { name: true } },
            _count: { select: { memberships: { where: { status: "ACTIVE" } } } },
          },
        },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      role: row.role,
      status: row.status,
      schoolYear: row.schoolYear,
      boardOrder: row.boardOrder,
      joinedAt: row.joinedAt,
      club: {
        id: row.club.id,
        slug: row.club.slug,
        name: row.club.name,
        shortName: row.club.shortName,
        region: row.club.region,
        level: row.club.level,
        status: row.club.status,
        crest: parseCrest(row.club.crestJson),
        schoolName: row.club.school?.name ?? null,
        memberCount: row.club._count.memberships,
      },
    }));
  }

  /**
   * Spend a join code on an account that already exists.
   *
   * The counterpart to `RegisterInput.joinCode`, which is the only place a code
   * could be spent before this: that one covers the student who arrives holding
   * the code, and left everybody else — the person who installed the app before
   * their school signed up, the student whose club started this term — with an
   * account and no way to attach it to a club.
   *
   * The decision itself is `decideJoin`, which is pure and tested. This method
   * is the part that talks to Postgres.
   *
   * ── Never a second request ───────────────────────────────────────────────
   *
   * Every path here updates or returns the single row unique on (club, user).
   * A student who taps twice, or reinstalls and tries again, does not reach a
   * patron as a stranger asking again — which is exactly what the pending
   * screen already promises them.
   *
   * ── PENDING, always ──────────────────────────────────────────────────────
   *
   * Holding a code proves which club, not that a patron has admitted you. This
   * mutation can no more make somebody a member than the registration path can.
   */
  async joinByCode(userId: string, rawCode: string) {
    const joinCode = rawCode.trim().toUpperCase();
    if (!joinCode) throw new ValidationError("Enter your club's join code.");

    // The same lookup the registration path makes, and the same refusal, so a
    // mistyped code reads identically whichever door it was typed at.
    const club = await this.prisma.club.findFirst({
      where: { joinCode, status: { not: "ARCHIVED" } },
      select: { id: true, schoolId: true },
    });
    if (!club) throw new ValidationError("That club code is not recognised.");

    const rows = await this.prisma.clubMembership.findMany({
      where: { userId },
      select: {
        id: true,
        clubId: true,
        status: true,
        club: { select: { name: true } },
      },
    });
    const held: HeldMembership[] = rows.map((row) => ({
      clubId: row.clubId,
      status: row.status,
      clubName: row.club.name,
    }));

    const outcome = decideJoin(club.id, held);

    switch (outcome.kind) {
      case "refuse":
        throw new ValidationError(
          outcome.reason === "active-elsewhere"
            ? `You are already a member of ${outcome.clubName}. Leave that club before joining another.`
            : `You have already asked to join ${outcome.clubName}. Wait for that patron to answer.`,
        );

      case "already":
        break;

      case "create":
        await this.prisma.clubMembership.create({
          data: { clubId: club.id, userId, role: "PLAYER", status: "PENDING" },
        });
        break;

      case "revive":
        await this.prisma.clubMembership.update({
          where: { clubId_userId: { clubId: club.id, userId } },
          // `leftAt` is cleared: it dates a departure, and this person has not
          // departed anything — they are asking to come back.
          data: { status: "PENDING", leftAt: null, joinedAt: new Date() },
        });
        break;
    }

    // `User.schoolId` is legacy but must stay in sync with club affiliation
    // (BUILD_PLAN §2). Filled only when the account carries none: an account
    // that already names a school is not corrected by a club code, and an
    // independent club has no school to copy.
    if (club.schoolId) {
      await this.prisma.user.updateMany({
        where: { id: userId, schoolId: null },
        data: { schoolId: club.schoolId },
      });
    }

    const mine = await this.myMemberships(userId);
    const membership = mine.find((row) => row.club.id === club.id);
    if (!membership) {
      // Unreachable: every branch above leaves a PENDING or ACTIVE row, and
      // `myMemberships` returns both. Thrown rather than returned as null so a
      // future edit that breaks the invariant fails loudly.
      throw new ValidationError("The membership could not be read back.");
    }
    return membership;
  }

  async memberCount(clubId: string): Promise<number> {
    const counts = await this.repo.memberCounts([clubId]);
    return counts.get(clubId) ?? 0;
  }

  toPublicClubOrNull = toPublicClubOrNull;
}
