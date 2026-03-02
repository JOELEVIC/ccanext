export const typeDefs = `#graphql
  scalar DateTime

  enum UserRole {
    STUDENT
    COACH
    SCHOOL_ADMIN
    REGIONAL_ADMIN
    NATIONAL_ADMIN
    VOLUNTEER
  }

  enum GameStatus {
    PENDING
    ACTIVE
    COMPLETED
    ABANDONED
  }

  enum GameResult {
    WHITE_WIN
    BLACK_WIN
    DRAW
    STALEMATE
  }

  enum TournamentStatus {
    UPCOMING
    ONGOING
    COMPLETED
    CANCELLED
  }

  type User {
    id: ID!
    email: String!
    username: String!
    role: UserRole!
    rating: Int!
    profile: Profile
    school: School
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Profile {
    id: ID!
    userId: ID!
    firstName: String!
    lastName: String!
    dateOfBirth: DateTime
    country: String!
    xp: Int!
    level: Int!
    puzzleStreakCount: Int!
    lastPuzzleSolvedAt: DateTime
    badges: [Badge!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type School {
    id: ID!
    name: String!
    region: String!
    students: [User!]!
    tournaments: [Tournament!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Game {
    id: ID!
    white: User!
    black: User!
    moves: String!
    status: GameStatus!
    result: GameResult
    timeControl: String!
    tournament: Tournament
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type Tournament {
    id: ID!
    name: String!
    school: School!
    startDate: DateTime!
    endDate: DateTime
    status: TournamentStatus!
    participants: [TournamentParticipant!]!
    games: [Game!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type TournamentParticipant {
    id: ID!
    user: User!
    score: Float!
    createdAt: DateTime!
  }

  type Puzzle {
    id: ID!
    fen: String!
    solution: String!
    difficulty: Int!
    theme: [String!]!
    createdAt: DateTime!
  }

  type Badge {
    id: ID!
    name: String!
    description: String!
    earnedAt: DateTime!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type LeaderboardEntry {
    user: User!
    gamesPlayed: Int!
  }

  type SchoolStats {
    totalStudents: Int!
    averageRating: Float!
    totalGames: Int!
    activeTournaments: Int!
  }

  type PuzzleSolutionResult {
    correct: Boolean!
    solution: String!
    xpAwarded: Int
    streakAfter: Int
  }

  type GameXpResult {
    xpAwarded: Int!
  }

  input RegisterInput {
    email: String!
    username: String!
    password: String!
    role: UserRole!
    schoolId: ID
    firstName: String
    lastName: String
  }

  input LoginInput {
    email: String!
    password: String!
  }

  input UpdateProfileInput {
    firstName: String
    lastName: String
    dateOfBirth: DateTime
    country: String
  }

  input CreateGameInput {
    whiteId: ID!
    blackId: ID!
    timeControl: String!
    tournamentId: ID
  }

  input CreateTournamentInput {
    name: String!
    schoolId: ID!
    startDate: DateTime!
    endDate: DateTime
  }

  input CreateSchoolInput {
    name: String!
    region: String!
  }

  input UserFilters {
    role: UserRole
    schoolId: ID
    search: String
  }

  type DebugDbInfo {
    databaseUrlRedacted: String!
    host: String!
    user: String!
    isPooler: Boolean!
    vercel: Boolean!
  }

  type Query {
    debugDb: DebugDbInfo!
    me: User
    user(id: ID!): User
    users(filters: UserFilters): [User!]!

    game(id: ID!): Game
    myGames(status: GameStatus): [Game!]!
    liveGames: [Game!]!

    tournament(id: ID!): Tournament
    schoolTournaments(schoolId: ID!): [Tournament!]!
    tournaments(status: TournamentStatus): [Tournament!]!

    school(id: ID!): School
    schools: [School!]!
    schoolsByRegion(region: String!): [School!]!
    schoolLeaderboard(schoolId: ID!): [LeaderboardEntry!]!
    schoolStats(schoolId: ID!): SchoolStats!

    dailyPuzzle: Puzzle
    puzzles(difficulty: Int): [Puzzle!]!
    puzzle(id: ID!): Puzzle
  }

  type Mutation {
    register(input: RegisterInput!): AuthPayload!
    login(input: LoginInput!): AuthPayload!
    updateProfile(input: UpdateProfileInput!): Profile!

    createGame(input: CreateGameInput!): Game!
    makeMove(gameId: ID!, move: String!): Game!
    resignGame(gameId: ID!): Game!
    recordGameCompleted(gameId: ID!): GameXpResult!

    createTournament(input: CreateTournamentInput!): Tournament!
    joinTournament(tournamentId: ID!): Tournament!
    startTournament(tournamentId: ID!): Tournament!
    completeTournament(tournamentId: ID!): Tournament!

    createSchool(input: CreateSchoolInput!): School!

    checkPuzzleSolution(puzzleId: ID!, solution: String!): PuzzleSolutionResult!
  }
`;
