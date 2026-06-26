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

  enum ChessVariant {
    ULTRABULLET
    BULLET
    BLITZ
    RAPID
    CLASSIC
    CRAZYHOUSE
    CHESS960
    KOTH
    THREECHECK
    ANTICHESS
    ATOMIC
    HORDE
    RACING_KINGS
  }

  type User {
    id: ID!
    email: String!
    username: String!
    role: UserRole!
    rating: Int!
    profile: Profile
    school: School
    variantRatings: [UserVariantRating!]!
    totalGamesPlayed: Int!
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
    chessTitle: String
    avatarUrl: String
    followerCount: Int!
    friendCount: Int!
    ratingTrend: [Int!]!
    xp: Int!
    level: Int!
    puzzleStreakCount: Int!
    lastPuzzleSolvedAt: DateTime
    badges: [Badge!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type UserVariantRating {
    variant: ChessVariant!
    rating: Int!
    ratingDelta: Int!
    gamesPlayed: Int!
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
    rated: Boolean!
    whiteRating: Int
    blackRating: Int
    analysisJson: String
    tournament: Tournament
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  enum ChallengeStatus {
    OPEN
    ACCEPTED
    DECLINED
    CANCELLED
    EXPIRED
  }

  type Challenge {
    id: ID!
    creator: User!
    "Null for an open invite link that anyone signed-in can accept."
    opponent: User
    creatorColor: String!
    timeControl: String!
    rated: Boolean!
    status: ChallengeStatus!
    game: Game
    expiresAt: DateTime
    createdAt: DateTime!
  }

  input CreateChallengeInput {
    "Omit for an open invite link; provide to challenge a specific player."
    opponentId: ID
    creatorColor: String!
    timeControl: String!
    rated: Boolean!
  }

  type Tournament {
    id: ID!
    name: String!
    school: School!
    startDate: DateTime!
    endDate: DateTime
    status: TournamentStatus!
    chessVariant: String!
    arenaTimeControl: String!
    format: String!
    maxPlayers: Int!
    durationMinutes: Int!
    cardColor: String!
    isSponsored: Boolean!
    isRated: Boolean!
    iconType: String
    prizePoolJson: String
    currentPlayers: Int!
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

  type PlatformMetrics {
    playersTotal: Int!
    playingNow: Int!
  }

  type PlayersLeaderboardRow {
    rank: Int!
    user: User!
    rating: Int!
    gamesPlayed: Int!
    ratingTrend: [Int!]!
  }

  type RatingBucket {
    ratingMin: Int!
    ratingMax: Int!
    count: Int!
  }

  type RadarSkills {
    sacrifice: Float!
    endgame: Float!
    positional: Float!
    matingAttack: Float!
    tactics: Float!
    opening: Float!
  }

  type PuzzleDashboard {
    periodDays: Int!
    solvedCount: Int!
    performanceRating: Int!
    successRate: Float!
    radar: RadarSkills!
  }

  type LearnCourse {
    id: ID!
    slug: String!
    title: String!
    category: String!
    sortOrder: Int!
    completed: Boolean!
    bookmarked: Boolean!
  }

  type MeTournamentStats {
    totalJoined: Int!
    breakdown: [VariantCount!]!
  }

  type VariantCount {
    variant: String!
    count: Int!
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

  input AdminCreateTournamentInput {
    name: String!
    schoolId: ID!
    startDate: DateTime!
    endDate: DateTime
    format: String # ARENA | SWISS | ROUND_ROBIN | KNOCKOUT
    maxPlayers: Int
    durationMinutes: Int
    chessVariant: String
    arenaTimeControl: String
    totalRounds: Int
    tiebreak: String # BUCHHOLZ | SONNEBORN_BERGER | NONE
    isRated: Boolean
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

    platformMetrics: PlatformMetrics!
    playersLeaderboard(limit: Int): [PlayersLeaderboardRow!]!
    ratingDistribution: [RatingBucket!]!
    soonestTournaments(limit: Int): [Tournament!]!
    tournamentSchedule(
      rangeStart: DateTime!
      rangeEnd: DateTime!
      search: String
      chessVariant: String
      joinedOnly: Boolean
    ): [Tournament!]!

    puzzleDashboard: PuzzleDashboard
    learnCourses: [LearnCourse!]!
    meTournamentStats: MeTournamentStats

    game(id: ID!): Game
    myGames(status: GameStatus): [Game!]!
    liveGames: [Game!]!

    "A single challenge by id (for an invite link's accept page)."
    challenge(id: ID!): Challenge
    "Open challenges I sent or that are addressed to me."
    myChallenges: [Challenge!]!
    "Public open invites anyone can accept (excludes my own)."
    openChallenges: [Challenge!]!

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

    "Server-side chess engine — pure-JS negamax. Best-move in UCI form."
    engineBestMove(fen: String!, elo: Int): String
    "Server-side chess engine evaluation (centipawns from white's perspective, or mate-in-N)."
    engineEvaluation(fen: String!): EngineEvaluation
  }

  type EngineEvaluation {
    cp: Int
    mate: Int
  }

  type Mutation {
    register(input: RegisterInput!): AuthPayload!
    login(input: LoginInput!): AuthPayload!
    "Sign in or sign up with a Google ID token from Google Identity Services."
    loginWithGoogle(idToken: String!): AuthPayload!
    updateProfile(input: UpdateProfileInput!): Profile!

    createGame(input: CreateGameInput!): Game!
    makeMove(gameId: ID!, move: String!): Game!
    resignGame(gameId: ID!): Game!
    cancelGame(gameId: ID!): Game!
    "Finalize a live game decided on the gameplay server: persist result/moves + apply Glicko-2 ratings. A null result aborts (voids) the game. Idempotent."
    recordGameResult(gameId: ID!, result: GameResult, reason: String, moves: String): Game!
    recordGameCompleted(gameId: ID!): GameXpResult!

    "Create a challenge — direct (with opponentId) or an open invite link."
    createChallenge(input: CreateChallengeInput!): Challenge!
    "Accept an open challenge: creates the game and returns it."
    acceptChallenge(challengeId: ID!): Game!
    declineChallenge(challengeId: ID!): Challenge!
    cancelChallenge(challengeId: ID!): Challenge!

    createTournament(input: CreateTournamentInput!): Tournament!
    joinTournament(tournamentId: ID!): Tournament!
    startTournament(tournamentId: ID!): Tournament!
    completeTournament(tournamentId: ID!): Tournament!

    # Admin tournament management (admin token required)
    adminCreateTournament(input: AdminCreateTournamentInput!): Tournament!
    adminAddParticipant(tournamentId: ID!, username: String!): Tournament!
    adminRemoveParticipant(tournamentId: ID!, userId: ID!): Tournament!
    adminCancelTournament(tournamentId: ID!): Tournament!

    createSchool(input: CreateSchoolInput!): School!

    checkPuzzleSolution(puzzleId: ID!, solution: String!): PuzzleSolutionResult!
  }

  # ===========================================================================
  # PLACEMENT (auto-rating) — player-facing
  # ===========================================================================
  type PlacementStatus {
    required: Boolean!
    completedAt: DateTime
    activeRunId: ID
  }

  type PlacementRun {
    id: ID!
    status: String!
    startedAt: DateTime!
  }

  type PlacementEstimate {
    rating: Int!
    rd: Int!
    confidence: Int!
    resultRating: Int!
    moveRating: Int!
    acplRating: Int!
    accuracyRating: Int!
    weightedAcpl: Float!
    meanAccuracy: Float!
    totalUserMoves: Int!
    gamesScored: Int!
  }

  type PlacementSubmitResult {
    estimate: PlacementEstimate!
    newRating: Int!
  }

  input PlacementMoveInput {
    cpLoss: Float!
    accuracy: Float!
    complexity: Float
  }

  input PlacementGameInput {
    botId: String!
    botElo: Int!
    color: String!
    score: Float!
    moves: String
    userMoves: [PlacementMoveInput!]!
  }

  # ===========================================================================
  # ADMIN — separate admin_users auth; gated by the admin token
  # ===========================================================================
  enum AdminRole {
    ROOT
    ADMIN
  }

  type AdminUser {
    id: ID!
    email: String!
    role: AdminRole!
    addedById: ID
    lastLoginAt: DateTime
    createdAt: DateTime!
    pending: Boolean!
  }

  type AdminAuthPayload {
    token: String!
    admin: AdminUser!
  }

  type AdminCount { label: String!  count: Int! }
  type AdminDayCount { day: String!  count: Int! }
  type AdminUserMini { id: ID!  username: String! }
  type AdminTopPlayer { id: ID!  username: String!  rating: Int!  placementRequired: Boolean! }
  type AdminRecentUser { id: ID!  username: String!  email: String!  rating: Int!  createdAt: DateTime!  placementRequired: Boolean! }
  type AdminUsersStat { total: Int!  newLast7: Int!  newLast30: Int! }
  type AdminPlacementStat { required: Int!  completed: Int!  inProgress: Int! }
  type AdminGamesStat { total: Int!  pending: Int!  active: Int!  completed: Int!  abandoned: Int! }

  type AdminOverview {
    users: AdminUsersStat!
    placement: AdminPlacementStat!
    games: AdminGamesStat!
    ratingDistribution: [AdminCount!]!
    signupsByDay: [AdminDayCount!]!
    topPlayers: [AdminTopPlayer!]!
    recentUsers: [AdminRecentUser!]!
  }

  type AdminUserRow {
    id: ID!  username: String!  email: String!  role: UserRole!  rating: Int!
    placementRequired: Boolean!  placementCompletedAt: DateTime  createdAt: DateTime!
  }

  type AdminUserList {
    items: [AdminUserRow!]!
    total: Int!
    limit: Int!
    offset: Int!
  }

  type AdminPlayerRating { rating: Float!  deviation: Float!  volatility: Float!  updatedAt: DateTime! }
  type AdminProfileLite { firstName: String!  lastName: String!  country: String! }

  type AdminUserDetailUser {
    id: ID!  username: String!  email: String!  role: UserRole!  rating: Int!
    placementRequired: Boolean!  placementCompletedAt: DateTime  createdAt: DateTime!
    playerRating: AdminPlayerRating
    profile: AdminProfileLite
  }

  type AdminPlacementRun {
    id: ID!  status: String!  estimatedRating: Int  estimatedRd: Int  confidence: Float
    triggeredBy: String!  startedAt: DateTime!  completedAt: DateTime
  }

  type AdminGameRow {
    id: ID!  status: String!  result: String  rated: Boolean!  timeControl: String!  createdAt: DateTime!
    white: AdminUserMini!  black: AdminUserMini!
  }

  type AdminUserDetail {
    user: AdminUserDetailUser!
    placementRuns: [AdminPlacementRun!]!
    recentGames: [AdminGameRow!]!
  }

  type AdminRemoveResult { removedId: ID! }
  type AdminTriggerResult { ok: Boolean!  runId: ID! }
  type AdminOverrideResult { ok: Boolean!  rating: Int! }

  # Step 1 of the two-step login. mode = "SET_PASSWORD" (provisioned admin, no
  # password yet → first-time setup) or "PASSWORD" (normal prompt).
  type AdminAuthStage { email: String!  mode: String! }

  extend type Query {
    placementStatus: PlacementStatus!
    adminMe: AdminUser
    adminAuthStage(email: String!): AdminAuthStage!
    adminOverview: AdminOverview!
    adminUsers(search: String, limit: Int, offset: Int): AdminUserList!
    adminUser(userId: ID!): AdminUserDetail!
    adminAdmins: [AdminUser!]!
  }

  extend type Mutation {
    startPlacement: PlacementRun!
    savePlacementProgress(runId: ID!, games: [PlacementGameInput!]!): PlacementRun!
    submitPlacement(runId: ID!, games: [PlacementGameInput!]!): PlacementSubmitResult!
    adminLogin(email: String!, password: String!): AdminAuthPayload!
    adminAddAdmin(email: String!): AdminUser!
    adminRemoveAdmin(adminId: ID!): AdminRemoveResult!
    adminTriggerPlacement(userId: ID!): AdminTriggerResult!
    adminOverrideRating(userId: ID!, rating: Int!): AdminOverrideResult!
  }

  # ===========================================================================
  # COMMUNITY ACTIVITIES — public feed + admin CRUD
  # ===========================================================================
  enum ActivityType {
    ANNOUNCEMENT
    EVENT_RECAP
    ARTICLE
    GALLERY
    RESULT
  }
  enum ActivityStatus {
    DRAFT
    PUBLISHED
    ARCHIVED
  }

  type ActivityImage {
    id: ID!
    url: String!
    caption: String
    sortOrder: Int!
  }

  type Activity {
    id: ID!
    slug: String!
    type: ActivityType!
    title: String!
    excerpt: String
    bodyJson: String # JSON-serialized Tiptap document
    bodyText: String
    coverImageUrl: String
    videoEmbedUrl: String
    region: String
    tags: [String!]!
    status: ActivityStatus!
    featured: Boolean!
    eventDate: DateTime
    publishedAt: DateTime
    images: [ActivityImage!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type ActivityFeed {
    items: [Activity!]!
    total: Int!
    limit: Int!
    offset: Int!
  }

  input ActivityImageInput {
    url: String!
    caption: String
  }

  input ActivityInput {
    type: ActivityType
    title: String!
    excerpt: String
    bodyJson: String # JSON string of the Tiptap document
    bodyText: String
    coverImageUrl: String
    videoEmbedUrl: String
    region: String
    tags: [String!]
    eventDate: DateTime
    featured: Boolean
    images: [ActivityImageInput!]
  }

  extend type Query {
    activities(type: ActivityType, region: String, limit: Int, offset: Int): ActivityFeed!
    activity(slug: String!): Activity
    adminActivities(status: ActivityStatus, search: String, limit: Int, offset: Int): ActivityFeed!
    adminActivity(id: ID!): Activity!
  }

  extend type Mutation {
    adminCreateActivity(input: ActivityInput!): Activity!
    adminUpdateActivity(id: ID!, input: ActivityInput!): Activity!
    adminPublishActivity(id: ID!): Activity!
    adminUnpublishActivity(id: ID!): Activity!
    adminArchiveActivity(id: ID!): Activity!
    adminDeleteActivity(id: ID!): AdminRemoveResult!
  }

  # ===========================================================================
  # TOURNAMENT ROUNDS / PAIRINGS / STANDINGS (pro engine)
  # ===========================================================================
  type TournamentPairing {
    id: ID!
    boardNumber: Int!
    whiteUserId: String
    blackUserId: String
    gameId: String
    result: String # "1-0" | "0-1" | "1/2-1/2" | "bye" | null
  }

  type TournamentRound {
    id: ID!
    number: Int!
    status: String! # PENDING | ONGOING | COMPLETED
    startedAt: DateTime
    completedAt: DateTime
    pairings: [TournamentPairing!]!
  }

  type TournamentStanding {
    rank: Int!
    userId: ID!
    username: String!
    rating: Int!
    score: Float!
    buchholz: Float!
    sonnebornBerger: Float!
    byes: Int!
    withdrawn: Boolean!
  }

  extend type Query {
    tournamentRounds(tournamentId: ID!): [TournamentRound!]!
    tournamentStandings(tournamentId: ID!): [TournamentStanding!]!
  }

  extend type Mutation {
    adminTournamentStartRound(tournamentId: ID!): TournamentRound!
    adminTournamentRecordResult(pairingId: ID!, result: String!): TournamentPairing!
    adminTournamentCompleteRound(roundId: ID!): TournamentRound!
    adminTournamentFinalize(tournamentId: ID!): [TournamentStanding!]!
  }
`;
