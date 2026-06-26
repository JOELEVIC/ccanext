import type { UserService } from "@/domains/user/user.service";
import type { GameService } from "@/domains/game/game.service";
import type { TournamentService } from "@/domains/tournament/tournament.service";
import type { LearningService } from "@/domains/learning/learning.service";
import type { InstitutionService } from "@/domains/institution/institution.service";
import type { ChallengeService } from "@/domains/challenge/challenge.service";
import type { PlacementService } from "@/domains/placement/placement.service";
import type { AdminService } from "@/domains/admin/admin.service";
import type { ActivityService } from "@/domains/activity/activity.service";
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
import type { AuthContext } from "@/utils/types";

export interface GraphQLContextWithServices {
  user?: AuthContext;
  admin?: AdminAuthContext;
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
  };
}

export async function buildContext(request: Request): Promise<GraphQLContextWithServices> {
  const [user, admin] = await Promise.all([
    optionalAuthenticate(request),
    optionalAdminAuthenticate(request),
  ]);

  return {
    user,
    admin,
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
    },
  };
}
