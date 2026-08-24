/**
 * ══════════════════════════════════════════════════════════════════════════
 * The fixture state machine — BUILD_PLAN §3.3 and the six `FixtureStatus`
 * values the public site already renders.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Pure and dependency-free. The status is **derived from what has happened**,
 * not set by a client: a team sheet arriving moves a fixture to `TEAM_SHEETS`,
 * the first board result moves it to `LIVE`, and the last one moves it to
 * `AWAITING_VALIDATION`. No screen anywhere sends a status.
 *
 * That is the same discipline as `scoring.ts`: the score is derived from the
 * boards, so the status is derived from the boards too. A patron console that
 * could PATCH a fixture to `VALIDATED` would make every invariant below
 * decorative.
 *
 * ── The six states, in the order a match day walks them ───────────────────
 *
 *   SCHEDULED            a date and two clubs, nothing else
 *   TEAM_SHEETS          at least one club has named its board order
 *   LIVE                 at least one board has a result, not all of them
 *   AWAITING_VALIDATION  every board has a result; the arbiter has not signed
 *   VALIDATED            frozen: counts in the table, boards are rated
 *   CANCELLED            called off; never counts, never rates
 *
 * `VALIDATED` and `CANCELLED` are terminal. Nothing in the console can leave
 * them — reopening a validated fixture would mean un-rating games that are
 * already in players' careers, so it is an academy operation and not a
 * mutation this milestone ships.
 */

export type FixtureStatusValue =
  | "SCHEDULED"
  | "TEAM_SHEETS"
  | "LIVE"
  | "AWAITING_VALIDATION"
  | "VALIDATED"
  | "CANCELLED";

/** A board reduced to the one fact the state machine needs. */
export interface LifecycleBoard {
  result: string | null;
}

const TERMINAL: ReadonlySet<FixtureStatusValue> = new Set(["VALIDATED", "CANCELLED"]);

/** Frozen. Nothing the patron console offers may touch it. */
export function isTerminal(status: FixtureStatusValue): boolean {
  return TERMINAL.has(status);
}

/**
 * May a team sheet be submitted or changed?
 *
 * Up to and including `TEAM_SHEETS` — but **not** once the fixture is `LIVE`.
 * Once a result is in, changing who played on board 2 would silently reassign
 * a game that has already been played, and the board order is what decides
 * which two players those were.
 */
export function canSubmitTeamSheet(status: FixtureStatusValue): boolean {
  return status === "SCHEDULED" || status === "TEAM_SHEETS";
}

/**
 * May a board result be recorded or corrected?
 *
 * Any non-terminal state, deliberately including `SCHEDULED`: a match day at a
 * rural venue may produce results before anybody files a team sheet, and
 * refusing the result would lose the only record of the game. The status
 * catches up on its own — see `statusAfterBoardResult`.
 */
export function canRecordResult(status: FixtureStatusValue): boolean {
  return !isTerminal(status);
}

/** Every board carries a result — the fixture is ready for an arbiter. */
export function allBoardsRecorded(boards: LifecycleBoard[]): boolean {
  return boards.length > 0 && boards.every((b) => b.result != null);
}

/**
 * The status a fixture holds after a board result lands.
 *
 * Never moves backwards and never leaves a terminal state, so a late
 * correction on an already-complete fixture keeps it at
 * `AWAITING_VALIDATION` rather than dropping it back to `LIVE`.
 */
export function statusAfterBoardResult(
  status: FixtureStatusValue,
  boards: LifecycleBoard[]
): FixtureStatusValue {
  if (isTerminal(status)) return status;
  return allBoardsRecorded(boards) ? "AWAITING_VALIDATION" : "LIVE";
}

/** The status a fixture holds after a team sheet lands. */
export function statusAfterTeamSheet(status: FixtureStatusValue): FixtureStatusValue {
  return status === "SCHEDULED" ? "TEAM_SHEETS" : status;
}

/**
 * May this fixture be validated?
 *
 * `AWAITING_VALIDATION` only. Validating a `LIVE` fixture would freeze a half
 * -played match into the table; validating a `SCHEDULED` one would freeze a
 * match that never happened. *Who* may validate is a separate question,
 * answered by `canValidateFixture` in `domains/club/permissions.ts` — this
 * function answers only whether the fixture is in a state to receive it.
 */
export function canValidate(status: FixtureStatusValue, boards: LifecycleBoard[]): boolean {
  return status === "AWAITING_VALIDATION" && allBoardsRecorded(boards);
}

/**
 * A bye is a fixture and skips the whole walk — BUILD_PLAN §3.3 invariant 4.
 * It is created `VALIDATED` with no boards, so it never reaches this module in
 * practice; the guard exists so a caller that forgets cannot record a result
 * against a match that was never played.
 */
export function acceptsBoards(isBye: boolean, boardCount: number): boolean {
  return !isBye && boardCount > 0;
}
