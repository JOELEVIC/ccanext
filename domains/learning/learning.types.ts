export interface CreatePuzzleDTO {
  fen: string;
  solution: string;
  difficulty: number;
  theme: string[];
}

export interface PuzzleFilters {
  difficulty?: number;
  theme?: string;
}

export interface CheckSolutionDTO {
  puzzleId: string;
  userSolution: string;
}

export interface BadgeDTO {
  name: string;
  description: string;
  profileId: string;
}
