export interface CreateSchoolDTO {
  name: string;
  region: string;
}

export interface UpdateSchoolDTO {
  name?: string;
  region?: string;
}

export interface SchoolStats {
  totalStudents: number;
  averageRating: number;
  totalGames: number;
  activeTournaments: number;
}

export interface LeaderboardEntry {
  user: Record<string, unknown>;
  gamesPlayed: number;
}
