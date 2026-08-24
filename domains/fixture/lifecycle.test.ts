import { describe, expect, it } from "vitest";

import {
  acceptsBoards,
  allBoardsRecorded,
  canRecordResult,
  canSubmitTeamSheet,
  canValidate,
  isTerminal,
  statusAfterBoardResult,
  statusAfterTeamSheet,
  type FixtureStatusValue,
} from "./lifecycle";

const done = { result: "WHITE_WIN" };
const open = { result: null };

const ALL: FixtureStatusValue[] = [
  "SCHEDULED",
  "TEAM_SHEETS",
  "LIVE",
  "AWAITING_VALIDATION",
  "VALIDATED",
  "CANCELLED",
];

describe("isTerminal", () => {
  it("is exactly VALIDATED and CANCELLED", () => {
    expect(ALL.filter(isTerminal)).toEqual(["VALIDATED", "CANCELLED"]);
  });
});

describe("canSubmitTeamSheet", () => {
  it("allows it before a result exists", () => {
    expect(canSubmitTeamSheet("SCHEDULED")).toBe(true);
    expect(canSubmitTeamSheet("TEAM_SHEETS")).toBe(true);
  });

  it("refuses once the fixture is live", () => {
    // Board order is what identifies the two players in a played game.
    expect(canSubmitTeamSheet("LIVE")).toBe(false);
    expect(canSubmitTeamSheet("AWAITING_VALIDATION")).toBe(false);
  });

  it("refuses in a terminal state", () => {
    expect(canSubmitTeamSheet("VALIDATED")).toBe(false);
    expect(canSubmitTeamSheet("CANCELLED")).toBe(false);
  });
});

describe("canRecordResult", () => {
  it("accepts a result on a fixture nobody filed a team sheet for", () => {
    // The rural-venue case: losing the only record of a played game is worse
    // than accepting it out of order.
    expect(canRecordResult("SCHEDULED")).toBe(true);
  });

  it("accepts a correction while awaiting validation", () => {
    expect(canRecordResult("AWAITING_VALIDATION")).toBe(true);
  });

  it("refuses on a validated or cancelled fixture", () => {
    expect(canRecordResult("VALIDATED")).toBe(false);
    expect(canRecordResult("CANCELLED")).toBe(false);
  });
});

describe("allBoardsRecorded", () => {
  it("is false for a fixture with no boards", () => {
    // Not vacuously true: an empty board list means nothing was played.
    expect(allBoardsRecorded([])).toBe(false);
  });

  it("is false while one board is open", () => {
    expect(allBoardsRecorded([done, done, open, done])).toBe(false);
  });

  it("is true when every board carries a result", () => {
    expect(allBoardsRecorded([done, done])).toBe(true);
  });
});

describe("statusAfterBoardResult", () => {
  it("moves a scheduled fixture straight to live on the first result", () => {
    expect(statusAfterBoardResult("SCHEDULED", [done, open, open, open])).toBe("LIVE");
  });

  it("moves to awaiting validation on the last result", () => {
    expect(statusAfterBoardResult("LIVE", [done, done, done, done])).toBe(
      "AWAITING_VALIDATION"
    );
  });

  it("does not drop back to live when a complete fixture is corrected", () => {
    expect(statusAfterBoardResult("AWAITING_VALIDATION", [done, done])).toBe(
      "AWAITING_VALIDATION"
    );
  });

  it("leaves a terminal fixture where it is", () => {
    expect(statusAfterBoardResult("VALIDATED", [done])).toBe("VALIDATED");
    expect(statusAfterBoardResult("CANCELLED", [done])).toBe("CANCELLED");
  });
});

describe("statusAfterTeamSheet", () => {
  it("advances a scheduled fixture", () => {
    expect(statusAfterTeamSheet("SCHEDULED")).toBe("TEAM_SHEETS");
  });

  it("is idempotent once both sheets are in", () => {
    expect(statusAfterTeamSheet("TEAM_SHEETS")).toBe("TEAM_SHEETS");
  });

  it("never moves a fixture backwards from live", () => {
    expect(statusAfterTeamSheet("LIVE")).toBe("LIVE");
  });
});

describe("canValidate", () => {
  it("requires the awaiting-validation state", () => {
    expect(canValidate("LIVE", [done, done])).toBe(false);
    expect(canValidate("SCHEDULED", [done, done])).toBe(false);
  });

  it("requires every board to be in", () => {
    expect(canValidate("AWAITING_VALIDATION", [done, open])).toBe(false);
  });

  it("accepts a complete fixture awaiting an arbiter", () => {
    expect(canValidate("AWAITING_VALIDATION", [done, done, done, done])).toBe(true);
  });

  it("refuses a fixture already validated", () => {
    expect(canValidate("VALIDATED", [done])).toBe(false);
  });
});

describe("acceptsBoards", () => {
  it("refuses a bye", () => {
    expect(acceptsBoards(true, 0)).toBe(false);
    expect(acceptsBoards(true, 4)).toBe(false);
  });

  it("refuses a fixture configured with no boards", () => {
    expect(acceptsBoards(false, 0)).toBe(false);
  });

  it("accepts an ordinary four-board fixture", () => {
    expect(acceptsBoards(false, 4)).toBe(true);
  });
});
