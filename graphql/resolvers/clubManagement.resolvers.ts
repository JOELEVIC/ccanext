import type { GraphQLContextWithServices } from "../context";
import { AuthenticationError } from "@/utils/types";
import type { MembershipRoleValue } from "@/domains/club/permissions";

/**
 * ══════════════════════════════════════════════════════════════════════════
 * The patron console's resolvers — PLATFORM_ROADMAP Milestone 4.3.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Thin by design. Every authorisation decision is made inside the services,
 * which resolve the caller's standing in the specific club and ask the pure
 * matrix in `domains/club/permissions.ts`. A resolver that made its own
 * decision would be a second definition of who may do what.
 *
 * The one thing done here is `requireUser`: a management operation with no
 * token is an authentication failure, not an authorisation one, and the two
 * produce different behaviour in the client (sign in again vs. you cannot).
 */

function requireUser(ctx: GraphQLContextWithServices) {
  if (!ctx.user) throw new AuthenticationError("Sign in to manage a club");
  return ctx.user.userId;
}

/** `crestJson` is stored as JSON; the SDL exposes it as a typed `Crest`. */
function crestOf(row: { crestJson?: unknown }) {
  return (row.crestJson as { shield: string; band: string; charge: string } | null) ?? null;
}

function clubSummary(
  club: { slug: string; name: string; shortName: string; crestJson?: unknown } | null
) {
  return club ? { ...club, crest: crestOf(club) } : null;
}

export const clubManagementResolvers = {
  Query: {
    /**
     * PLATFORM_ROADMAP 4.2 — the member's own view.
     *
     * Sits beside the console's queries rather than in the public club
     * resolvers because it is authenticated and about the caller. It returns
     * the caller's own rows only, so there is no consent question to answer.
     */
    myMemberships: (_: unknown, __: unknown, ctx: GraphQLContextWithServices) =>
      ctx.services.clubService.myMemberships(requireUser(ctx)),

    myManagedClubs: async (_: unknown, __: unknown, ctx: GraphQLContextWithServices) => {
      const rows = await ctx.services.clubManagementService.myManagedClubs(requireUser(ctx));
      return rows.map((r) => ({ ...r, crest: crestOf(r) }));
    },

    clubConsole: async (
      _: unknown,
      { clubId }: { clubId: string },
      ctx: GraphQLContextWithServices
    ) => {
      const view = await ctx.services.clubManagementService.getConsole(
        requireUser(ctx),
        clubId
      );
      return {
        ...view,
        club: {
          ...view.club,
          crest: crestOf(view.club),
          schoolId: view.club.school?.id ?? null,
          schoolName: view.club.school?.name ?? null,
        },
        // The console header shows the next session as a card; the counts it
        // needs are zero until a register is taken, and the list query is the
        // place that computes them.
        nextSession: view.nextSession
          ? {
              ...view.nextSession,
              status: "SCHEDULED",
              presentCount: 0,
              excusedCount: 0,
              absentCount: 0,
            }
          : null,
      };
    },

    clubMembers: (
      _: unknown,
      { clubId, status }: { clubId: string; status?: string | null },
      ctx: GraphQLContextWithServices
    ) => ctx.services.clubManagementService.listMembers(requireUser(ctx), clubId, status),

    clubSessions: (
      _: unknown,
      { clubId, limit }: { clubId: string; limit?: number },
      ctx: GraphQLContextWithServices
    ) =>
      ctx.services.clubManagementService.listSessions(requireUser(ctx), clubId, limit ?? 20),

    sessionRegister: (
      _: unknown,
      { sessionId }: { sessionId: string },
      ctx: GraphQLContextWithServices
    ) => ctx.services.clubManagementService.sessionRegister(requireUser(ctx), sessionId),

    teamSheet: async (
      _: unknown,
      { fixtureId }: { fixtureId: string },
      ctx: GraphQLContextWithServices
    ) => {
      const view = await ctx.services.matchDayService.getTeamSheet(
        requireUser(ctx),
        fixtureId
      );
      return { ...view, fixture: toMatchDayFixture(view.fixture) };
    },

    clubMatchDayQueue: async (
      _: unknown,
      { clubId }: { clubId: string },
      ctx: GraphQLContextWithServices
    ) => {
      const rows = await ctx.services.matchDayService.clubMatchDayQueue(
        requireUser(ctx),
        clubId
      );
      return rows.map((r) => ({
        ...r,
        homeClub: clubSummary(r.homeClub),
        awayClub: clubSummary(r.awayClub),
        // The queue selects only what a card needs; the full board shape is on
        // the fixture screen. Filling the rest here would be a second query per
        // row for data no card renders.
        boards: r.boards.map((b) => ({
          id: `${r.id}:${b.boardNumber}`,
          boardNumber: b.boardNumber,
          homeColor: b.boardNumber % 2 === 1 ? "WHITE" : "BLACK",
          result: b.result,
          homeUserId: null,
          awayUserId: null,
          homeName: null,
          awayName: null,
          scoresheetUrl: null,
          moveCount: null,
          ratedAt: null,
          recordedAt: null,
        })),
      }));
    },
  },

  Mutation: {
    decideMembership: (
      _: unknown,
      { membershipId, admit }: { membershipId: string; admit: boolean },
      ctx: GraphQLContextWithServices
    ) =>
      ctx.services.clubManagementService
        .decideMembership(requireUser(ctx), membershipId, admit)
        .then((m) => reloadMember(ctx, m.id)),

    setMembershipRole: (
      _: unknown,
      { membershipId, role }: { membershipId: string; role: MembershipRoleValue },
      ctx: GraphQLContextWithServices
    ) =>
      ctx.services.clubManagementService
        .setMembershipRole(requireUser(ctx), membershipId, role)
        .then((m) => reloadMember(ctx, m.id)),

    removeMember: (
      _: unknown,
      { membershipId }: { membershipId: string },
      ctx: GraphQLContextWithServices
    ) =>
      ctx.services.clubManagementService
        .removeMember(requireUser(ctx), membershipId)
        .then((m) => reloadMember(ctx, m.id)),

    createClubSession: (
      _: unknown,
      {
        clubId,
        input,
      }: { clubId: string; input: { title: string; startsAt: string; location?: string } },
      ctx: GraphQLContextWithServices
    ) =>
      ctx.services.clubManagementService
        .createSession(requireUser(ctx), clubId, {
          ...input,
          startsAt: new Date(input.startsAt),
        })
        .then(withEmptyCounts),

    updateClubSession: (
      _: unknown,
      {
        sessionId,
        input,
      }: {
        sessionId: string;
        input: { title?: string; startsAt?: string; location?: string; status?: string };
      },
      ctx: GraphQLContextWithServices
    ) =>
      ctx.services.clubManagementService
        .updateSession(requireUser(ctx), sessionId, {
          title: input.title,
          location: input.location,
          status: input.status,
          // The DateTime scalar hands back a Date on the way in, but the
          // resolver's declared arg type is the wire shape. Narrow explicitly
          // rather than spreading a union into a Date field.
          startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        })
        .then(withEmptyCounts),

    markAttendance: async (
      _: unknown,
      {
        sessionId,
        entries,
      }: { sessionId: string; entries: { userId: string; state: string }[] },
      ctx: GraphQLContextWithServices
    ) => {
      const userId = requireUser(ctx);
      await ctx.services.clubManagementService.markAttendance(userId, sessionId, entries);
      // Re-read through the list path so the returned counts are the stored
      // ones rather than a recount of the request body.
      const view = await ctx.services.clubManagementService.sessionRegister(
        userId,
        sessionId
      );
      return {
        ...view.session,
        presentCount: view.rows.filter((r) => r.state === "PRESENT").length,
        excusedCount: view.rows.filter((r) => r.state === "EXCUSED").length,
        absentCount: view.rows.filter((r) => r.state === "ABSENT").length,
      };
    },

    submitTeamSheet: (
      _: unknown,
      {
        fixtureId,
        boards,
      }: { fixtureId: string; boards: { boardNumber: number; userId: string }[] },
      ctx: GraphQLContextWithServices
    ) =>
      ctx.services.matchDayService
        .submitTeamSheet(requireUser(ctx), fixtureId, boards)
        .then(toMatchDayFixture),

    recordBoardResult: (
      _: unknown,
      {
        input,
      }: {
        input: {
          fixtureId: string;
          boardNumber: number;
          result: string;
          moveCount?: number;
          scoresheetUrl?: string;
        };
      },
      ctx: GraphQLContextWithServices
    ) =>
      ctx.services.matchDayService
        .recordBoardResult(requireUser(ctx), input as never)
        .then(toMatchDayFixture),

    validateFixture: (
      _: unknown,
      { fixtureId }: { fixtureId: string },
      ctx: GraphQLContextWithServices
    ) =>
      ctx.services.matchDayService
        .validateFixture(requireUser(ctx), fixtureId)
        .then(toMatchDayFixture),
  },
};

/** A session that has no register yet still has to satisfy the count fields. */
function withEmptyCounts<T extends object>(session: T) {
  return { ...session, presentCount: 0, excusedCount: 0, absentCount: 0 };
}

/** Mutations return the changed row re-read through the authorised list path. */
async function reloadMember(ctx: GraphQLContextWithServices, membershipId: string) {
  const row = await ctx.prisma.clubMembership.findUniqueOrThrow({
    where: { id: membershipId },
    select: { clubId: true },
  });
  const members = await ctx.services.clubManagementService.listMembers(
    ctx.user!.userId,
    row.clubId
  );
  return members.find((m) => m.id === membershipId)!;
}

type LoadedFixture = Awaited<
  ReturnType<GraphQLContextWithServices["services"]["matchDayService"]["submitTeamSheet"]>
>;

/** The service's row shape, mapped onto the SDL's `MatchDayFixture`. */
function toMatchDayFixture(fixture: LoadedFixture) {
  return {
    ...fixture,
    homeClub: clubSummary(fixture.homeClub),
    awayClub: clubSummary(fixture.awayClub),
    boards: fixture.boards.map((b) => ({
      ...b,
      homeName: null,
      awayName: null,
    })),
  };
}
