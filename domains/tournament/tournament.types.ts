import type { TournamentStatus } from "@prisma/client";

export interface CreateTournamentDTO {
  name: string;
  schoolId: string;
  startDate: Date;
  endDate?: Date;
}

/** Admin create with full professional-tournament configuration. */
export interface AdminCreateTournamentDTO {
  name: string;
  schoolId: string;
  startDate: Date;
  endDate?: Date;
  format?: string; // ARENA | SWISS | ROUND_ROBIN | KNOCKOUT
  maxPlayers?: number;
  durationMinutes?: number;
  chessVariant?: string;
  arenaTimeControl?: string;
  totalRounds?: number;
  tiebreak?: string; // BUCHHOLZ | SONNEBORN_BERGER | NONE
  isRated?: boolean;
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
