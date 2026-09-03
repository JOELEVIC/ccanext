/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Joining a club with a code, after the account already exists.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Until now a join code could only be spent at registration — `RegisterInput`
 * carries one, and `UserService.register` turns it into a PENDING membership.
 * That covered the student who arrives holding the code and leaves everybody
 * else stranded: a person who downloaded the app before their school signed
 * up, a student whose club started this term, anyone who tapped past the code
 * field once. They had an account and no way to attach it to a club.
 *
 * This module is the decision that flow needs, with no database in it: given
 * what the caller already holds, what should entering a code do?
 *
 * ── The constraint everything here bends around ──────────────────────────
 *
 * A person may hold at most one ACTIVE membership. That is a partial unique
 * index in Postgres (`club_memberships_userId_active_key`, manual_apply_clubs_
 * seasons.sql §5) rather than a rule in a service, so it cannot be talked out
 * of — and a request that would eventually violate it must be refused when it
 * is made, not when a patron tries to admit it. A patron pressing "admit" and
 * getting a database error is the worst place to discover this.
 *
 * ── Why re-entering a code is never a second request ─────────────────────
 *
 * The membership table is unique on (club, user), and a declined request is
 * kept as REMOVED rather than deleted so the club can see it happened. So
 * every outcome below is an update or a no-op on that one row. A student who
 * taps twice, or who reinstalls the app and tries again, does not appear to a
 * patron as a stranger asking a second time — which the home screen's pending
 * copy already promises them.
 */

/** The statuses a membership row can hold. Mirrors `MembershipStatus`. */
export type MembershipStatusValue = "PENDING" | "ACTIVE" | "LEFT" | "REMOVED";

/** What the caller already holds, reduced to what the decision needs. */
export interface HeldMembership {
  clubId: string;
  status: MembershipStatusValue;
  /** For the refusal message. A person is owed the name of the club they are waiting on. */
  clubName: string;
}

export type JoinOutcome =
  /** Nothing to do — they already hold this, at this club. */
  | { kind: "already"; status: "PENDING" | "ACTIVE" }
  /** No row for this club yet. */
  | { kind: "create" }
  /** A LEFT or REMOVED row for this club, put back to PENDING. */
  | { kind: "revive" }
  /** Refused, with the club that blocks it. */
  | { kind: "refuse"; reason: "active-elsewhere" | "pending-elsewhere"; clubName: string };

/**
 * What entering [code]'s club should do, given every membership the caller
 * holds.
 *
 * ── The order of these branches is the whole design ──────────────────────
 *
 * This club is considered FIRST. A student who is already ACTIVE here, or
 * already waiting here, gets a no-op even if some stale row elsewhere would
 * otherwise refuse them — because the thing they asked for is already true,
 * and refusing it would be both wrong and unactionable.
 *
 * Only then do other clubs block. ACTIVE elsewhere is the hard one: admitting
 * would break the index. PENDING elsewhere is refused too, so that a patron
 * never admits somebody a second patron is about to admit — and so a person
 * is only ever waiting on one answer.
 */
export function decideJoin(
  targetClubId: string,
  held: readonly HeldMembership[],
): JoinOutcome {
  const here = held.find((m) => m.clubId === targetClubId);
  if (here?.status === "ACTIVE" || here?.status === "PENDING") {
    return { kind: "already", status: here.status };
  }

  const active = held.find(
    (m) => m.clubId !== targetClubId && m.status === "ACTIVE",
  );
  if (active) {
    return { kind: "refuse", reason: "active-elsewhere", clubName: active.clubName };
  }

  const pending = held.find(
    (m) => m.clubId !== targetClubId && m.status === "PENDING",
  );
  if (pending) {
    return { kind: "refuse", reason: "pending-elsewhere", clubName: pending.clubName };
  }

  // LEFT or REMOVED here: a declined student may be admitted later, and a
  // member who left may come back. Both are the same row put back to PENDING.
  return here ? { kind: "revive" } : { kind: "create" };
}
