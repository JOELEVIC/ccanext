/**
 * Fixture scoring and division standings — pure functions, no I/O and no Prisma
 * import, so they're easy to test. The house pattern is `domains/tournament/pairing.ts`.
 *
 * The rules this module owns (BUILD_PLAN §3.3, §3.4):
 *
 *  • A fixture score is DERIVED, never entered. It comes from each board's
 *    `result` (the existing `GameResult` enum — there is no second encoding)
 *    combined with `homeColor`. A `WHITE_WIN` credits the home club when
 *    `homeColor = WHITE` and the away club otherwise. `DRAW` and `STALEMATE`
 *    are half a point each.
 *
 *  • White-first is a GAME display rule (`1-0`, `0-1`, `½-½`); home-first is a
 *    FIXTURE display rule (`2½–1½`). Both are resolved here from `homeColor` —
 *    storage stays a single enum.
 *
 *  • A division table is DERIVED from VALIDATED fixtures only, never incremented
 *    in place. `position` and `previousPosition` are written by the same
 *    recompute, so movement needs no history table.
 *
 *  • Byes are fixtures (`isBye: true`, no away club, zero boards, VALIDATED).
 *    They increment `played` and `byes` and are worth **3 match points and 0
 *    board points** (BUILD_PLAN §13, decided). They are NOT wins — `won` is
 *    untouched — which is why tie-break level 6 (fewest byes received) exists:
 *    it corrects for the luck of drawing a bye in an odd division.
 *
 * Nothing here reads or writes the database. The service layer loads clubs and
 * fixtures, calls `computeDivisionTable`, and persists the result.
 */

// ── Value types ───────────────────────────────────────────────────────────────
// Declared locally as string unions rather than imported from `@prisma/client`,
// so this module stays dependency-free. They are structurally identical to the
// generated Prisma enums, so a Prisma row can be passed straight in.

/** The existing `GameResult` enum. Used by both `Game` and `FixtureBoard`. */
export type GameResultValue = "WHITE_WIN" | "BLACK_WIN" | "DRAW" | "STALEMATE";

/** Which colour the HOME club had on this board. */
export type PieceColorValue = "WHITE" | "BLACK";

export type FixtureStatusValue =
  | "SCHEDULED"
  | "TEAM_SHEETS"
  | "LIVE"
  | "AWAITING_VALIDATION"
  | "VALIDATED"
  | "CANCELLED";

/**
 * One character of a club's form string, most-recent-last.
 * `B` is a bye — it is neither a win nor a draw, so it gets its own character
 * rather than being laundered into a `W` (see the bye rule above).
 */
export type FormResult = "W" | "D" | "L" | "B";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Match points for a fixture result. 3 / 1 / 0 (BUILD_PLAN §2). */
export const MATCH_POINTS = {
  WIN: 3,
  DRAW: 1,
  LOSS: 0,
} as const;

/**
 * What a bye is worth. LOCKED (BUILD_PLAN §13): a bye shouldn't punish a club
 * for being in an odd-sized division, so it pays full match points — but it is
 * played over zero boards, so it earns nothing towards board points.
 */
export const BYE_CREDIT = {
  matchPoints: 3,
  boardPoints: 0,
} as const;

/** The settled ladder (BUILD_PLAN §3.4), in order, for docs and tests. */
export const TIEBREAK_LADDER = [
  "matchPoints",
  "boardPoints",
  "headToHeadMatchPoints",
  "headToHeadBoardPoints",
  "won",
  "byes",
  "clubName",
] as const;

// ── Inputs ────────────────────────────────────────────────────────────────────

/** One board of a fixture — the subset of `FixtureBoard` scoring cares about. */
export interface ScoringBoard {
  boardNumber?: number;
  /** The HOME club's colour on this board. */
  homeColor: PieceColorValue;
  /** null = not yet played (or never recorded): worth nothing to either side. */
  result: GameResultValue | null;
}

/** One fixture — the subset of `Fixture` scoring cares about. */
export interface ScoringFixture {
  id: string;
  status: FixtureStatusValue;
  isBye: boolean;
  homeClubId: string | null;
  awayClubId: string | null;
  /** Used to group a division into match days. Falls back to the date. */
  matchDay?: number | null;
  scheduledAt: Date | string | number;
  boards: ScoringBoard[];
}

/** A club holding an entry in the division. `name` is tie-break level 7. */
export interface ScoringClub {
  clubId: string;
  clubName: string;
}

// ── Outputs ───────────────────────────────────────────────────────────────────

export interface BoardPoints {
  home: number;
  away: number;
}

export type FixtureOutcome = "HOME_WIN" | "AWAY_WIN" | "DRAW";

/** One row of a division table. Maps 1:1 onto `DivisionEntry`. */
export interface StandingRow {
  clubId: string;
  clubName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  byes: number;
  matchPoints: number;
  boardPoints: number;
  /** 1-based, assigned after the full tie-break ladder. */
  position: number;
  /** Position in the table as it stood BEFORE the latest match day; null if there isn't one. */
  previousPosition: number | null;
  /** Most-recent-last, e.g. ["W","W","D","B"]. Persisted as `formJson`. */
  form: FormResult[];
  /**
   * Tie-break levels 3 and 4, computed only against the clubs this club is
   * actually tied with on match points AND board points. Zero otherwise —
   * they are meaningless outside a tie group and must not be displayed as
   * standalone statistics.
   */
  headToHeadMatchPoints: number;
  headToHeadBoardPoints: number;
}

// ── Board- and fixture-level scoring ───────────────────────────────────────────

/**
 * Board points for one board, from the home club's point of view and the away
 * club's. `WHITE_WIN` credits whichever side held White on THIS board.
 */
export function boardPoints(board: ScoringBoard): BoardPoints {
  if (board.result === null) return { home: 0, away: 0 };
  if (board.result === "DRAW" || board.result === "STALEMATE") {
    return { home: 0.5, away: 0.5 };
  }
  const homeIsWhite = board.homeColor === "WHITE";
  const whiteWon = board.result === "WHITE_WIN";
  const homeWon = homeIsWhite === whiteWon;
  return homeWon ? { home: 1, away: 0 } : { home: 0, away: 1 };
}

/** Who won one board, in fixture (home/away) terms. null = not played. */
export function boardWinner(board: ScoringBoard): "HOME" | "AWAY" | "DRAW" | null {
  if (board.result === null) return null;
  if (board.result === "DRAW" || board.result === "STALEMATE") return "DRAW";
  return boardPoints(board).home === 1 ? "HOME" : "AWAY";
}

/** The derived fixture score. This is what `Fixture.homeScore`/`awayScore` must hold. */
export function fixtureBoardPoints(boards: ScoringBoard[]): BoardPoints {
  let home = 0;
  let away = 0;
  for (const b of boards) {
    const p = boardPoints(b);
    home += p.home;
    away += p.away;
  }
  return { home, away };
}

export function fixtureOutcome(home: number, away: number): FixtureOutcome {
  if (home > away) return "HOME_WIN";
  if (away > home) return "AWAY_WIN";
  return "DRAW";
}

/** 3 / 1 / 0 for both clubs, from a board-point score. */
export function matchPointsFor(home: number, away: number): { home: number; away: number } {
  const outcome = fixtureOutcome(home, away);
  if (outcome === "HOME_WIN") return { home: MATCH_POINTS.WIN, away: MATCH_POINTS.LOSS };
  if (outcome === "AWAY_WIN") return { home: MATCH_POINTS.LOSS, away: MATCH_POINTS.WIN };
  return { home: MATCH_POINTS.DRAW, away: MATCH_POINTS.DRAW };
}

// ── Display ───────────────────────────────────────────────────────────────────

/** "2½", "0", "1½" — halves are real and are written with ½, never ".5". */
export function formatScore(points: number): string {
  const whole = Math.floor(points);
  const hasHalf = points - whole >= 0.5;
  if (!hasHalf) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

/**
 * A GAME result, WHITE first: `1-0`, `0-1`, `½-½`. Independent of home/away —
 * that is what `formatFixtureScore` is for. Returns "" for an unplayed board.
 */
export function formatGameResult(result: GameResultValue | null): string {
  switch (result) {
    case "WHITE_WIN":
      return "1-0";
    case "BLACK_WIN":
      return "0-1";
    case "DRAW":
    case "STALEMATE":
      return "½-½";
    default:
      return "";
  }
}

/** A FIXTURE score, HOME first, with an en dash: `2½–1½`. */
export function formatFixtureScore(home: number, away: number): string {
  return `${formatScore(home)}–${formatScore(away)}`;
}

/**
 * Everything a board row needs to render honestly: the White-first result
 * string, and which side (home or away) actually held White.
 */
export function boardDisplay(board: ScoringBoard): {
  result: string;
  whiteSide: "HOME" | "AWAY";
  points: BoardPoints;
} {
  return {
    result: formatGameResult(board.result),
    whiteSide: board.homeColor === "WHITE" ? "HOME" : "AWAY",
    points: boardPoints(board),
  };
}

// ── Division table ────────────────────────────────────────────────────────────

function timeOf(when: Date | string | number): number {
  if (when instanceof Date) return when.getTime();
  return new Date(when).getTime();
}

/** A fixture only enters a table once VALIDATED and once it has a home club. */
function counts(f: ScoringFixture): boolean {
  if (f.status !== "VALIDATED") return false;
  if (!f.homeClubId) return false;
  if (!f.isBye && !f.awayClubId) return false;
  return true;
}

/**
 * The key a fixture is grouped under when splitting a division into match days.
 * `matchDay` when it is set (the normal case); otherwise the calendar date, so
 * an un-numbered fixture still lands in a sensible group.
 */
function matchDayKey(f: ScoringFixture): string {
  if (f.matchDay !== null && f.matchDay !== undefined) return `md:${f.matchDay}`;
  return `dt:${new Date(timeOf(f.scheduledAt)).toISOString().slice(0, 10)}`;
}

function chronological(a: ScoringFixture, b: ScoringFixture): number {
  const ma = a.matchDay ?? Number.MAX_SAFE_INTEGER;
  const mb = b.matchDay ?? Number.MAX_SAFE_INTEGER;
  if (ma !== mb) return ma - mb;
  const ta = timeOf(a.scheduledAt);
  const tb = timeOf(b.scheduledAt);
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

interface Tally {
  clubId: string;
  clubName: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  byes: number;
  matchPoints: number;
  boardPoints: number;
  form: FormResult[];
  headToHeadMatchPoints: number;
  headToHeadBoardPoints: number;
}

function blankTally(club: ScoringClub): Tally {
  return {
    clubId: club.clubId,
    clubName: club.clubName,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    byes: 0,
    matchPoints: 0,
    boardPoints: 0,
    form: [],
    headToHeadMatchPoints: 0,
    headToHeadBoardPoints: 0,
  };
}

/** Accumulate raw W/D/L/bye statistics. No ranking yet. */
function tally(clubs: ScoringClub[], fixtures: ScoringFixture[]): Map<string, Tally> {
  const rows = new Map<string, Tally>();
  for (const c of clubs) rows.set(c.clubId, blankTally(c));

  for (const f of fixtures.slice().sort(chronological)) {
    const home = rows.get(f.homeClubId as string);

    if (f.isBye) {
      // BUILD_PLAN §3.3 #4: counts as played, credits match points, credits no
      // board points, and is deliberately NOT recorded as a win.
      if (!home) continue;
      home.played += 1;
      home.byes += 1;
      home.matchPoints += BYE_CREDIT.matchPoints;
      home.boardPoints += BYE_CREDIT.boardPoints;
      home.form.push("B");
      continue;
    }

    const away = rows.get(f.awayClubId as string);
    if (!home || !away) continue; // a club outside this division — ignore

    const bp = fixtureBoardPoints(f.boards);
    const mp = matchPointsFor(bp.home, bp.away);
    const outcome = fixtureOutcome(bp.home, bp.away);

    home.played += 1;
    away.played += 1;
    home.boardPoints += bp.home;
    away.boardPoints += bp.away;
    home.matchPoints += mp.home;
    away.matchPoints += mp.away;

    if (outcome === "HOME_WIN") {
      home.won += 1;
      away.lost += 1;
      home.form.push("W");
      away.form.push("L");
    } else if (outcome === "AWAY_WIN") {
      away.won += 1;
      home.lost += 1;
      away.form.push("W");
      home.form.push("L");
    } else {
      home.drawn += 1;
      away.drawn += 1;
      home.form.push("D");
      away.form.push("D");
    }
  }

  return rows;
}

/**
 * Fill in tie-break levels 3 and 4. Head-to-head is only meaningful inside a
 * group of clubs that are level on BOTH match points and board points — those
 * are the only clubs the ladder ever reaches level 3 for. For a group of two
 * this is "who won the match"; for a larger group it is the mini-league between
 * them, which reduces to the same thing.
 */
function applyHeadToHead(rows: Map<string, Tally>, fixtures: ScoringFixture[]): void {
  const groups = new Map<string, Tally[]>();
  for (const row of rows.values()) {
    const key = `${row.matchPoints}|${row.boardPoints}`;
    const g = groups.get(key);
    if (g) g.push(row);
    else groups.set(key, [row]);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const members = new Set(group.map((r) => r.clubId));
    for (const f of fixtures) {
      if (f.isBye) continue;
      const homeId = f.homeClubId as string;
      const awayId = f.awayClubId as string;
      if (!members.has(homeId) || !members.has(awayId)) continue;
      const home = rows.get(homeId);
      const away = rows.get(awayId);
      if (!home || !away) continue;
      const bp = fixtureBoardPoints(f.boards);
      const mp = matchPointsFor(bp.home, bp.away);
      home.headToHeadMatchPoints += mp.home;
      away.headToHeadMatchPoints += mp.away;
      home.headToHeadBoardPoints += bp.home;
      away.headToHeadBoardPoints += bp.away;
    }
  }
}

/**
 * The full seven-level ladder of BUILD_PLAN §3.4, in order, until the tie breaks:
 *
 *   1. match points          (most)
 *   2. board points          (most)
 *   3. head-to-head match points among the tied clubs   (most)
 *   4. head-to-head board points among the tied clubs   (most)
 *   5. matches won           (most)
 *   6. byes received         (FEWEST — this is what corrects for bye luck)
 *   7. club name             (alphabetical: a stable, arbitrary last resort)
 *
 * Club id is a final guard so the order is total even for duplicate names.
 */
export function compareStandingRows(
  a: Pick<
    StandingRow,
    | "matchPoints"
    | "boardPoints"
    | "headToHeadMatchPoints"
    | "headToHeadBoardPoints"
    | "won"
    | "byes"
    | "clubName"
    | "clubId"
  >,
  b: typeof a
): number {
  if (b.matchPoints !== a.matchPoints) return b.matchPoints - a.matchPoints;
  if (b.boardPoints !== a.boardPoints) return b.boardPoints - a.boardPoints;
  if (b.headToHeadMatchPoints !== a.headToHeadMatchPoints) {
    return b.headToHeadMatchPoints - a.headToHeadMatchPoints;
  }
  if (b.headToHeadBoardPoints !== a.headToHeadBoardPoints) {
    return b.headToHeadBoardPoints - a.headToHeadBoardPoints;
  }
  if (b.won !== a.won) return b.won - a.won;
  if (a.byes !== b.byes) return a.byes - b.byes; // fewest byes wins
  const byName = a.clubName.localeCompare(b.clubName, "en");
  if (byName !== 0) return byName;
  return a.clubId < b.clubId ? -1 : a.clubId > b.clubId ? 1 : 0;
}

/** Tally + head-to-head + rank, for one set of fixtures. */
function rank(clubs: ScoringClub[], fixtures: ScoringFixture[]): Tally[] {
  const rows = tally(clubs, fixtures);
  applyHeadToHead(rows, fixtures);
  return Array.from(rows.values()).sort(compareStandingRows);
}

/**
 * Recompute a whole division table.
 *
 * `clubs` is every club holding a `DivisionEntry` — clubs with no fixtures yet
 * still get a row, which is what makes the pre-season empty table correct.
 * `fixtures` is every fixture of the division; anything not `VALIDATED` is
 * ignored, so a live or awaiting-validation match day never moves the table.
 *
 * `previousPosition` is derived from the same fixtures rather than from whatever
 * was last written to the database: it is the table as it stood before the most
 * recent match day. Until a second match day has been validated there is no
 * meaningful "before", so it is null for every club.
 *
 * Returns rows in ranked order, with `position` filled in 1..n.
 */
export function computeDivisionTable(
  clubs: ScoringClub[],
  fixtures: ScoringFixture[]
): StandingRow[] {
  const countable = fixtures.filter(counts).sort(chronological);

  // Split into match days so "before the latest match day" is well defined.
  const dayOrder: string[] = [];
  const byDay = new Map<string, ScoringFixture[]>();
  for (const f of countable) {
    const key = matchDayKey(f);
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.push(f);
    } else {
      byDay.set(key, [f]);
      dayOrder.push(key);
    }
  }

  const current = rank(clubs, countable);

  let previousPositionOf = new Map<string, number>();
  if (dayOrder.length >= 2) {
    const latest = dayOrder[dayOrder.length - 1];
    const before = countable.filter((f) => matchDayKey(f) !== latest);
    rank(clubs, before).forEach((row, i) => previousPositionOf.set(row.clubId, i + 1));
  }

  return current.map((row, i) => ({
    clubId: row.clubId,
    clubName: row.clubName,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    byes: row.byes,
    matchPoints: row.matchPoints,
    boardPoints: row.boardPoints,
    position: i + 1,
    previousPosition: previousPositionOf.get(row.clubId) ?? null,
    form: row.form,
    headToHeadMatchPoints: row.headToHeadMatchPoints,
    headToHeadBoardPoints: row.headToHeadBoardPoints,
  }));
}

/** Movement for the public table's arrow. Positive = climbed. */
export function positionMovement(row: Pick<StandingRow, "position" | "previousPosition">): number {
  if (row.previousPosition === null) return 0;
  return row.previousPosition - row.position;
}
