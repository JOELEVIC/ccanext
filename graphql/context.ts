import type { UserService } from "@/domains/user/user.service";
import type { GameService } from "@/domains/game/game.service";
import type { TournamentService } from "@/domains/tournament/tournament.service";
import type { LearningService } from "@/domains/learning/learning.service";
import type { InstitutionService } from "@/domains/institution/institution.service";
import type { ChallengeService } from "@/domains/challenge/challenge.service";
import type { PlacementService } from "@/domains/placement/placement.service";
import type { AdminService } from "@/domains/admin/admin.service";
import type { ActivityService } from "@/domains/activity/activity.service";
import type { TournamentRoundService } from "@/domains/tournament/round.service";
import type { ClubService } from "@/domains/club/club.service";
import type { SeasonService } from "@/domains/season/season.service";
import type { FixtureService } from "@/domains/fixture/fixture.service";
import type { EnquiryService } from "@/domains/enquiry/enquiry.service";
import { prisma } from "@/lib/prisma";
import { optionalAuthenticate, optionalAdminAuthenticate } from "@/lib/auth";
import type { AdminAuthContext } from "@/lib/auth";
import { UserService as UserServiceClass } from "@/domains/user/user.service";
import { GameService as GameServiceClass } from "@/domains/game/game.service";
import { TournamentService as TournamentServiceClass } from "@/domains/tournament/tournament.service";
import { LearningService as LearningServiceClass } from "@/domains/learning/learning.service";
import { InstitutionService as InstitutionServiceClass } from "@/domains/institution/institution.service";
import { ChallengeService as ChallengeServiceClass } from "@/domains/challenge/challenge.service";
import { PlacementService as PlacementServiceClass } from "@/domains/placement/placement.service";
import { AdminService as AdminServiceClass } from "@/domains/admin/admin.service";
import { ActivityService as ActivityServiceClass } from "@/domains/activity/activity.service";
import { TournamentRoundService as TournamentRoundServiceClass } from "@/domains/tournament/round.service";
import { ClubService as ClubServiceClass } from "@/domains/club/club.service";
import { SeasonService as SeasonServiceClass } from "@/domains/season/season.service";
import { FixtureService as FixtureServiceClass } from "@/domains/fixture/fixture.service";
import { EnquiryService as EnquiryServiceClass } from "@/domains/enquiry/enquiry.service";
import type { AuthContext } from "@/utils/types";
import { IdentityGate, prismaConsentReader } from "@/domains/user/identityGate";
import type { Viewer } from "@/domains/user/identityVisibility";

export interface GraphQLContextWithServices {
  user?: AuthContext;
  admin?: AdminAuthContext;
  /**
   * The caller's IP, for the `submitSchoolEnquiry` throttle only (BUILD_PLAN
   * §6). It is hashed the moment it reaches EnquiryService and is never stored,
   * logged or put in a URL. Undefined when no proxy header is present.
   */
  clientIp?: string;
  /**
   * BUILD_PLAN §4.3, enforced at the FIELD level on `User` and `Profile`.
   *
   * `User` and `Profile` are reachable from `user`, `users`, `school.students`,
   * `schoolLeaderboard`, `playersLeaderboard`, `liveGames`, tournament
   * participants and more — all unauthenticated. Gating those queries one by one
   * means the next public resolver that returns a `User` leaks by default. The
   * gate hangs off the two TYPES instead, so a new query inherits the rule for
   * free, and the SDL shape every existing client validates against is unchanged.
   *
   * Built from `user` (self) and `admin` (staff) above — see `identityVisibility.ts`
   * for why `user.role` is deliberately NOT consulted.
   */
  identity: IdentityGate;
  /**
   * The same two facts the `identity` gate is built from — "who is asking, and
   * are they staff?" — exposed for resolvers that must make the decision at the
   * QUERY level rather than the field level (`Query.users`, whose `search`
   * argument must not be allowed to match `email` for an unprivileged caller).
   *
   * Assembled once, here, so `isStaff` has exactly one definition: `admin`, the
   * separately-signed console token. Never `user.role`.
   */
  viewer: Viewer;
  prisma: typeof prisma;
  services: {
    userService: UserService;
    gameService: GameService;
    tournamentService: TournamentService;
    learningService: LearningService;
    institutionService: InstitutionService;
    challengeService: ChallengeService;
    placementService: PlacementService;
    adminService: AdminService;
    activityService: ActivityService;
    tournamentRoundService: TournamentRoundService;
    clubService: ClubService;
    seasonService: SeasonService;
    fixtureService: FixtureService;
    enquiryService: EnquiryService;
  };
}

/**
 * The client IP as the platform reports it. Vercel sets `x-forwarded-for`
 * (client first, then each proxy) and `x-real-ip`. Only the FIRST hop is used,
 * and only as throttle input — see the note on `clientIp` above.
 */
function clientIpFrom(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || undefined;
}

export async function buildContext(request: Request): Promise<GraphQLContextWithServices> {
  const [user, admin] = await Promise.all([
    optionalAuthenticate(request),
    optionalAdminAuthenticate(request),
  ]);

  const viewer: Viewer = { userId: user?.userId ?? null, isStaff: Boolean(admin) };

  return {
    user,
    admin,
    clientIp: clientIpFrom(request),
    identity: new IdentityGate(viewer, prismaConsentReader(prisma)),
    viewer,
    prisma,
    services: {
      userService: new UserServiceClass(prisma),
      gameService: new GameServiceClass(prisma),
      tournamentService: new TournamentServiceClass(prisma),
      learningService: new LearningServiceClass(prisma),
      institutionService: new InstitutionServiceClass(prisma),
      challengeService: new ChallengeServiceClass(prisma),
      placementService: new PlacementServiceClass(prisma),
      adminService: new AdminServiceClass(prisma),
      activityService: new ActivityServiceClass(prisma),
      tournamentRoundService: new TournamentRoundServiceClass(prisma),
      clubService: new ClubServiceClass(prisma),
      seasonService: new SeasonServiceClass(prisma),
      fixtureService: new FixtureServiceClass(prisma),
      enquiryService: new EnquiryServiceClass(prisma),
    },
  };
}
