/**
 * ══════════════════════════════════════════════════════════════════════════
 * Who may do what inside a club — BUILD_PLAN §2 (Roles) and §3.3.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Pure and dependency-free, like `domains/tournament/pairing.ts` and
 * `domains/fixture/scoring.ts`. Every management mutation routes its decision
 * through `can()`, so the answer to "may this person do this?" has exactly one
 * definition and one test file.
 *
 * ── Two role systems, and why the club one wins here ──────────────────────
 *
 * `UserRole` is platform-wide authority — may this person validate results?
 * `MembershipRole` is authority inside one club — may this person field a
 * team? BUILD_PLAN is explicit that club-scoped checks read `ClubMembership`,
 * never `User.role` alone, and this module is where that is enforced: the
 * club actions do not consult `UserRole` at all.
 *
 * The one action that inverts this is validation. See below.
 *
 * ── Validation is deliberately not a club permission ──────────────────────
 *
 * A patron must never be able to validate their own club's fixture. Validation
 * is what freezes a result into the league table and triggers the rating
 * write, and a club officer signing off their own match day is the single
 * clearest way to make the ledger untrustworthy.
 *
 * So `fixture:validate` is answered by `canValidateFixture()`, which reads the
 * fixture's appointed arbiter and the platform role — and explicitly refuses
 * anyone whose only claim is a membership in one of the two clubs, however
 * senior. A national admin who happens to be a club's patron is still allowed:
 * their authority comes from the platform role, which is auditable and was
 * granted by the academy rather than by the club.
 *
 * ── Status gates everything ───────────────────────────────────────────────
 *
 * Only an `ACTIVE` membership grants anything. `PENDING` is someone who has
 * entered a join code and is waiting to be admitted; `LEFT` and `REMOVED` are
 * history. A pending member with the role `PATRON` — which the admit screen
 * can produce if a role is set before admission — still has no authority until
 * they are admitted.
 */

export type MembershipRoleValue = "PLAYER" | "CAPTAIN" | "PATRON" | "ASSISTANT_COACH";

export type MembershipStatusValue = "PENDING" | "ACTIVE" | "LEFT" | "REMOVED";

export type PlatformRoleValue =
  | "STUDENT"
  | "COACH"
  | "SCHOOL_ADMIN"
  | "REGIONAL_ADMIN"
  | "NATIONAL_ADMIN"
  | "VOLUNTEER";

/** Everything the patron console can ask for. */
export type ClubAction =
  /** See the management surface at all — and with it the club's join code. */
  | "club:manage"
  /** Admit a pending join-code request, or decline it. */
  | "member:admit"
  /** Change someone's role inside the club. */
  | "member:setRole"
  /** Remove an active member. */
  | "member:remove"
  /** Create, edit or cancel a training session. */
  | "session:manage"
  /** Mark who turned up. */
  | "attendance:mark"
  /** Name players in board order before a match. */
  | "teamSheet:submit"
  /** Enter a board result on match day. */
  | "result:record";

/** An `ACTIVE` membership, reduced to what a permission decision needs. */
export interface ClubStanding {
  role: MembershipRoleValue;
  status: MembershipStatusValue;
}

/**
 * The whole truth table, written out rather than derived from a rank order.
 *
 * A ladder would be shorter and wrong: a captain is not a junior patron. A
 * captain picks who plays and enters what happened at the board, because they
 * are the person standing in the hall — and has no business changing who is in
 * the club or cancelling a training session. Those are different jobs, not
 * different amounts of the same job.
 */
const CLUB_MATRIX: Record<MembershipRoleValue, ReadonlySet<ClubAction>> = {
  PATRON: new Set<ClubAction>([
    "club:manage",
    "member:admit",
    "member:setRole",
    "member:remove",
    "session:manage",
    "attendance:mark",
    "teamSheet:submit",
    "result:record",
  ]),

  // Runs the sessions and the match day; does not decide who is in the club.
  ASSISTANT_COACH: new Set<ClubAction>([
    "club:manage",
    "member:admit",
    "session:manage",
    "attendance:mark",
    "teamSheet:submit",
    "result:record",
  ]),

  // The player who leads the team on the day. Board order and board results.
  CAPTAIN: new Set<ClubAction>(["teamSheet:submit", "result:record"]),

  PLAYER: new Set<ClubAction>(),
};

/** May a member with this standing take this action in their own club? */
export function can(standing: ClubStanding | null | undefined, action: ClubAction): boolean {
  if (!standing || standing.status !== "ACTIVE") return false;
  return CLUB_MATRIX[standing.role].has(action);
}

/**
 * May this person validate this fixture?
 *
 * Independent of `can()` on purpose — see the header. The three ways in:
 *
 *   · the arbiter appointed to this fixture,
 *   · a national admin,
 *   · a regional admin.
 *
 * Club membership is not one of them and is not consulted. `arbiterId` is
 * nullable, so a fixture with no appointed arbiter falls to the academy — it
 * does not fall to the clubs.
 */
export function canValidateFixture(args: {
  userId: string;
  platformRole: PlatformRoleValue | string;
  fixtureArbiterId: string | null;
}): boolean {
  if (args.fixtureArbiterId && args.fixtureArbiterId === args.userId) return true;
  return args.platformRole === "NATIONAL_ADMIN" || args.platformRole === "REGIONAL_ADMIN";
}

/**
 * The role a patron is allowed to hand out.
 *
 * A club has exactly one patron in practice — the teacher responsible to the
 * school — and `setMembershipRole` is not the place to transfer that. Promoting
 * somebody else to `PATRON` is allowed; demoting *yourself* as the last patron
 * is what this refuses, because a club with no patron has no one who can admit
 * the member who would fix it.
 */
export function wouldOrphanClub(args: {
  targetIsSelf: boolean;
  targetCurrentRole: MembershipRoleValue;
  nextRole: MembershipRoleValue;
  activePatronCount: number;
}): boolean {
  const losingAPatron = args.targetCurrentRole === "PATRON" && args.nextRole !== "PATRON";
  return losingAPatron && args.activePatronCount <= 1;
}
