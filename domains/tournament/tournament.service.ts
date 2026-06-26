import type { PrismaClient } from "@prisma/client";
import { TournamentStatus } from "@prisma/client";
import { TournamentRepository } from "./tournament.repository";
import type {
  CreateTournamentDTO,
  AdminCreateTournamentDTO,
  UpdateTournamentDTO,
  JoinTournamentDTO,
  TournamentFilters,
  TournamentStanding,
} from "./tournament.types";
import { ValidationError, NotFoundError } from "@/utils/types";

export class TournamentService {
  private tournamentRepository: TournamentRepository;

  constructor(private prisma: PrismaClient) {
    this.tournamentRepository = new TournamentRepository(prisma);
  }

  async createTournament(data: CreateTournamentDTO) {
    const school = await this.prisma.school.findUnique({
      where: { id: data.schoolId },
    });
    if (!school) throw new ValidationError("School not found");

    if (data.endDate && data.endDate < data.startDate)
      throw new ValidationError("End date must be after start date");

    return this.tournamentRepository.create(data);
  }

  /** Admin create with full configuration (no player context required). */
  async adminCreateTournament(data: AdminCreateTournamentDTO) {
    const school = await this.prisma.school.findUnique({
      where: { id: data.schoolId },
    });
    if (!school) throw new ValidationError("School not found");
    if (data.endDate && data.endDate < data.startDate)
      throw new ValidationError("End date must be after start date");
    const validFormats = ["ARENA", "SWISS", "ROUND_ROBIN", "KNOCKOUT"];
    if (data.format && !validFormats.includes(data.format))
      throw new ValidationError(`Invalid format: ${data.format}`);
    return this.tournamentRepository.createFull(data);
  }

  /** Seed a tournament by username (admin convenience). Returns the tournament. */
  async addParticipantByUsername(tournamentId: string, username: string) {
    const user = await this.prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
    });
    if (!user) throw new ValidationError(`No player found with username "${username}"`);
    return this.addParticipant({ tournamentId, userId: user.id });
  }

  /** Admin remove a participant; returns the refreshed tournament. */
  async adminRemoveParticipant(tournamentId: string, userId: string) {
    await this.removeParticipant(tournamentId, userId);
    return this.getTournamentById(tournamentId);
  }

  async cancelTournament(id: string) {
    const tournament = await this.getTournamentById(id);
    if (tournament.status === TournamentStatus.COMPLETED)
      throw new ValidationError("Cannot cancel a completed tournament");
    return this.tournamentRepository.update(id, {
      status: TournamentStatus.CANCELLED,
    });
  }

  async getTournamentById(id: string) {
    const tournament = await this.tournamentRepository.findById(id);
    if (!tournament) throw new NotFoundError("Tournament not found");
    return tournament;
  }

  async getTournaments(filters?: TournamentFilters) {
    return this.tournamentRepository.findMany(filters);
  }

  async getSchoolTournaments(schoolId: string) {
    return this.tournamentRepository.findBySchoolId(schoolId);
  }

  async updateTournament(id: string, data: UpdateTournamentDTO) {
    const tournament = await this.getTournamentById(id);
    if (tournament.status === TournamentStatus.COMPLETED)
      throw new ValidationError("Cannot update completed tournament");
    return this.tournamentRepository.update(id, data);
  }

  async addParticipant(data: JoinTournamentDTO) {
    const tournament = await this.getTournamentById(data.tournamentId);

    if (tournament.status !== TournamentStatus.UPCOMING)
      throw new ValidationError("Tournament is not accepting new participants");

    const user = await this.prisma.user.findUnique({
      where: { id: data.userId },
    });
    if (!user) throw new ValidationError("User not found");

    const existing = tournament.participants.find(
      (p: { userId: string }) => p.userId === data.userId
    );
    if (existing) throw new ValidationError("User is already a participant");

    await this.tournamentRepository.addParticipant(
      data.tournamentId,
      data.userId
    );
    return this.tournamentRepository.findById(data.tournamentId)!;
  }

  async removeParticipant(tournamentId: string, userId: string) {
    const tournament = await this.getTournamentById(tournamentId);
    if (tournament.status !== TournamentStatus.UPCOMING)
      throw new ValidationError(
        "Cannot remove participant from ongoing or completed tournament"
      );
    return this.tournamentRepository.removeParticipant(tournamentId, userId);
  }

  async startTournament(id: string) {
    const tournament = await this.getTournamentById(id);
    if (tournament.status !== TournamentStatus.UPCOMING)
      throw new ValidationError("Tournament has already started");
    if (tournament.participants.length < 2)
      throw new ValidationError("Tournament must have at least 2 participants");
    return this.tournamentRepository.update(id, {
      status: TournamentStatus.ONGOING,
    });
  }

  async updateStandings(tournamentId: string): Promise<TournamentStanding[]> {
    const tournament = await this.getTournamentById(tournamentId);
    const standings = new Map<
      string,
      { score: number; rating: number; username: string }
    >();

    tournament.participants.forEach((p: { userId: string; user: { rating: number; username: string } }) => {
      standings.set(p.userId, {
        score: 0,
        rating: p.user.rating,
        username: p.user.username,
      });
    });

    tournament.games.forEach((game: {
      status: string;
      result: string | null;
      whiteId: string;
      blackId: string;
    }) => {
      if (game.status === "COMPLETED" && game.result) {
        const whiteData = standings.get(game.whiteId);
        const blackData = standings.get(game.blackId);
        if (whiteData && blackData) {
          if (game.result === "WHITE_WIN") whiteData.score += 1;
          else if (game.result === "BLACK_WIN") blackData.score += 1;
          else if (game.result === "DRAW") {
            whiteData.score += 0.5;
            blackData.score += 0.5;
          }
        }
      }
    });

    await Promise.all(
      Array.from(standings.entries()).map(([userId, data]) =>
        this.tournamentRepository.updateParticipantScore(
          tournamentId,
          userId,
          data.score
        )
      )
    );

    return Array.from(standings.entries())
      .map(([userId, data]) => ({
        userId,
        username: data.username,
        score: data.score,
        rating: data.rating,
      }))
      .sort((a, b) => b.score - a.score || b.rating - a.rating);
  }

  async completeTournament(id: string) {
    const tournament = await this.getTournamentById(id);
    if (tournament.status !== TournamentStatus.ONGOING)
      throw new ValidationError("Only ongoing tournaments can be completed");
    await this.updateStandings(id);
    return this.tournamentRepository.update(id, {
      status: TournamentStatus.COMPLETED,
      endDate: new Date(),
    });
  }
}
