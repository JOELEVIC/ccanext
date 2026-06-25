import type { PrismaClient, Prisma } from "@prisma/client";
import { PlacementStatus } from "@prisma/client";

/** Data access for placement runs. Rating writes (player_ratings + users.rating)
 *  are done in the service inside a transaction. */
export class PlacementRepository {
  constructor(private prisma: PrismaClient) {}

  getActiveRun(userId: string) {
    return this.prisma.placementRun.findFirst({
      where: { userId, status: PlacementStatus.IN_PROGRESS },
      orderBy: { startedAt: "desc" },
    });
  }

  getRunById(id: string) {
    return this.prisma.placementRun.findUnique({ where: { id } });
  }

  createRun(userId: string, triggeredBy: string) {
    return this.prisma.placementRun.create({
      data: { userId, triggeredBy, status: PlacementStatus.IN_PROGRESS },
    });
  }

  saveProgress(id: string, gamesJson: Prisma.InputJsonValue) {
    return this.prisma.placementRun.update({
      where: { id },
      data: { gamesJson },
    });
  }

  /** Mark any in-progress runs for a user as abandoned (e.g. before a fresh start). */
  abandonActiveRuns(userId: string) {
    return this.prisma.placementRun.updateMany({
      where: { userId, status: PlacementStatus.IN_PROGRESS },
      data: { status: PlacementStatus.ABANDONED },
    });
  }

  listRunsForUser(userId: string) {
    return this.prisma.placementRun.findMany({
      where: { userId },
      orderBy: { startedAt: "desc" },
    });
  }
}
