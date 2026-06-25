import type { PrismaClient, Prisma } from "@prisma/client";
import { PlacementStatus } from "@prisma/client";
import { PlacementRepository } from "./placement.repository";
import {
  estimatePlacement,
  type PlacementGameResult,
} from "./estimator";
import { ValidationError, NotFoundError, AuthorizationError } from "@/utils/types";

/** Minimum evidence before we accept a placement and overwrite the rating. */
const MIN_GAMES = 3;
const MIN_TOTAL_MOVES = 30;
/** Volatility reset for a freshly-placed player. */
const PLACED_VOL = 0.06;

export interface PlacementGameInput {
  botId: string;
  botElo: number;
  color: string; // "w" | "b"
  score: number; // 1 | 0.5 | 0  (user perspective)
  moves?: string | null; // raw SAN/UCI for audit
  userMoves: { cpLoss: number; accuracy: number; complexity?: number | null }[];
}

export interface PlacementStatusResult {
  required: boolean;
  completedAt: Date | null;
  activeRunId: string | null;
}

export class PlacementService {
  private repo: PlacementRepository;

  constructor(private prisma: PrismaClient) {
    this.repo = new PlacementRepository(prisma);
  }

  async getStatus(userId: string): Promise<PlacementStatusResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { placementRequired: true, placementCompletedAt: true },
    });
    if (!user) throw new NotFoundError("User not found");
    const active = await this.repo.getActiveRun(userId);
    return {
      required: user.placementRequired,
      completedAt: user.placementCompletedAt,
      activeRunId: active?.id ?? null,
    };
  }

  /** Get the in-progress run, or create one. Resumable: refreshing returns the same run. */
  async start(userId: string, triggeredBy = "self") {
    const existing = await this.repo.getActiveRun(userId);
    if (existing) return existing;
    return this.repo.createRun(userId, triggeredBy);
  }

  /** Persist ladder progress so a refresh mid-placement resumes exactly where it left off. */
  async saveProgress(userId: string, runId: string, games: PlacementGameInput[]) {
    const run = await this.requireOwnedActiveRun(userId, runId);
    await this.repo.saveProgress(run.id, games as unknown as Prisma.InputJsonValue);
    return this.repo.getRunById(run.id);
  }

  /**
   * Finalize: compute the fused estimate, OVERWRITE the player's rating, mark the
   * run COMPLETE, and clear placementRequired. Idempotent against a finished run.
   */
  async submit(userId: string, runId: string, games: PlacementGameInput[]) {
    const run = await this.requireOwnedActiveRun(userId, runId);

    if (games.length < MIN_GAMES) {
      throw new ValidationError(
        `Placement needs at least ${MIN_GAMES} games (got ${games.length}).`
      );
    }
    const totalMoves = games.reduce((s, g) => s + (g.userMoves?.length ?? 0), 0);
    if (totalMoves < MIN_TOTAL_MOVES) {
      throw new ValidationError(
        `Not enough analysed moves to place reliably (got ${totalMoves}).`
      );
    }

    const estimate = estimatePlacement(games.map(toEstimatorGame));

    // Overwrite rating + finalize, atomically.
    await this.prisma.$transaction([
      this.prisma.playerRating.upsert({
        where: { userId },
        create: {
          userId,
          rating: estimate.rating,
          deviation: estimate.rd,
          volatility: PLACED_VOL,
        },
        update: {
          rating: estimate.rating,
          deviation: estimate.rd,
          volatility: PLACED_VOL,
        },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: {
          rating: estimate.rating,
          placementRequired: false,
          placementCompletedAt: new Date(),
        },
      }),
      this.prisma.placementRun.update({
        where: { id: run.id },
        data: {
          status: PlacementStatus.COMPLETE,
          estimatedRating: estimate.rating,
          estimatedRd: estimate.rd,
          confidence: estimate.confidence,
          gamesJson: games as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      }),
    ]);

    return { estimate, newRating: estimate.rating };
  }

  /**
   * Admin re-trigger: require placement again for a user. Abandons any in-progress
   * run so a clean one starts, and flips placementRequired back on. The next
   * completed placement overwrites the current rating.
   */
  async triggerForUser(userId: string, adminId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError("User not found");
    await this.repo.abandonActiveRuns(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { placementRequired: true, placementCompletedAt: null },
    });
    // Pre-create the run tagged with the triggering admin (audit trail).
    return this.repo.createRun(userId, `admin:${adminId}`);
  }

  listRunsForUser(userId: string) {
    return this.repo.listRunsForUser(userId);
  }

  private async requireOwnedActiveRun(userId: string, runId: string) {
    const run = await this.repo.getRunById(runId);
    if (!run) throw new NotFoundError("Placement run not found");
    if (run.userId !== userId) throw new AuthorizationError("Not your placement run");
    if (run.status !== PlacementStatus.IN_PROGRESS) {
      throw new ValidationError("Placement run is already finished");
    }
    return run;
  }
}

function toEstimatorGame(g: PlacementGameInput): PlacementGameResult {
  return {
    botId: g.botId,
    botElo: g.botElo,
    color: g.color === "b" ? "b" : "w",
    score: g.score,
    userMoves: (g.userMoves ?? []).map((m) => ({
      cpLoss: m.cpLoss,
      accuracy: m.accuracy,
      complexity: m.complexity ?? undefined,
    })),
  };
}
