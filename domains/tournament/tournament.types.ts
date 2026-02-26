import type { TournamentStatus } from "@prisma/client";

export interface CreateTournamentDTO {
  name: string;
  schoolId: string;
  startDate: Date;
  endDate?: Date;
}

export interface UpdateTournamentDTO {
  name?: string;
  startDate?: Date;
  endDate?: Date;
  status?: TournamentStatus;
}

export interface JoinTournamentDTO {
  tournamentId: string;
  userId: string;
}

export interface TournamentFilters {
  schoolId?: string;
  status?: TournamentStatus;
}

export interface TournamentStanding {
  userId: string;
  username: string;
  score: number;
  rating: number;
}
