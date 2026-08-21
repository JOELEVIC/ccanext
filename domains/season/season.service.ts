import type { PrismaClient, ClubLevel, Division } from "@prisma/client";
import { SeasonRepository } from "./season.repository";
import {
  computeDivisionTable,
  positionMovement,
  type ScoringClub,
  type ScoringFixture,
  type StandingRow,
} from "@/domains/fixture/scoring";
import { toPublicClub, type PublicClub } from "@/domains/club/club.select";
import { NotFoundError } from "@/utils/types";

/** One row of a public division table — the `DivisionEntry` GraphQL type. */
export interface PublicDivisionEntry {
  id: string;
  divisionId: string;
  clubId: string;
  club: PublicClub;
  division: Division;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  byes: number;
  matchPoints: number;
  boardPoints: number;
  position: number | null;
  previousPosition: number | null;
  /** Positive = climbed. Derived by scoring.ts, never client-side (P1-6). */
  movement: number;
  form: string[];
}

export class SeasonService {
  private repo: SeasonRepository;

  constructor(private prisma: PrismaClient) {
    this.repo = new SeasonRepository(prisma);
  }

  // ── Seasons ────────────────────────────────────────────────────────────────

  /**
   * BUILD_PLAN §4.1, verbatim: "`currentSeason` returns the single season with
   * `status = ACTIVE`. Exactly one season may be ACTIVE at a time — enforce it
   * in the service, not just by convention. If none is active, return the most
   * recent ARCHIVED one and let the UI say the season hasn't started."
   *
   * Two ACTIVE seasons is a data fault, not a preference: silently picking one
   * would put half the fixtures on the public site and hide the other half. It
   * throws instead.
   */
  async getCurrentSeason() {
    const active = await this.repo.activeSeasons();
    if (active.length > 1) {
      throw new Error(
        `Data integrity: ${active.length} seasons are ACTIVE (${active
          .map((s) => s.slug)
          .join(", ")}). Exactly one may be active — BUILD_PLAN §4.1.`
      );
    }
    if (active.length === 1) return active[0];
    return this.repo.latestArchived();
  }

  getSeasons() {
    return this.repo.all();
  }

  async getSeasonById(id: string) {
    const season = await this.repo.findById(id);
    if (!season) throw new NotFoundError("Season not found");
    return season;
  }

  getDivisions(seasonId: string, level?: ClubLevel | null) {
    return this.repo.divisions(seasonId, level);
  }

  async getDivisionById(id: string) {
    const division = await this.repo.divisionById(id);
    if (!division) throw new NotFoundError("Division not found");
    return division;
  }

  divisionsForSeasons(seasonIds: string[]) {
    return this.repo.divisionsBySeasonIds(seasonIds);
  }

  // ── Division tables ────────────────────────────────────────────────────────

  /**
   * A division table, DERIVED (BUILD_PLAN §3.3 #2) at read time from VALIDATED
   * fixtures by `domains/fixture/scoring.ts` — the same pure module the tests
   * cover, so the public table and the tests can never disagree.
   *
   * Why derive on read rather than serve the persisted `DivisionEntry` numbers:
   * Phase 1 ships no result-entry or validation mutation, so nothing would ever
   * write them, and every table on the public site would read 0-0-0 the moment
   * real fixtures were validated by hand. Deriving keeps the invariant ("never
   * incremented in place from a UI action") and stays correct with no job.
   * `persistDivisionTable()` writes the same numbers back for Phase 2.
   */
  async getDivisionTable(divisionId: string): Promise<PublicDivisionEntry[]> {
    const [division, entries, fixtures] = await Promise.all([
      this.repo.divisionById(divisionId),
      this.repo.entriesForDivision(divisionId),
      this.repo.fixturesForDivision(divisionId),
    ]);
    if (!division) throw new NotFoundError("Division not found");
    return this.buildTable(division, entries, fixtures);
  }

  private buildTable(
    division: Division,
    entries: Awaited<ReturnType<SeasonRepository["entriesForDivision"]>>,
    fixtures: ScoringFixture[]
  ): PublicDivisionEntry[] {
    const clubs: ScoringClub[] = entries.map((e) => ({
      clubId: e.clubId,
      clubName: e.club.name,
    }));
    const rows = computeDivisionTable(clubs, fixtures);
    const byClubId = new Map(entries.map((e) => [e.clubId, e]));

    return rows.flatMap((row) => {
      const entry = byClubId.get(row.clubId);
      if (!entry) return [];
      return [
        {
          id: entry.id,
          divisionId: division.id,
          clubId: row.clubId,
          club: toPublicClub(entry.club),
          division,
          played: row.played,
          won: row.won,
          drawn: row.drawn,
          lost: row.lost,
          byes: row.byes,
          matchPoints: row.matchPoints,
          boardPoints: row.boardPoints,
          position: row.position,
          previousPosition: row.previousPosition,
          movement: positionMovement(row),
          form: row.form,
        },
      ];
    });
  }

  /** Every division table of a season, keyed by division id. One pass, two queries. */
  async getSeasonTables(seasonId: string): Promise<Map<string, PublicDivisionEntry[]>> {
    const divisions = await this.repo.divisions(seasonId);
    const ids = divisions.map((d) => d.id);
    const out = new Map<string, PublicDivisionEntry[]>();
    if (ids.length === 0) return out;

    const [entries, fixtures] = await Promise.all([
      this.repo.entriesForDivisions(ids),
      this.repo.fixturesForDivisions(ids),
    ]);

    for (const division of divisions) {
      out.set(
        division.id,
        this.buildTable(
          division,
          entries.filter((e) => e.divisionId === division.id),
          fixtures.filter((f) => f.divisionId === division.id)
        )
      );
    }
    return out;
  }

  /** This club's row in whichever division it holds a place in, for a season. */
  async getClubStanding(clubId: string, seasonId: string): Promise<PublicDivisionEntry | null> {
    const entry = await this.prisma.divisionEntry.findFirst({
      where: { clubId, division: { seasonId } },
      select: { divisionId: true },
    });
    if (!entry) return null;
    const table = await this.getDivisionTable(entry.divisionId);
    return table.find((r) => r.clubId === clubId) ?? null;
  }

  /** "3 of 14 match days played" for the network summary. */
  async getMatchDayProgress(seasonId: string | null): Promise<{ played: number; total: number }> {
    if (!seasonId) return { played: 0, total: 0 };
    const [divisions, played] = await Promise.all([
      this.repo.divisions(seasonId),
      this.repo.matchDaysPlayed(seasonId),
    ]);
    const total = divisions.reduce((max, d) => Math.max(max, d.totalMatchDays), 0);
    return { played, total };
  }

  // ── Write path (Phase 2 / seed) ────────────────────────────────────────────

  /**
   * Persist the derived table onto `DivisionEntry`. NOT reachable from GraphQL:
   * the whole point of §3.3 #2 is that a UI action never increments a table.
   * Phase 2's validation step and `scripts/seed-season-2026-27.ts` call this.
   */
  async persistDivisionTable(divisionId: string): Promise<PublicDivisionEntry[]> {
    const table = await this.getDivisionTable(divisionId);
    for (const row of table) {
      await this.repo.saveEntry(row.id, {
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        byes: row.byes,
        matchPoints: row.matchPoints,
        boardPoints: row.boardPoints,
        position: row.position,
        previousPosition: row.previousPosition,
        formJson: row.form,
      });
    }
    return table;
  }

  /** The raw derived rows, for callers that want the scoring shape (tests, tools). */
  async getRawStandingRows(divisionId: string): Promise<StandingRow[]> {
    const [entries, fixtures] = await Promise.all([
      this.repo.entriesForDivision(divisionId),
      this.repo.fixturesForDivision(divisionId),
    ]);
    return computeDivisionTable(
      entries.map((e) => ({ clubId: e.clubId, clubName: e.club.name })),
      fixtures
    );
  }
}
