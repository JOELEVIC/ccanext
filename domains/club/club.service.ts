import type { PrismaClient, ClubLevel } from "@prisma/client";
import { ClubRepository } from "./club.repository";
import { toPublicClub, toPublicClubOrNull, type PublicClub } from "./club.select";
import { SeasonService, type PublicDivisionEntry } from "@/domains/season/season.service";
import { toPublicPlayer, type PublicPlayer, type Crest } from "@/domains/user/publicPlayer";
import { parseCrest } from "@/domains/user/publicPlayer";
import { REGION_KEYS, REGION_OPENS_IN, normalizeRegion } from "@/domains/region/regions";

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
  async memberCount(clubId: string): Promise<number> {
    const counts = await this.repo.memberCounts([clubId]);
    return counts.get(clubId) ?? 0;
  }

  toPublicClubOrNull = toPublicClubOrNull;
}
