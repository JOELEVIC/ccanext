import type { PrismaClient, ClubLevel, Competition, FixtureStatus } from "@prisma/client";
import {
  FixtureRepository,
  type FixtureOrder,
  type FixturePublicRow,
} from "./fixture.repository";
import { fixtureBoardPoints, boardWinner, type ScoringBoard } from "./scoring";
import { ClubRepository, PUBLIC_CLUB_STATUSES } from "@/domains/club/club.repository";
import { toPublicClubOrNull, clubPublicSelect, type PublicClub } from "@/domains/club/club.select";
import { SeasonService } from "@/domains/season/season.service";
import { toPublicPlayer, type PublicPlayer } from "@/domains/user/publicPlayer";
import type { PublicPlayerRow } from "@/domains/user/publicPlayer.select";
import { normalizeRegion } from "@/domains/region/regions";

const DEFAULT_FIXTURE_LIMIT = 50;
const MAX_FIXTURE_LIMIT = 200;
const DEFAULT_STANDINGS_LIMIT = 50;
const MAX_STANDINGS_LIMIT = 200;

export interface PublicFixtureBoard {
  id: string;
  boardNumber: number;
  homeColor: string;
  source: string;
  gameId: string | null;
  result: string | null;
  scoresheetUrl: string | null;
  moveCount: number | null;
  recordedAt: Date | null;
  /** Consent-reduced (BUILD_PLAN §4.3). Null when no player is on the sheet yet. */
  homePlayer: PublicPlayer | null;
  awayPlayer: PublicPlayer | null;
}

export interface PublicFixture {
  id: string;
  seasonId: string;
  divisionId: string | null;
  competition: Competition;
  stage: string | null;
  matchDay: number | null;
  homeSourceLabel: string | null;
  awaySourceLabel: string | null;
  isBye: boolean;
  scheduledAt: Date;
  venue: string | null;
  boardCount: number;
  status: FixtureStatus;
  homeScore: number;
  awayScore: number;
  validatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  season: FixturePublicRow["season"];
  division: FixturePublicRow["division"];
  homeClub: PublicClub | null;
  awayClub: PublicClub | null;
  boards: PublicFixtureBoard[];
  events: FixturePublicRow["events"];
}

export interface PlayerStanding {
  rank: number;
  player: PublicPlayer;
  rating: number;
  ratingDelta: number;
  officialGames: number;
  wins: number;
  draws: number;
  losses: number;
}

export interface SchoolStanding {
  rank: number;
  school: unknown;
  clubCount: number;
  memberCount: number;
  matchPoints: number;
}

interface PlayerTally {
  userId: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  /** The player's rating snapshot at their first scored board of the season. */
  firstRating: number | null;
}

export class FixtureService {
  private repo: FixtureRepository;
  private clubs: ClubRepository;
  private seasons: SeasonService;

  constructor(private prisma: PrismaClient) {
    this.repo = new FixtureRepository(prisma);
    this.clubs = new ClubRepository(prisma);
    this.seasons = new SeasonService(prisma);
  }

  // ── Mapping ────────────────────────────────────────────────────────────────

  /**
   * INVARIANT §3.3 #1: "Fixture score is derived, never entered." The persisted
   * `homeScore`/`awayScore` columns are a cache written by the Phase 2 result
   * path; what the public sees is recomputed here from the boards by the same
   * pure module the scoring tests cover, so the score on the page can never
   * disagree with the boards printed beneath it.
   */
  private toPublicFixture(row: FixturePublicRow, now: Date): PublicFixture {
    const scoringBoards: ScoringBoard[] = row.boards.map((b) => ({
      boardNumber: b.boardNumber,
      homeColor: b.homeColor,
      result: b.result,
    }));
    const points = fixtureBoardPoints(scoringBoards);

    return {
      id: row.id,
      seasonId: row.seasonId,
      divisionId: row.divisionId,
      competition: row.competition,
      stage: row.stage,
      matchDay: row.matchDay,
      homeSourceLabel: row.homeSourceLabel,
      awaySourceLabel: row.awaySourceLabel,
      isBye: row.isBye,
      scheduledAt: row.scheduledAt,
      venue: row.venue,
      boardCount: row.boardCount,
      status: row.status,
      homeScore: points.home,
      awayScore: points.away,
      validatedAt: row.validatedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      season: row.season,
      division: row.division,
      homeClub: toPublicClubOrNull(row.homeClub),
      awayClub: toPublicClubOrNull(row.awayClub),
      boards: row.boards.map((b) => ({
        id: b.id,
        boardNumber: b.boardNumber,
        homeColor: b.homeColor,
        source: b.source,
        gameId: b.gameId,
        result: b.result,
        scoresheetUrl: b.scoresheetUrl,
        moveCount: b.moveCount,
        recordedAt: b.recordedAt,
        homePlayer: b.homeUser ? toPublicPlayer(b.homeUser, { now }) : null,
        awayPlayer: b.awayUser ? toPublicPlayer(b.awayUser, { now }) : null,
      })),
      events: row.events,
    };
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  async listFixtures(args: {
    seasonId: string;
    clubId?: string | null;
    divisionId?: string | null;
    competition?: Competition | null;
    status?: FixtureStatus | null;
    from?: Date | null;
    to?: Date | null;
    orderBy?: FixtureOrder | null;
    limit?: number | null;
  }): Promise<PublicFixture[]> {
    const rows = await this.repo.list({
      seasonId: args.seasonId,
      clubId: args.clubId ?? null,
      divisionId: args.divisionId ?? null,
      competition: args.competition ?? null,
      status: args.status ?? null,
      from: args.from ?? null,
      to: args.to ?? null,
      orderBy: args.orderBy ?? "SCHEDULED_ASC",
      limit: Math.min(Math.max(args.limit ?? DEFAULT_FIXTURE_LIMIT, 1), MAX_FIXTURE_LIMIT),
    });
    const now = new Date();
    return rows.map((r) => this.toPublicFixture(r, now));
  }

  async getFixture(id: string): Promise<PublicFixture | null> {
    const row = await this.repo.findById(id);
    return row ? this.toPublicFixture(row, new Date()) : null;
  }

  getFixtureEvents(fixtureId: string) {
    return this.repo.events(fixtureId);
  }

  async getLiveFixtures(): Promise<PublicFixture[]> {
    const rows = await this.repo.live(MAX_FIXTURE_LIMIT);
    const now = new Date();
    return rows.map((r) => this.toPublicFixture(r, now));
  }

  async getCupBracket(seasonId: string): Promise<PublicFixture[]> {
    const rows = await this.repo.cupBracket(seasonId);
    const now = new Date();
    return rows.map((r) => this.toPublicFixture(r, now));
  }

  // ── Player standings ───────────────────────────────────────────────────────

  /**
   * BUILD_PLAN §6: "computed from VALIDATED fixture boards in the season (games,
   * W/D/L, rating delta) joined to the player's active membership for `region`
   * and `level`, ordered by current rating. It does not need a season column on
   * `Game`."
   *
   * `ratingDelta` is "movement across the season". Nothing in this schema stores
   * a per-season starting rating, so it is derived from the rating SNAPSHOT the
   * linked `Game` recorded when the player's first scored board of the season
   * was created (`whiteRating` / `blackRating`). A player whose season is all
   * over-the-board — no `Game` row, therefore no snapshot — gets 0 rather than a
   * fabricated number.
   *
   * §4.2: a player with no ACTIVE membership has no club, region or level, so a
   * region- or level-filtered table excludes them; the unfiltered national table
   * still lists them.
   */
  async getPlayerStandings(args: {
    seasonId: string;
    region?: string | null;
    level?: ClubLevel | null;
    limit?: number | null;
  }): Promise<PlayerStanding[]> {
    const limit = Math.min(
      Math.max(args.limit ?? DEFAULT_STANDINGS_LIMIT, 1),
      MAX_STANDINGS_LIMIT
    );
    const region = args.region ? normalizeRegion(args.region) : null;

    const boards = await this.repo.validatedBoardsForSeason(args.seasonId);
    const tallies = new Map<string, PlayerTally>();

    const bump = (userId: string, outcome: "W" | "D" | "L", snapshot: number | null) => {
      let t = tallies.get(userId);
      if (!t) {
        t = { userId, games: 0, wins: 0, draws: 0, losses: 0, firstRating: null };
        tallies.set(userId, t);
      }
      t.games += 1;
      if (outcome === "W") t.wins += 1;
      else if (outcome === "D") t.draws += 1;
      else t.losses += 1;
      // Boards arrive oldest-first, so the first snapshot seen is the earliest.
      if (t.firstRating === null && snapshot !== null) t.firstRating = snapshot;
    };

    for (const b of boards) {
      const winner = boardWinner({ homeColor: b.homeColor, result: b.result });
      if (winner === null) continue;

      if (b.homeUserId) {
        const snapshot = b.game
          ? b.game.whiteId === b.homeUserId
            ? b.game.whiteRating
            : b.game.blackRating
          : null;
        bump(
          b.homeUserId,
          winner === "DRAW" ? "D" : winner === "HOME" ? "W" : "L",
          snapshot ?? null
        );
      }
      if (b.awayUserId) {
        const snapshot = b.game
          ? b.game.whiteId === b.awayUserId
            ? b.game.whiteRating
            : b.game.blackRating
          : null;
        bump(
          b.awayUserId,
          winner === "DRAW" ? "D" : winner === "AWAY" ? "W" : "L",
          snapshot ?? null
        );
      }
    }

    if (tallies.size === 0) return [];

    const users = await this.repo.usersByIds([...tallies.keys()]);
    const now = new Date();

    const rows = users.flatMap((user: PublicPlayerRow) => {
      const membership = user.memberships[0] ?? null;
      const club = membership?.club ?? null;
      if (region && normalizeRegion(club?.region ?? null) !== region) return [];
      if (args.level && club?.level !== args.level) return [];

      const tally = tallies.get(user.id);
      if (!tally) return [];
      const rating = Math.round(user.rating ?? 0);

      return [
        {
          player: toPublicPlayer(user, { now }),
          rating,
          ratingDelta: tally.firstRating === null ? 0 : rating - Math.round(tally.firstRating),
          officialGames: tally.games,
          wins: tally.wins,
          draws: tally.draws,
          losses: tally.losses,
        },
      ];
    });

    rows.sort(
      (a, b) =>
        b.rating - a.rating ||
        b.officialGames - a.officialGames ||
        b.wins - a.wins ||
        a.player.displayName.localeCompare(b.player.displayName, "en")
    );

    return rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }));
  }

  // ── School standings ───────────────────────────────────────────────────────

  /**
   * Schools ranked by match points summed across their clubs (BUILD_PLAN §6).
   * The match points come from the derived division tables, so a school's total
   * is the same arithmetic the club tables show — there is no second ledger.
   *
   * The `region` filter reads the CLUB's region, not `schools.region`: club
   * regions are canonical keys from day one, while the legacy `schools.region`
   * column is free text this migration deliberately does not rewrite.
   */
  async getSchoolStandings(args: {
    seasonId: string;
    region?: string | null;
    limit?: number | null;
  }): Promise<SchoolStanding[]> {
    const limit = Math.min(
      Math.max(args.limit ?? DEFAULT_STANDINGS_LIMIT, 1),
      MAX_STANDINGS_LIMIT
    );
    const region = args.region ? normalizeRegion(args.region) : null;

    const tables = await this.seasons.getSeasonTables(args.seasonId);
    const matchPointsByClub = new Map<string, number>();
    for (const rows of tables.values()) {
      for (const row of rows) {
        matchPointsByClub.set(
          row.clubId,
          (matchPointsByClub.get(row.clubId) ?? 0) + row.matchPoints
        );
      }
    }

    const clubs = await this.prisma.club.findMany({
      where: {
        status: { in: PUBLIC_CLUB_STATUSES },
        ...(region ? { region } : {}),
      },
      select: { id: true, schoolId: true, school: clubPublicSelect.school },
    });
    if (clubs.length === 0) return [];

    const memberCounts = await this.clubs.memberCounts(clubs.map((c) => c.id));

    const bySchool = new Map<
      string,
      { school: (typeof clubs)[number]["school"]; clubCount: number; memberCount: number; matchPoints: number }
    >();
    for (const club of clubs) {
      const entry = bySchool.get(club.schoolId) ?? {
        school: club.school,
        clubCount: 0,
        memberCount: 0,
        matchPoints: 0,
      };
      entry.clubCount += 1;
      entry.memberCount += memberCounts.get(club.id) ?? 0;
      entry.matchPoints += matchPointsByClub.get(club.id) ?? 0;
      bySchool.set(club.schoolId, entry);
    }

    const rows = [...bySchool.values()].sort(
      (a, b) =>
        b.matchPoints - a.matchPoints ||
        b.memberCount - a.memberCount ||
        a.school.name.localeCompare(b.school.name, "en")
    );

    return rows.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r }));
  }
}
