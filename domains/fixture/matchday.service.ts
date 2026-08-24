import type { PrismaClient } from "@prisma/client";

import { applyPairRating, type WhiteScore } from "@/domains/game/ratingWrite";
import { canValidateFixture } from "@/domains/club/permissions";
import type { ClubManagementService } from "@/domains/club/management.service";
import { AuthorizationError, NotFoundError, ValidationError } from "@/utils/types";

import {
  acceptsBoards,
  canRecordResult,
  canSubmitTeamSheet,
  canValidate,
  statusAfterBoardResult,
  statusAfterTeamSheet,
  type FixtureStatusValue,
} from "./lifecycle";
import { fixtureBoardPoints, type GameResultValue, type ScoringBoard } from "./scoring";

/**
 * ══════════════════════════════════════════════════════════════════════════
 * Match day — team sheets, board results, and validation.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * PLATFORM_ROADMAP Milestone 4.3. This is the file that makes the ledger
 * writable, and it holds three of BUILD_PLAN §3.3's invariants:
 *
 *   1 · **The fixture score is derived, never entered.** `recordBoardResult`
 *       recomputes `homeScore`/`awayScore` from every board through
 *       `scoring.ts`. No mutation anywhere accepts a score.
 *   3 · **A board rates exactly once.** `ratedAt` is stamped inside the same
 *       transaction as the rating write, so the stamp and the rating either
 *       both land or neither does.
 *   — · **The status is derived too.** No client sends a `FixtureStatus`; it
 *       follows from what has been recorded. See `lifecycle.ts`.
 *
 * ── Why both clubs may record a result ────────────────────────────────────
 *
 * Either side's patron or captain can enter any board. The alternative — only
 * the home club writes — fails on the day the home club's phone is flat, and
 * the game still happened.
 *
 * The protection is not exclusivity, it is the trail: every write appends a
 * `BOARD_RESULT` event naming who recorded what, and a later write never
 * erases the earlier one from the event log. An arbiter validating a fixture
 * where the two clubs disagreed sees both entries and decides. That is the
 * same thing that happens on paper.
 */

/** The colour convention for a team match: home has White on the odd boards. */
export function homeColorForBoard(boardNumber: number): "WHITE" | "BLACK" {
  return boardNumber % 2 === 1 ? "WHITE" : "BLACK";
}

type Side = "HOME" | "AWAY";

export class MatchDayService {
  constructor(
    private prisma: PrismaClient,
    private management: ClubManagementService
  ) {}

  // ── shared loading and side resolution ────────────────────────────────────

  private async loadFixture(id: string) {
    const fixture = await this.prisma.fixture.findUnique({
      where: { id },
      select: {
        id: true, status: true, isBye: true, boardCount: true, scheduledAt: true,
        venue: true, homeClubId: true, awayClubId: true, arbiterId: true,
        // The derived score and the competition are part of every response
        // this service returns. Leaving them out let the resolver fall back to
        // 0-0, which is a wrong answer that looks like a real one.
        competition: true, homeScore: true, awayScore: true,
        homeClub: { select: { id: true, name: true, shortName: true, slug: true } },
        awayClub: { select: { id: true, name: true, shortName: true, slug: true } },
        boards: {
          orderBy: { boardNumber: "asc" },
          select: {
            id: true, boardNumber: true, homeColor: true, result: true,
            homeUserId: true, awayUserId: true, scoresheetUrl: true,
            moveCount: true, ratedAt: true, recordedById: true, recordedAt: true,
            gameId: true,
          },
        },
      },
    });
    if (!fixture) throw new NotFoundError("Fixture not found");
    return fixture;
  }

  /**
   * Which side of this fixture is the caller acting for?
   *
   * A person can only ever act for a club they hold the action in. Checking
   * both sides and taking whichever grants the action is what lets a neutral
   * arbiter's own club membership stay irrelevant, and what makes a member of
   * neither club fail with the same message as a member with too junior a role.
   */
  private async resolveSide(
    userId: string,
    fixture: { homeClubId: string | null; awayClubId: string | null },
    action: "teamSheet:submit" | "result:record"
  ): Promise<{ side: Side; clubId: string }> {
    for (const [side, clubId] of [
      ["HOME", fixture.homeClubId],
      ["AWAY", fixture.awayClubId],
    ] as const) {
      if (!clubId) continue;
      try {
        await this.management.requireClubAction(userId, clubId, action);
        return { side, clubId };
      } catch {
        // Try the other side before deciding this person has no standing.
      }
    }
    throw new AuthorizationError("You do not have permission to do that in this fixture");
  }

  // ── team sheets ───────────────────────────────────────────────────────────

  /** The team-sheet screen's read: my side, my eligible players, the boards. */
  async getTeamSheet(userId: string, fixtureId: string) {
    const fixture = await this.loadFixture(fixtureId);
    const { side, clubId } = await this.resolveSide(userId, fixture, "teamSheet:submit");

    const eligible = await this.prisma.clubMembership.findMany({
      where: { clubId, status: "ACTIVE" },
      select: {
        userId: true, boardOrder: true, schoolYear: true,
        user: {
          select: {
            id: true, username: true, rating: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      // Strongest first: a captain builds a board order from the top down.
      orderBy: { user: { rating: "desc" } },
    });

    return {
      fixture,
      side,
      clubId,
      editable: canSubmitTeamSheet(fixture.status as FixtureStatusValue),
      eligible: eligible.map((m) => ({
        userId: m.user.id,
        username: m.user.username,
        fullName: [m.user.profile?.firstName, m.user.profile?.lastName]
          .filter(Boolean)
          .join(" ")
          .trim(),
        rating: m.user.rating,
        schoolYear: m.schoolYear,
        boardOrder: m.boardOrder,
      })),
    };
  }

  /**
   * Name players in board order.
   *
   * Replaces this club's whole sheet in one write. A sheet is a statement
   * about a team, not about one board, and a half-applied sheet is a fixture
   * where board 3 is last week's player.
   */
  async submitTeamSheet(
    userId: string,
    fixtureId: string,
    boards: { boardNumber: number; userId: string }[]
  ) {
    const fixture = await this.loadFixture(fixtureId);
    const { side, clubId } = await this.resolveSide(userId, fixture, "teamSheet:submit");

    if (!acceptsBoards(fixture.isBye, fixture.boardCount)) {
      throw new ValidationError("This fixture has no boards to fill");
    }
    if (!canSubmitTeamSheet(fixture.status as FixtureStatusValue)) {
      throw new ValidationError(
        "The board order is fixed once a result has been recorded"
      );
    }

    const numbers = boards.map((b) => b.boardNumber);
    if (new Set(numbers).size !== numbers.length) {
      throw new ValidationError("Two players cannot share a board");
    }
    if (numbers.some((n) => n < 1 || n > fixture.boardCount)) {
      throw new ValidationError(`Boards are numbered 1 to ${fixture.boardCount}`);
    }
    const playerIds = boards.map((b) => b.userId);
    if (new Set(playerIds).size !== playerIds.length) {
      throw new ValidationError("One player cannot play two boards");
    }

    const activeIds = new Set(
      (
        await this.prisma.clubMembership.findMany({
          where: { clubId, status: "ACTIVE" },
          select: { userId: true },
        })
      ).map((m) => m.userId)
    );
    if (playerIds.some((id) => !activeIds.has(id))) {
      throw new ValidationError("Every player on the sheet must be an active member");
    }

    const field = side === "HOME" ? "homeUserId" : "awayUserId";
    const named = new Map(boards.map((b) => [b.boardNumber, b.userId]));

    await this.prisma.$transaction([
      // Every board of this fixture, so a player dropped from the sheet is
      // actually cleared rather than left behind on an old board.
      ...Array.from({ length: fixture.boardCount }, (_, i) => i + 1).map((boardNumber) =>
        this.prisma.fixtureBoard.upsert({
          where: { fixtureId_boardNumber: { fixtureId, boardNumber } },
          create: {
            fixtureId,
            boardNumber,
            homeColor: homeColorForBoard(boardNumber),
            [field]: named.get(boardNumber) ?? null,
          },
          update: { [field]: named.get(boardNumber) ?? null },
        })
      ),
      this.prisma.fixture.update({
        where: { id: fixtureId },
        data: { status: statusAfterTeamSheet(fixture.status as FixtureStatusValue) as never },
      }),
      this.prisma.fixtureEvent.create({
        data: {
          fixtureId,
          kind: "NOTE",
          message: `${side === "HOME" ? "Home" : "Away"} team sheet submitted (${boards.length} boards)`,
        },
      }),
    ]);

    return this.loadFixture(fixtureId);
  }

  // ── results ───────────────────────────────────────────────────────────────

  /**
   * Record or correct one board.
   *
   * `result` is White-first (`WHITE_WIN` / `BLACK_WIN` / `DRAW` / `STALEMATE`)
   * because that is how a game is written down — the fixture score is what
   * gets rendered home-first, and `homeColor` is what converts between them.
   * The API deliberately has no "home won" encoding: one result format,
   * BUILD_PLAN §3.3 invariant 5.
   */
  async recordBoardResult(
    userId: string,
    args: {
      fixtureId: string;
      boardNumber: number;
      result: GameResultValue;
      moveCount?: number | null;
      scoresheetUrl?: string | null;
    }
  ) {
    const fixture = await this.loadFixture(args.fixtureId);
    const { side } = await this.resolveSide(userId, fixture, "result:record");

    if (!acceptsBoards(fixture.isBye, fixture.boardCount)) {
      throw new ValidationError("This fixture has no boards to record");
    }
    if (!canRecordResult(fixture.status as FixtureStatusValue)) {
      throw new ValidationError("This fixture is closed to changes");
    }
    if (args.boardNumber < 1 || args.boardNumber > fixture.boardCount) {
      throw new ValidationError(`Boards are numbered 1 to ${fixture.boardCount}`);
    }

    const boardNumber = args.boardNumber;
    const existing = fixture.boards.find((b) => b.boardNumber === boardNumber);
    const homeColor = existing?.homeColor ?? homeColorForBoard(boardNumber);

    // The derived score, recomputed over every board with this one applied.
    const next: ScoringBoard[] = Array.from(
      { length: fixture.boardCount },
      (_, i) => i + 1
    ).map((n) => {
      const b = fixture.boards.find((x) => x.boardNumber === n);
      const result = n === boardNumber ? args.result : ((b?.result ?? null) as GameResultValue | null);
      return { boardNumber: n, homeColor: (b?.homeColor ?? homeColorForBoard(n)) as "WHITE" | "BLACK", result };
    });
    const score = fixtureBoardPoints(next);

    await this.prisma.$transaction([
      this.prisma.fixtureBoard.upsert({
        where: { fixtureId_boardNumber: { fixtureId: args.fixtureId, boardNumber } },
        create: {
          fixtureId: args.fixtureId,
          boardNumber,
          homeColor: homeColor as never,
          result: args.result as never,
          moveCount: args.moveCount ?? null,
          scoresheetUrl: args.scoresheetUrl ?? null,
          recordedById: userId,
          recordedAt: new Date(),
        },
        update: {
          result: args.result as never,
          ...(args.moveCount != null ? { moveCount: args.moveCount } : {}),
          ...(args.scoresheetUrl != null ? { scoresheetUrl: args.scoresheetUrl } : {}),
          recordedById: userId,
          recordedAt: new Date(),
        },
      }),
      this.prisma.fixture.update({
        where: { id: args.fixtureId },
        data: {
          homeScore: score.home,
          awayScore: score.away,
          status: statusAfterBoardResult(fixture.status as FixtureStatusValue, next) as never,
        },
      }),
      // Appended, never replaced. Two clubs disagreeing about board 3 leaves
      // two events, and the arbiter reads both.
      this.prisma.fixtureEvent.create({
        data: {
          fixtureId: args.fixtureId,
          kind: "BOARD_RESULT",
          board: boardNumber,
          message: `Board ${boardNumber}: ${args.result} (recorded by the ${side === "HOME" ? "home" : "away"} club)`,
        },
      }),
    ]);

    return this.loadFixture(args.fixtureId);
  }

  // ── validation ────────────────────────────────────────────────────────────

  /**
   * The arbiter's signature. Freezes the result into the league table and
   * rates every board — the one moment a fixture's games touch a rating.
   *
   * Who may do this is `canValidateFixture` and is deliberately **not** a club
   * permission: a patron signing off their own club's match day is the
   * clearest way to make the ledger untrustworthy. See `permissions.ts`.
   */
  async validateFixture(userId: string, fixtureId: string) {
    const fixture = await this.loadFixture(fixtureId);

    const caller = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!caller) throw new NotFoundError("User not found");

    if (
      !canValidateFixture({
        userId,
        platformRole: caller.role,
        fixtureArbiterId: fixture.arbiterId,
      })
    ) {
      throw new AuthorizationError("Only the appointed arbiter or the academy may validate");
    }
    if (!canValidate(fixture.status as FixtureStatusValue, fixture.boards)) {
      throw new ValidationError("Every board must have a result before validation");
    }

    // Rate first, board by board, then freeze. A rating failure must not leave
    // a fixture VALIDATED with unrated boards — that state is unrecoverable
    // without un-rating, which nothing here can do.
    for (const board of fixture.boards) {
      if (board.ratedAt) continue; // invariant 3: exactly once
      if (!board.result || !board.homeUserId || !board.awayUserId) continue;

      const homeIsWhite = board.homeColor === "WHITE";
      const whiteId = homeIsWhite ? board.homeUserId : board.awayUserId;
      const blackId = homeIsWhite ? board.awayUserId : board.homeUserId;

      const [white, black] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: whiteId }, select: { rating: true } }),
        this.prisma.user.findUnique({ where: { id: blackId }, select: { rating: true } }),
      ]);
      if (!white || !black) continue;

      const whiteScore: WhiteScore =
        board.result === "WHITE_WIN" ? 1 : board.result === "BLACK_WIN" ? 0 : 0.5;

      await applyPairRating(this.prisma, {
        whiteId,
        blackId,
        whiteFallbackRating: white.rating,
        blackFallbackRating: black.rating,
        whiteScore,
        // The stamp rides in the rating transaction. This is what makes
        // "exactly once" true under a retry rather than merely intended.
        extraWrites: [
          this.prisma.fixtureBoard.update({
            where: { id: board.id },
            data: { ratedAt: new Date() },
          }),
        ] as never,
      });
    }

    await this.prisma.$transaction([
      this.prisma.fixture.update({
        where: { id: fixtureId },
        data: { status: "VALIDATED", validatedById: userId, validatedAt: new Date() },
      }),
      this.prisma.fixtureEvent.create({
        data: { fixtureId, kind: "VALIDATED", message: "Result validated" },
      }),
    ]);

    return this.loadFixture(fixtureId);
  }

  /** Fixtures one club still has to file or have signed off. */
  async clubMatchDayQueue(userId: string, clubId: string) {
    await this.management.requireClubAction(userId, clubId, "club:manage");

    return this.prisma.fixture.findMany({
      where: {
        OR: [{ homeClubId: clubId }, { awayClubId: clubId }],
        status: { in: ["SCHEDULED", "TEAM_SHEETS", "LIVE", "AWAITING_VALIDATION"] },
      },
      orderBy: { scheduledAt: "asc" },
      select: {
        id: true, scheduledAt: true, venue: true, status: true, boardCount: true,
        homeScore: true, awayScore: true, competition: true, isBye: true,
        homeClub: { select: { id: true, name: true, shortName: true, slug: true } },
        awayClub: { select: { id: true, name: true, shortName: true, slug: true } },
        boards: { select: { boardNumber: true, result: true } },
      },
    });
  }
}
