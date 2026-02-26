import type { UserService } from "@/domains/user/user.service";
import type { GameService } from "@/domains/game/game.service";
import type { TournamentService } from "@/domains/tournament/tournament.service";
import type { LearningService } from "@/domains/learning/learning.service";
import type { InstitutionService } from "@/domains/institution/institution.service";
import { prisma } from "@/lib/prisma";
import { optionalAuthenticate } from "@/lib/auth";
import { UserService as UserServiceClass } from "@/domains/user/user.service";
import { GameService as GameServiceClass } from "@/domains/game/game.service";
import { TournamentService as TournamentServiceClass } from "@/domains/tournament/tournament.service";
import { LearningService as LearningServiceClass } from "@/domains/learning/learning.service";
import { InstitutionService as InstitutionServiceClass } from "@/domains/institution/institution.service";
import type { AuthContext } from "@/utils/types";

export interface GraphQLContextWithServices {
  user?: AuthContext;
  prisma: typeof prisma;
  services: {
    userService: UserService;
    gameService: GameService;
    tournamentService: TournamentService;
    learningService: LearningService;
    institutionService: InstitutionService;
  };
}

export async function buildContext(request: Request): Promise<GraphQLContextWithServices> {
  const user = await optionalAuthenticate(request);

  return {
    user,
    prisma,
    services: {
      userService: new UserServiceClass(prisma),
      gameService: new GameServiceClass(prisma),
      tournamentService: new TournamentServiceClass(prisma),
      learningService: new LearningServiceClass(prisma),
      institutionService: new InstitutionServiceClass(prisma),
    },
  };
}
