import type { GameStatus, GameResult } from "@prisma/client";

export interface CreateGameDTO {
  whiteId: string;
  blackId: string;
  timeControl: string;
  tournamentId?: string;
}

export interface MakeMoveDTO {
  gameId: string;
  move: string;
  userId: string;
}

export interface UpdateGameDTO {
  moves?: string;
  status?: GameStatus;
  result?: GameResult;
}

export interface GameFilters {
  userId?: string;
  status?: GameStatus;
  tournamentId?: string;
}
