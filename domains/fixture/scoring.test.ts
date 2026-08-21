import { describe, it, expect } from "vitest";
import {
  BYE_CREDIT,
  MATCH_POINTS,
  TIEBREAK_LADDER,
  boardDisplay,
  boardPoints,
  boardWinner,
  compareStandingRows,
  computeDivisionTable,
  fixtureBoardPoints,
  fixtureOutcome,
  formatFixtureScore,
  formatGameResult,
  formatScore,
  matchPointsFor,
  positionMovement,
  type PieceColorValue,
  type ScoringBoard,
  type ScoringClub,
  type ScoringFixture,
  type StandingRow,
} from "./scoring";

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a fixture's boards from a compact pattern, in HOME/AWAY terms:
 *   H = home wins · A = away wins · D = draw · S = stalemate · "-" = not played
 *
 * Board colours ALTERNATE (board 1 `startColor`, board 2 the other, …), which
 * is how a real team match is set up — so every fixture built here exercises
 * the `homeColor` derivation in both directions.
 */
function boardsOf(pattern: string, startColor: PieceColorValue = "WHITE"): ScoringBoard[] {
  const other = (c: PieceColorValue): PieceColorValue => (c === "WHITE" ? "BLACK" : "WHITE");
  return pattern.split("").map((ch, i) => {
    const homeColor: PieceColorValue = i % 2 === 0 ? startColor : other(startColor);
    const homeIsWhite = homeColor === "WHITE";
    let result: ScoringBoard["result"] = null;
    if (ch === "H") result = homeIsWhite ? "WHITE_WIN" : "BLACK_WIN";
    else if (ch === "A") result = homeIsWhite ? "BLACK_WIN" : "WHITE_WIN";
    else if (ch === "D") result = "DRAW";
    else if (ch === "S") result = "STALEMATE";
    return { boardNumber: i + 1, homeColor, result };
  });
}

const dayOf = (matchDay: number) => new Date(Date.UTC(2026, 0, 3 + matchDay * 7));

function match(
  id: string,
  matchDay: number,
  homeClubId: string,
  awayClubId: string,
  pattern: string,
  startColor: PieceColorValue = "WHITE"
): ScoringFixture {
  return {
    id,
    status: "VALIDATED",
    isBye: false,
    homeClubId,
    awayClubId,
    matchDay,
    scheduledAt: dayOf(matchDay),
    boards: boardsOf(pattern, startColor),
  };
}

function bye(id: string, matchDay: number, clubId: string): ScoringFixture {
  return {
    id,
    status: "VALIDATED",
    isBye: true,
    homeClubId: clubId,
    awayClubId: null,
    matchDay,
    scheduledAt: dayOf(matchDay),
    boards: [],
  };
}

const clubsNamed = (...ids: string[]): ScoringClub[] =>
  ids.map((id) => ({ clubId: id, clubName: `Club ${id.toUpperCase()}` }));

const rowFor = (table: StandingRow[], clubId: string): StandingRow => {
  const r = table.find((x) => x.clubId === clubId);
  if (!r) throw new Error(`no row for ${clubId}`);
  return r;
};

const orderOf = (table: StandingRow[]) => table.map((r) => r.clubId);

// ── board points ──────────────────────────────────────────────────────────────

describe("board points from GameResult + homeColor", () => {
  it("gives a half point to each side for a draw, whichever colour home held", () => {
    expect(boardPoints({ homeColor: "WHITE", result: "DRAW" })).toEqual({ home: 0.5, away: 0.5 });
    expect(boardPoints({ homeColor: "BLACK", result: "DRAW" })).toEqual({ home: 0.5, away: 0.5 });
  });

  it("treats STALEMATE exactly as a draw", () => {
    expect(boardPoints({ homeColor: "WHITE", result: "STALEMATE" })).toEqual({
      home: 0.5,
      away: 0.5,
    });
    expect(boardPoints({ homeColor: "BLACK", result: "STALEMATE" })).toEqual({
      home: 0.5,
      away: 0.5,
    });
  });

  it("credits WHITE_WIN to home when home held White, and to away when it did not", () => {
    expect(boardPoints({ homeColor: "WHITE", result: "WHITE_WIN" })).toEqual({ home: 1, away: 0 });
    expect(boardPoints({ homeColor: "BLACK", result: "WHITE_WIN" })).toEqual({ home: 0, away: 1 });
  });

  it("credits BLACK_WIN the other way round", () => {
    expect(boardPoints({ homeColor: "WHITE", result: "BLACK_WIN" })).toEqual({ home: 0, away: 1 });
    expect(boardPoints({ homeColor: "BLACK", result: "BLACK_WIN" })).toEqual({ home: 1, away: 0 });
  });

  it("scores an unplayed board as nothing for either side", () => {
    expect(boardPoints({ homeColor: "WHITE", result: null })).toEqual({ home: 0, away: 0 });
    expect(boardWinner({ homeColor: "WHITE", result: null })).toBeNull();
  });

  it("reports the winner in home/away terms", () => {
    expect(boardWinner({ homeColor: "BLACK", result: "BLACK_WIN" })).toBe("HOME");
    expect(boardWinner({ homeColor: "BLACK", result: "WHITE_WIN" })).toBe("AWAY");
    expect(boardWinner({ homeColor: "WHITE", result: "DRAW" })).toBe("DRAW");
  });
});

// ── a fixture whose board colours alternate ───────────────────────────────────

describe("a fixture where board colours alternate", () => {
  // Board 1 home=White (home wins) · 2 home=Black (away wins) ·
  // 3 home=White (draw)            · 4 home=Black (home wins)
  const boards: ScoringBoard[] = [
    { boardNumber: 1, homeColor: "WHITE", result: "WHITE_WIN" },
    { boardNumber: 2, homeColor: "BLACK", result: "WHITE_WIN" },
    { boardNumber: 3, homeColor: "WHITE", result: "DRAW" },
    { boardNumber: 4, homeColor: "BLACK", result: "BLACK_WIN" },
  ];

  it("adds up to 2½–1½ for the home club", () => {
    expect(fixtureBoardPoints(boards)).toEqual({ home: 2.5, away: 1.5 });
    expect(fixtureOutcome(2.5, 1.5)).toBe("HOME_WIN");
    expect(matchPointsFor(2.5, 1.5)).toEqual({ home: 3, away: 0 });
  });

  it("renders each GAME white-first and the FIXTURE home-first", () => {
    expect(boards.map((b) => boardDisplay(b).result)).toEqual(["1-0", "1-0", "½-½", "0-1"]);
    expect(boards.map((b) => boardDisplay(b).whiteSide)).toEqual(["HOME", "AWAY", "HOME", "AWAY"]);
    const score = fixtureBoardPoints(boards);
    expect(formatFixtureScore(score.home, score.away)).toBe("2½–1½");
  });

  it("formats halves with ½ and never a decimal point", () => {
    expect(formatScore(0)).toBe("0");
    expect(formatScore(0.5)).toBe("½");
    expect(formatScore(4)).toBe("4");
    expect(formatScore(3.5)).toBe("3½");
    expect(formatGameResult(null)).toBe("");
    expect(formatGameResult("STALEMATE")).toBe("½-½");
  });

  it("ignores an unplayed board rather than guessing at it", () => {
    const partial = boardsOf("HA--");
    expect(fixtureBoardPoints(partial)).toEqual({ home: 1, away: 1 });
    expect(fixtureOutcome(1, 1)).toBe("DRAW");
  });
});

// ── byes ──────────────────────────────────────────────────────────────────────

describe("byes (BUILD_PLAN §3.3 #4, credit locked in §13)", () => {
  it("is worth 3 match points and 0 board points", () => {
    expect(BYE_CREDIT).toEqual({ matchPoints: 3, boardPoints: 0 });
    expect(MATCH_POINTS.WIN).toBe(3);
  });

  it("counts as played and as a bye, but never as a win", () => {
    const table = computeDivisionTable(clubsNamed("x"), [bye("f1", 1, "x")]);
    const x = rowFor(table, "x");
    expect(x.played).toBe(1);
    expect(x.byes).toBe(1);
    expect(x.won).toBe(0);
    expect(x.drawn).toBe(0);
    expect(x.lost).toBe(0);
    expect(x.matchPoints).toBe(3);
    expect(x.boardPoints).toBe(0);
    expect(x.form).toEqual(["B"]);
  });
});

// ── the whole table ───────────────────────────────────────────────────────────

describe("a 7-club division across 4 match days with byes", () => {
  const clubs = clubsNamed("a", "b", "c", "d", "e", "f", "g");
  const fixtures: ScoringFixture[] = [
    // match day 1 — G idle
    match("m1", 1, "a", "b", "HHHD"), // 3½–½
    match("m2", 1, "c", "d", "HHAA"), // 2–2
    match("m3", 1, "e", "f", "AAAH"), // 1–3
    bye("m4", 1, "g"),
    // match day 2 — F idle
    match("m5", 2, "a", "c", "HHDD"), // 3–1
    match("m6", 2, "b", "e", "DDDD"), // 2–2
    match("m7", 2, "d", "g", "AAHH"), // 2–2
    bye("m8", 2, "f"),
    // match day 3 — E idle
    match("m9", 3, "a", "d", "HHHH"), // 4–0
    match("m10", 3, "b", "f", "AAAA"), // 0–4
    match("m11", 3, "c", "g", "HHHA"), // 3–1
    bye("m12", 3, "e"),
    // match day 4 — D idle
    match("m13", 4, "a", "e", "HHHD"), // 3½–½
    match("m14", 4, "b", "g", "HDDA"), // 2–2
    match("m15", 4, "c", "f", "AAHD"), // 1½–2½
    bye("m16", 4, "d"),
  ];

  const table = computeDivisionTable(clubs, fixtures);

  it("plays every club exactly four times, byes included", () => {
    expect(table).toHaveLength(7);
    for (const row of table) expect(row.played).toBe(4);
    expect(table.reduce((n, r) => n + r.byes, 0)).toBe(4); // one bye per match day
  });

  it("conserves match points and board points", () => {
    // 12 contested fixtures: 8 decisive (3) + 4 drawn (2) = 32, plus 4 byes × 3.
    expect(table.reduce((n, r) => n + r.matchPoints, 0)).toBe(44);
    // 12 contested fixtures × 4 boards; byes contribute nothing.
    expect(table.reduce((n, r) => n + r.boardPoints, 0)).toBe(48);
  });

  it("ranks the table, breaking the three ties on board points", () => {
    expect(orderOf(table)).toEqual(["a", "f", "g", "d", "c", "e", "b"]);
    // a and f are level on 12 match points; a is ahead on board points.
    expect([rowFor(table, "a").matchPoints, rowFor(table, "f").matchPoints]).toEqual([12, 12]);
    expect(rowFor(table, "a").boardPoints).toBeGreaterThan(rowFor(table, "f").boardPoints);
    // g and d on 5; c and e on 4.
    expect([rowFor(table, "g").matchPoints, rowFor(table, "d").matchPoints]).toEqual([5, 5]);
    expect([rowFor(table, "c").matchPoints, rowFor(table, "e").matchPoints]).toEqual([4, 4]);
  });

  it("tallies every club exactly", () => {
    const summary = table.map((r) => [
      r.clubId,
      r.won,
      r.drawn,
      r.lost,
      r.byes,
      r.matchPoints,
      r.boardPoints,
    ]);
    expect(summary).toEqual([
      ["a", 4, 0, 0, 0, 12, 14],
      ["f", 3, 0, 0, 1, 12, 9.5],
      ["g", 0, 2, 1, 1, 5, 5],
      ["d", 0, 2, 1, 1, 5, 4],
      ["c", 1, 1, 2, 0, 4, 7.5],
      ["e", 0, 1, 2, 1, 4, 3.5],
      ["b", 0, 2, 2, 0, 2, 4.5],
    ]);
  });

  it("records form most-recent-last, with a bye as its own mark", () => {
    expect(rowFor(table, "a").form).toEqual(["W", "W", "W", "W"]);
    expect(rowFor(table, "f").form).toEqual(["W", "B", "W", "W"]);
    expect(rowFor(table, "d").form).toEqual(["D", "D", "L", "B"]);
    expect(rowFor(table, "g").form).toEqual(["B", "D", "L", "D"]);
    expect(rowFor(table, "b").form).toEqual(["L", "D", "L", "D"]);
  });

  it("derives previousPosition from the table as it stood before match day 4", () => {
    const before = computeDivisionTable(
      clubs,
      fixtures.filter((f) => f.matchDay !== 4)
    );
    expect(orderOf(before)).toEqual(["a", "f", "c", "e", "g", "d", "b"]);

    const movement = Object.fromEntries(
      table.map((r) => [r.clubId, [r.previousPosition, r.position]])
    );
    expect(movement).toEqual({
      a: [1, 1],
      f: [2, 2],
      g: [5, 3],
      d: [6, 4],
      c: [3, 5],
      e: [4, 6],
      b: [7, 7],
    });
    expect(positionMovement(rowFor(table, "g"))).toBe(2); // climbed two places
    expect(positionMovement(rowFor(table, "c"))).toBe(-2);
  });

  it("leaves previousPosition null until a second match day has been validated", () => {
    const firstDayOnly = computeDivisionTable(
      clubs,
      fixtures.filter((f) => f.matchDay === 1)
    );
    for (const row of firstDayOnly) expect(row.previousPosition).toBeNull();
  });

  it("ignores fixtures that are not VALIDATED", () => {
    const withLive = [
      ...fixtures,
      { ...match("live", 5, "b", "c", "HHHH"), status: "LIVE" as const },
      { ...match("await", 5, "d", "e", "HHHH"), status: "AWAITING_VALIDATION" as const },
      { ...match("cancelled", 5, "f", "g", "HHHH"), status: "CANCELLED" as const },
    ];
    expect(computeDivisionTable(clubs, withLive)).toEqual(table);
  });
});

// ── the tie-break ladder, level by level ──────────────────────────────────────

describe("tie-break ladder — BUILD_PLAN §3.4", () => {
  it("is the seven settled levels, in order", () => {
    expect([...TIEBREAK_LADDER]).toEqual([
      "matchPoints",
      "boardPoints",
      "headToHeadMatchPoints",
      "headToHeadBoardPoints",
      "won",
      "byes",
      "clubName",
    ]);
  });

  // Each case below holds every HIGHER level equal and varies exactly one, so
  // the levels are shown resolving in turn.
  const base = {
    clubId: "z",
    clubName: "Club Z",
    matchPoints: 10,
    boardPoints: 20,
    headToHeadMatchPoints: 3,
    headToHeadBoardPoints: 5,
    won: 3,
    byes: 1,
  };
  const higher = (over: Partial<typeof base>) => ({ ...base, clubId: "hi", clubName: "Club Hi", ...over });
  const lower = (over: Partial<typeof base>) => ({ ...base, clubId: "lo", clubName: "Club Lo", ...over });

  it("1 · most match points", () => {
    expect(compareStandingRows(higher({ matchPoints: 11 }), lower({}))).toBeLessThan(0);
  });

  it("2 · then most board points", () => {
    expect(compareStandingRows(higher({ boardPoints: 21 }), lower({}))).toBeLessThan(0);
  });

  it("3 · then the head-to-head match result", () => {
    expect(compareStandingRows(higher({ headToHeadMatchPoints: 6 }), lower({}))).toBeLessThan(0);
  });

  it("4 · then head-to-head board points", () => {
    expect(compareStandingRows(higher({ headToHeadBoardPoints: 6 }), lower({}))).toBeLessThan(0);
  });

  it("5 · then most matches won", () => {
    expect(compareStandingRows(higher({ won: 4 }), lower({}))).toBeLessThan(0);
  });

  it("6 · then FEWEST byes received", () => {
    expect(compareStandingRows(higher({ byes: 0 }), lower({ byes: 2 }))).toBeLessThan(0);
  });

  it("7 · then alphabetically by club name", () => {
    const a = { ...base, clubId: "aa", clubName: "Amba Chess Club" };
    const b = { ...base, clubId: "bb", clubName: "Buea Chess Club" };
    expect(compareStandingRows(a, b)).toBeLessThan(0);
    expect(compareStandingRows(b, a)).toBeGreaterThan(0);
  });

  it("stays total even when two clubs share a name", () => {
    const a = { ...base, clubId: "aa", clubName: "Same Name" };
    const b = { ...base, clubId: "bb", clubName: "Same Name" };
    expect(compareStandingRows(a, b)).toBeLessThan(0);
    expect(compareStandingRows(a, a)).toBe(0);
  });
});

describe("tie-break ladder, resolved from real fixtures", () => {
  it("2 · board points separate two clubs level on match points", () => {
    const clubs = clubsNamed("x", "y", "p", "q");
    const table = computeDivisionTable(clubs, [
      match("f1", 1, "x", "p", "HHHH"), // x wins 4–0
      match("f2", 1, "y", "q", "HHHA"), // y wins 3–1
    ]);
    expect(rowFor(table, "x").matchPoints).toBe(rowFor(table, "y").matchPoints);
    expect(orderOf(table).indexOf("x")).toBeLessThan(orderOf(table).indexOf("y"));
  });

  it("3 · the head-to-head match result separates them when board points are level too", () => {
    const clubs = clubsNamed("x", "y", "p", "q");
    const table = computeDivisionTable(clubs, [
      match("f1", 1, "x", "y", "HHHA"), // x beats y 3–1
      match("f2", 2, "x", "p", "AAAH"), // x loses 1–3
      match("f3", 3, "y", "q", "HHHA"), // y beats q 3–1
    ]);
    const x = rowFor(table, "x");
    const y = rowFor(table, "y");
    expect([x.matchPoints, x.boardPoints]).toEqual([y.matchPoints, y.boardPoints]);
    expect(x.won).toBe(y.won); // level 5 could not have decided it
    expect([x.headToHeadMatchPoints, y.headToHeadMatchPoints]).toEqual([3, 0]);
    expect(x.position).toBeLessThan(y.position);
  });

  it("4 · head-to-head board points separate them when the two clubs split the head-to-head", () => {
    const clubs = clubsNamed("x", "y", "p", "q");
    const table = computeDivisionTable(clubs, [
      match("f1", 1, "x", "y", "HHHA"), // x wins 3–1 at home
      match("f2", 2, "y", "x", "HHDA"), // y wins 2½–1½ at home
      match("f3", 3, "x", "p", "AAAA"), // x loses 0–4
      match("f4", 3, "y", "q", "AAAH"), // y loses 1–3
    ]);
    const x = rowFor(table, "x");
    const y = rowFor(table, "y");
    expect([x.matchPoints, x.boardPoints]).toEqual([y.matchPoints, y.boardPoints]);
    expect(x.headToHeadMatchPoints).toBe(y.headToHeadMatchPoints); // 3 each — level 3 is tied
    expect([x.headToHeadBoardPoints, y.headToHeadBoardPoints]).toEqual([4.5, 3.5]);
    expect(x.position).toBeLessThan(y.position);
  });

  it("5 · matches won separate two clubs that never met", () => {
    const clubs = clubsNamed("x", "y", "p", "q");
    const table = computeDivisionTable(clubs, [
      match("f1", 1, "x", "p", "HHHH"), // x wins 4–0
      match("f2", 1, "y", "q", "DDDD"), // 2–2
      match("f3", 2, "x", "q", "AAAH"), // x loses 1–3
      match("f4", 2, "y", "p", "DDDD"), // 2–2
      match("f5", 3, "x", "p", "AAAH"), // x loses 1–3
      match("f6", 3, "y", "q", "DDDD"), // 2–2
    ]);
    const x = rowFor(table, "x");
    const y = rowFor(table, "y");
    expect([x.matchPoints, x.boardPoints]).toEqual([y.matchPoints, y.boardPoints]);
    expect([x.headToHeadMatchPoints, y.headToHeadMatchPoints]).toEqual([0, 0]);
    expect([x.won, y.won]).toEqual([1, 0]);
    expect(x.position).toBeLessThan(y.position);
  });

  it("6 · fewest byes separates them — the correction for bye luck", () => {
    const clubs = clubsNamed("x", "y", "p", "q", "r", "s");
    const table = computeDivisionTable(clubs, [
      bye("f1", 1, "x"), // 3 match points, 0 board points
      match("f2", 2, "x", "p", "HHHA"), // x wins 3–1
      match("f3", 1, "y", "q", "H"), // one board: y wins 1–0
      match("f4", 2, "y", "r", "D"), // one board: ½–½
      match("f5", 3, "y", "s", "D"), // one board: ½–½
      match("f6", 4, "y", "p", "DD"), // two boards: 1–1
    ]);
    const x = rowFor(table, "x");
    const y = rowFor(table, "y");
    expect([x.matchPoints, x.boardPoints, x.won]).toEqual([6, 3, 1]);
    expect([y.matchPoints, y.boardPoints, y.won]).toEqual([6, 3, 1]);
    expect([x.headToHeadMatchPoints, y.headToHeadMatchPoints]).toEqual([0, 0]);
    expect([x.byes, y.byes]).toEqual([1, 0]);
    expect(y.position).toBeLessThan(x.position); // y took no free points
  });

  it("7 · club name is the last resort, and an empty division is still a valid table", () => {
    const table = computeDivisionTable(
      [
        { clubId: "beta", clubName: "Buea Chess Club" },
        { clubId: "alpha", clubName: "Amba Chess Club" },
      ],
      []
    );
    expect(orderOf(table)).toEqual(["alpha", "beta"]);
    expect(table.map((r) => r.position)).toEqual([1, 2]);
    expect(table.every((r) => r.previousPosition === null)).toBe(true);
    expect(table.every((r) => r.played === 0 && r.matchPoints === 0)).toBe(true);
  });
});
