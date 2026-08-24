import type { PrismaClient } from "@prisma/client";

import { AuthorizationError, NotFoundError, ValidationError } from "@/utils/types";

import {
  can,
  wouldOrphanClub,
  type ClubAction,
  type MembershipRoleValue,
} from "./permissions";

/**
 * ══════════════════════════════════════════════════════════════════════════
 * The patron console — members, roles and training sessions.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * PLATFORM_ROADMAP Milestone 4.3. Phase 1 was read-only; this is the first
 * write surface a person outside the academy ever touches, and every method
 * here begins by asking `permissions.ts` whether they may.
 *
 * Match day — team sheets, board results, validation — is in
 * `domains/fixture/matchday.service.ts`. The split is deliberate: this file
 * is about who is in the club, that one is about what happened at the board,
 * and they have different authorisation rules and different urgency.
 *
 * ── Names in here are not consent-reduced, and that is the rule ───────────
 *
 * BUILD_PLAN §4.3 gates **public display**. A patron is the teacher
 * responsible to the school for these children; a roster that showed them
 * "Brenda A." would be unusable for the one person who has to take a register.
 *
 * So the management types carry real names — and the protection is that they
 * are reachable only through `club:manage`, only for the caller's own club,
 * and are never returned by any public query. `Club.joinCode` follows the same
 * rule and appears here for the same reason (BUILD_PLAN §3.3 invariant 6).
 * A new query that returns `ClubMemberRow` must repeat the permission check;
 * there is no public path that could inherit one by accident.
 */

export interface ClubMemberRow {
  id: string;
  userId: string;
  username: string;
  fullName: string;
  role: MembershipRoleValue;
  status: string;
  schoolYear: string | null;
  boardOrder: number | null;
  rating: number;
  joinedAt: Date;
}

export interface ClubSessionRow {
  id: string;
  title: string;
  startsAt: Date;
  location: string | null;
  status: string;
  presentCount: number;
  excusedCount: number;
  absentCount: number;
}

export class ClubManagementService {
  constructor(private prisma: PrismaClient) {}

  // ── authorisation ─────────────────────────────────────────────────────────

  /**
   * Resolve the caller's standing in one club and check one action.
   *
   * Every mutation in this file and the match-day one funnels through here, so
   * "may this person do this?" is one query and one call to the pure matrix.
   * Throws rather than returning false: a caller that forgets to check the
   * boolean is a security bug, and a caller that forgets to call this at all
   * is caught by the fact that it has no `clubId` to work with otherwise.
   */
  async requireClubAction(
    userId: string,
    clubId: string,
    action: ClubAction
  ): Promise<{ role: MembershipRoleValue }> {
    const membership = await this.prisma.clubMembership.findUnique({
      where: { clubId_userId: { clubId, userId } },
      select: { role: true, status: true },
    });

    if (!can(membership as never, action)) {
      // Deliberately the same message whether the caller is in the club with
      // too junior a role or not in it at all. The difference would tell an
      // outsider that a club id is real.
      throw new AuthorizationError("You do not have permission to do that in this club");
    }
    return { role: membership!.role as MembershipRoleValue };
  }

  // ── the console's own read ────────────────────────────────────────────────

  /** Every club the caller can manage, for the console's club switcher. */
  async myManagedClubs(userId: string) {
    const rows = await this.prisma.clubMembership.findMany({
      where: { userId, status: "ACTIVE", role: { in: ["PATRON", "ASSISTANT_COACH"] } },
      select: {
        role: true,
        club: { select: { id: true, slug: true, name: true, shortName: true, region: true, level: true, crestJson: true } },
      },
      orderBy: { joinedAt: "asc" },
    });
    return rows.map((r) => ({ ...r.club, myRole: r.role as MembershipRoleValue }));
  }

  /**
   * The console header: the club, its join code, and the counts a patron
   * checks first — how many are waiting to be admitted.
   */
  async getConsole(userId: string, clubId: string) {
    await this.requireClubAction(userId, clubId, "club:manage");

    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: {
        id: true, slug: true, name: true, shortName: true, region: true,
        level: true, status: true, joinCode: true, crestJson: true,
        school: { select: { id: true, name: true } },
      },
    });
    if (!club) throw new NotFoundError("Club not found");

    const [pending, active, nextSession] = await Promise.all([
      this.prisma.clubMembership.count({ where: { clubId, status: "PENDING" } }),
      this.prisma.clubMembership.count({ where: { clubId, status: "ACTIVE" } }),
      this.prisma.clubSession.findFirst({
        where: { clubId, status: "SCHEDULED", startsAt: { gte: new Date() } },
        orderBy: { startsAt: "asc" },
        select: { id: true, title: true, startsAt: true, location: true },
      }),
    ]);

    return { club, pendingCount: pending, activeCount: active, nextSession };
  }

  // ── members ───────────────────────────────────────────────────────────────

  async listMembers(
    userId: string,
    clubId: string,
    status?: string | null
  ): Promise<ClubMemberRow[]> {
    await this.requireClubAction(userId, clubId, "club:manage");

    const rows = await this.prisma.clubMembership.findMany({
      where: { clubId, ...(status ? { status: status as never } : {}) },
      select: {
        id: true, role: true, status: true, schoolYear: true,
        boardOrder: true, joinedAt: true,
        user: {
          select: {
            id: true, username: true, rating: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      // Pending first: the console's job is to surface what needs a decision.
      orderBy: [{ status: "asc" }, { joinedAt: "asc" }],
    });

    return rows.map((r) => ({
      id: r.id,
      userId: r.user.id,
      username: r.user.username,
      fullName: [r.user.profile?.firstName, r.user.profile?.lastName]
        .filter(Boolean)
        .join(" ")
        .trim(),
      role: r.role as MembershipRoleValue,
      status: r.status,
      schoolYear: r.schoolYear,
      boardOrder: r.boardOrder,
      rating: r.user.rating,
      joinedAt: r.joinedAt,
    }));
  }

  /** Admit a pending join-code request, or decline it. */
  async decideMembership(userId: string, membershipId: string, admit: boolean) {
    const membership = await this.loadMembership(membershipId);
    await this.requireClubAction(userId, membership.clubId, "member:admit");

    if (membership.status !== "PENDING") {
      throw new ValidationError("That request has already been decided");
    }

    return this.prisma.clubMembership.update({
      where: { id: membershipId },
      data: admit
        ? { status: "ACTIVE", joinedAt: new Date() }
        : // Declined requests keep the row rather than deleting it, so the same
          // person re-entering the code does not look like a new request and
          // the club can see it happened.
          { status: "REMOVED", leftAt: new Date() },
    });
  }

  async setMembershipRole(userId: string, membershipId: string, nextRole: MembershipRoleValue) {
    const membership = await this.loadMembership(membershipId);
    await this.requireClubAction(userId, membership.clubId, "member:setRole");

    if (membership.status !== "ACTIVE") {
      throw new ValidationError("Only an active member has a role to change");
    }

    const activePatronCount = await this.prisma.clubMembership.count({
      where: { clubId: membership.clubId, status: "ACTIVE", role: "PATRON" },
    });

    if (
      wouldOrphanClub({
        targetIsSelf: membership.userId === userId,
        targetCurrentRole: membership.role as MembershipRoleValue,
        nextRole,
        activePatronCount,
      })
    ) {
      throw new ValidationError(
        "This club would be left with no patron. Promote someone else first."
      );
    }

    return this.prisma.clubMembership.update({
      where: { id: membershipId },
      data: { role: nextRole },
    });
  }

  async removeMember(userId: string, membershipId: string) {
    const membership = await this.loadMembership(membershipId);
    await this.requireClubAction(userId, membership.clubId, "member:remove");

    const activePatronCount = await this.prisma.clubMembership.count({
      where: { clubId: membership.clubId, status: "ACTIVE", role: "PATRON" },
    });

    // Removing the last patron orphans the club exactly as demoting them does.
    if (
      wouldOrphanClub({
        targetIsSelf: membership.userId === userId,
        targetCurrentRole: membership.role as MembershipRoleValue,
        nextRole: "PLAYER",
        activePatronCount,
      })
    ) {
      throw new ValidationError(
        "This club would be left with no patron. Promote someone else first."
      );
    }

    return this.prisma.clubMembership.update({
      where: { id: membershipId },
      data: { status: "REMOVED", leftAt: new Date(), boardOrder: null },
    });
  }

  private async loadMembership(id: string) {
    const membership = await this.prisma.clubMembership.findUnique({
      where: { id },
      select: { id: true, clubId: true, userId: true, role: true, status: true },
    });
    if (!membership) throw new NotFoundError("Membership not found");
    return membership;
  }

  // ── sessions and attendance ───────────────────────────────────────────────

  async listSessions(userId: string, clubId: string, limit = 20): Promise<ClubSessionRow[]> {
    await this.requireClubAction(userId, clubId, "club:manage");

    const rows = await this.prisma.clubSession.findMany({
      where: { clubId },
      orderBy: { startsAt: "desc" },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true, title: true, startsAt: true, location: true, status: true,
        attendance: { select: { state: true } },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      startsAt: r.startsAt,
      location: r.location,
      status: r.status,
      presentCount: r.attendance.filter((a) => a.state === "PRESENT").length,
      excusedCount: r.attendance.filter((a) => a.state === "EXCUSED").length,
      absentCount: r.attendance.filter((a) => a.state === "ABSENT").length,
    }));
  }

  async createSession(
    userId: string,
    clubId: string,
    input: { title: string; startsAt: Date; location?: string | null }
  ) {
    await this.requireClubAction(userId, clubId, "session:manage");
    if (!input.title?.trim()) throw new ValidationError("A session needs a title");

    return this.prisma.clubSession.create({
      data: {
        clubId,
        title: input.title.trim(),
        startsAt: input.startsAt,
        location: input.location?.trim() || null,
      },
    });
  }

  async updateSession(
    userId: string,
    sessionId: string,
    input: { title?: string; startsAt?: Date; location?: string | null; status?: string }
  ) {
    const session = await this.loadSession(sessionId);
    await this.requireClubAction(userId, session.clubId, "session:manage");

    return this.prisma.clubSession.update({
      where: { id: sessionId },
      data: {
        ...(input.title != null ? { title: input.title.trim() } : {}),
        ...(input.startsAt != null ? { startsAt: input.startsAt } : {}),
        ...(input.location !== undefined ? { location: input.location?.trim() || null } : {}),
        ...(input.status != null ? { status: input.status as never } : {}),
      },
    });
  }

  /**
   * Take the register.
   *
   * Replaces the whole register for the session in one transaction rather than
   * accepting one tick at a time. A patron marks a room, not a person — and a
   * partial write on a bad connection at a school hall would leave a register
   * that is half this week and half last.
   *
   * Marking attendance moves the session to `HELD`. A session nobody attended
   * is still a session that happened; `CANCELLED` is set explicitly and is a
   * different statement.
   */
  async markAttendance(
    userId: string,
    sessionId: string,
    entries: { userId: string; state: string }[]
  ) {
    const session = await this.loadSession(sessionId);
    await this.requireClubAction(userId, session.clubId, "attendance:mark");

    const memberIds = new Set(
      (
        await this.prisma.clubMembership.findMany({
          where: { clubId: session.clubId, status: "ACTIVE" },
          select: { userId: true },
        })
      ).map((m) => m.userId)
    );

    const unknown = entries.filter((e) => !memberIds.has(e.userId));
    if (unknown.length) {
      throw new ValidationError("The register lists someone who is not an active member");
    }

    await this.prisma.$transaction([
      this.prisma.sessionAttendance.deleteMany({ where: { sessionId } }),
      this.prisma.sessionAttendance.createMany({
        data: entries.map((e) => ({
          sessionId,
          userId: e.userId,
          state: e.state as never,
        })),
      }),
      this.prisma.clubSession.update({
        where: { id: sessionId },
        data: { status: "HELD" },
      }),
    ]);

    return this.prisma.clubSession.findUniqueOrThrow({ where: { id: sessionId } });
  }

  async sessionRegister(userId: string, sessionId: string) {
    const session = await this.loadSession(sessionId);
    await this.requireClubAction(userId, session.clubId, "club:manage");

    const [members, marks] = await Promise.all([
      this.listMembers(userId, session.clubId, "ACTIVE"),
      this.prisma.sessionAttendance.findMany({
        where: { sessionId },
        select: { userId: true, state: true },
      }),
    ]);

    const byUser = new Map(marks.map((m) => [m.userId, m.state]));
    return {
      session,
      // Every active member appears, marked or not — a register with people
      // missing from it is how attendance quietly stops being a record.
      rows: members.map((m) => ({ member: m, state: byUser.get(m.userId) ?? null })),
    };
  }

  private async loadSession(id: string) {
    const session = await this.prisma.clubSession.findUnique({
      where: { id },
      select: { id: true, clubId: true, title: true, startsAt: true, status: true },
    });
    if (!session) throw new NotFoundError("Session not found");
    return session;
  }
}
