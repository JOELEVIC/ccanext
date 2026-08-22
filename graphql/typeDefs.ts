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
    """
    Null for everyone but the account owner and academy staff (BUILD_PLAN §4.3).
    Nullable rather than removed on purpose: deleting the field would fail
    validation for every client query that already selects it, whereas a null
    simply redacts. The me query and the admin console are unaffected.
    """
    email: String
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

  """
  A person's own profile. Reachable from User, which every public query returns,
  so the PII on it is guarded field by field in domains/user/identityGate.ts:
  lastName reduces to the §4.3 initial, dateOfBirth and avatarUrl go null, and
  firstName stays whole so the pair renders "Brenda A.".
  """
  type Profile {
    id: ID!
    userId: ID!
    firstName: String!
    "Reduced to the initial form — Ateba becomes A. — for a non-consented minor. BUILD_PLAN §4.3."
    lastName: String!
    "Null for everyone but the account owner and academy staff. Consent INPUT, never an output."
    dateOfBirth: DateTime
    country: String!
    chessTitle: String
    "Null when the name is reduced: the photograph travels with the name (§4.3)."
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
    "BUILD_PLAN §3.2 additions. A school may host more than one club."
    slug: String
    kind: SchoolKind!
    town: String
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
    "Club join code (BUILD_PLAN §6). Creates a PENDING membership; the patron admits."
    joinCode: String
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

  type Query {
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
    adminAddParticipantById(tournamentId: ID!, userId: ID!): Tournament!
    adminRemoveParticipant(tournamentId: ID!, userId: ID!): Tournament!
    adminCancelTournament(tournamentId: ID!): Tournament!

    createSchool(input: CreateSchoolInput!): School!
    adminCreateSchool(input: CreateSchoolInput!): School!
    adminUpdateSchool(id: ID!, input: CreateSchoolInput!): School!

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
  type AdminUsernameResult { id: ID!  username: String! }

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
    adminUpdateUsername(userId: ID!, username: String!): AdminUsernameResult!
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
    thumbUrl: String
    width: Int
    height: Int
    highlight: Boolean!
    caption: String
    sortOrder: Int!
  }

  type Activity {
    id: ID!
    slug: String!
    "Club news feed (BUILD_PLAN §3.2). null = an academy-level post."
    clubId: ID
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
    "Curated subset for landing/feed collages (highlight-flagged, capped at 12)."
    highlights: [ActivityImage!]!
    photoCount: Int!
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
    thumbUrl: String
    width: Int
    height: Int
    highlight: Boolean
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
    activities(clubId: ID, type: ActivityType, region: String, limit: Int, offset: Int): ActivityFeed!
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
  # ===========================================================================
  # CLUBS · SEASONS · COMPETITION · INTAKE — the Phase 1 public surface
  # BUILD_PLAN §6. Every query here is public, unauthenticated and cacheable,
  # except schoolEnquiries, which is staff-only.
  #
  # TWO RULES THIS BLOCK ENFORCES BY SHAPE RATHER THAN BY CONVENTION:
  #
  #   • Club HAS NO joinCode FIELD. Not hidden by a resolver — absent from
  #     the type, and never SELECTed on any public read path
  #     (domains/club/club.select.ts). BUILD_PLAN §3.3 #6.
  #
  #   • EVERY PERSON IS A PublicPlayer, NEVER A User. PublicPlayer is
  #     produced only by toPublicPlayer() (§4.3), so no client — however it
  #     queries — can render a non-consented minor's full name or avatar.
  # ===========================================================================

  enum SchoolKind {
    SECONDARY
    UNIVERSITY
  }

  enum ClubLevel {
    SECONDARY
    UNIVERSITY
  }

  enum ClubStatus {
    ONBOARDING
    ACTIVE
    DORMANT
    ARCHIVED
  }

  enum HonourKind {
    TROPHY
    TITLE
    PROMOTION
    MILESTONE
  }

  enum SeasonStatus {
    PLANNED
    ACTIVE
    ARCHIVED
  }

  enum Competition {
    DIVISION
    CUP
    ZONAL_FINAL
    NATIONAL_FINAL
    FRIENDLY
  }

  enum CupStage {
    R32
    R16
    QUARTER_FINAL
    SEMI_FINAL
    FINAL
  }

  enum FixtureStatus {
    SCHEDULED
    TEAM_SHEETS
    LIVE
    AWAITING_VALIDATION
    VALIDATED
    CANCELLED
  }

  enum PieceColor {
    WHITE
    BLACK
  }

  enum GameSource {
    ONLINE
    OTB
  }

  enum EventKind {
    MATCH_START
    BOARD_RESULT
    VALIDATED
    NOTE
  }

  enum EnquiryStatus {
    NEW
    CONTACTED
    MEETING_BOOKED
    SIGNED
    DECLINED
  }

  enum FixtureOrder {
    SCHEDULED_ASC
    SCHEDULED_DESC
  }

  "A generated club crest (BUILD_PLAN §5). Null when the club has none yet — the client derives one deterministically from the slug."
  type Crest {
    shield: String!
    band: String!
    charge: String!
  }

  """
  A person as the public may see them. ALWAYS produced by toPublicPlayer() —
  BUILD_PLAN §4.3. displayName is already reduced to the "Brenda A." form
  when full display is not permitted, and avatarUrl is null in that case.
  Never re-derive a name on the client from any other field.
  """
  type PublicPlayer {
    id: ID!
    displayName: String!
    avatarUrl: String
    rating: Int!
    clubSlug: String
    clubName: String
    clubShortName: String
    crest: Crest
    schoolYear: String
    boardOrder: Int
  }

  type Club {
    id: ID!
    slug: String!
    name: String!
    shortName: String!
    region: String!
    level: ClubLevel!
    status: ClubStatus!
    crest: Crest
    foundedOn: DateTime
    school: School
    "ACTIVE memberships only."
    memberCount: Int!
    honours: [ClubHonour!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  "The join flow's confirmation card: name and crest only, nothing else about the club."
  type ClubSummary {
    slug: String!
    name: String!
    shortName: String!
    crest: Crest
  }

  type ClubConnection {
    nodes: [Club!]!
    totalCount: Int!
    hasMore: Boolean!
  }

  type ClubHonour {
    id: ID!
    title: String!
    kind: HonourKind!
    awardedOn: DateTime!
    season: Season
  }

  type Season {
    id: ID!
    slug: String!
    name: String!
    startsOn: DateTime!
    endsOn: DateTime!
    status: SeasonStatus!
    divisions: [Division!]!
  }

  "A league group inside a season, named after its catchment — never a bare region name (BUILD_PLAN §2)."
  type Division {
    id: ID!
    seasonId: ID!
    name: String!
    "One of the four zones feeding the zonal finals: COASTAL, GRASSFIELDS, CENTRE_SOUTH, NORTHERN."
    zone: String!
    "Canonical region keys in this division's catchment."
    regions: [String!]!
    level: ClubLevel!
    totalMatchDays: Int!
  }

  """
  One club's row in a division table. DERIVED from VALIDATED fixtures only
  (BUILD_PLAN §3.3 #2) by domains/fixture/scoring.ts, including the seven-level
  tie-break ladder of §3.4. movement is position vs previousPosition — take it
  from here, never compute it client-side.
  """
  type DivisionEntry {
    id: ID!
    club: Club!
    division: Division!
    played: Int!
    won: Int!
    drawn: Int!
    lost: Int!
    byes: Int!
    "3 / 1 / 0. A bye is worth 3 and no board points."
    matchPoints: Int!
    "Halves are real: 2.5 is a legal value."
    boardPoints: Float!
    position: Int
    previousPosition: Int
    "Positive = climbed since the previous match day."
    movement: Int!
    "Most-recent-last. W / D / L / B, where B is a bye."
    form: [String!]!
  }

  """
  A team match across N boards. homeClub and awayClub are NULLABLE on
  purpose: a bye has no away club, and a cup placeholder has neither until its
  feeding ties resolve — those rows render homeSourceLabel / awaySourceLabel
  ("Winner QF1") instead of crests.
  """
  type Fixture {
    id: ID!
    season: Season!
    division: Division
    competition: Competition!
    stage: CupStage
    matchDay: Int
    homeClub: Club
    awayClub: Club
    homeSourceLabel: String
    awaySourceLabel: String
    isBye: Boolean!
    scheduledAt: DateTime!
    venue: String
    boardCount: Int!
    status: FixtureStatus!
    "Board points, DERIVED from the boards (§3.3 #1) — never entered. Render home first: 2.5 - 1.5."
    homeScore: Float!
    awayScore: Float!
    validatedAt: DateTime
    boards: [FixtureBoard!]!
    events: [FixtureEvent!]!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  """
  One board of a fixture. result reuses the existing GameResult enum — there is
  no second encoding. homeColor is what lets a client render it White-first:
  a WHITE_WIN credits the home club when homeColor is WHITE, the away club
  otherwise.
  """
  type FixtureBoard {
    id: ID!
    boardNumber: Int!
    homePlayer: PublicPlayer
    awayPlayer: PublicPlayer
    homeColor: PieceColor!
    "OTB or ONLINE — the public page is honest about which boards are on wood."
    source: GameSource!
    gameId: ID
    result: GameResult
    scoresheetUrl: String
    moveCount: Int
    recordedAt: DateTime
  }

  type FixtureEvent {
    id: ID!
    kind: EventKind!
    board: Int
    message: String!
    occurredAt: DateTime!
  }

  type RegionCount {
    region: String!
    clubCount: Int!
    "Editorial: the year the academy expects to open a region that has no clubs yet. Null once it has one."
    opensIn: Int
  }

  type NetworkSummary {
    clubCount: Int!
    playerCount: Int!
    activeRegionCount: Int!
    matchDaysPlayed: Int!
    matchDaysTotal: Int!
    "Every region, including the zeros, so the map always has ten tiles."
    clubsByRegion: [RegionCount!]!
  }

  type PlayerStanding {
    rank: Int!
    player: PublicPlayer!
    rating: Int!
    "Movement across the season. 0 when no rating snapshot exists for this player."
    ratingDelta: Int!
    officialGames: Int!
    wins: Int!
    draws: Int!
    losses: Int!
  }

  type SchoolStanding {
    rank: Int!
    school: School!
    clubCount: Int!
    memberCount: Int!
    "Summed across the school's clubs."
    matchPoints: Int!
  }

  # ─── Intake ────────────────────────────────────────────────────────────────

  input SchoolEnquiryInput {
    schoolName: String!
    town: String
    "One of Cameroon's ten canonical region keys. Legacy French free text is normalised server-side."
    region: String!
    level: ClubLevel
    sizeBand: String
    contactName: String!
    contactRole: String
    contactPhone: String!
    contactEmail: String
    note: String
    wantsFrench: Boolean
    "HONEYPOT. Render it, hide it, and leave it empty. A filled value is dropped silently."
    website: String
  }

  "OK | VALIDATION | RATE_LIMITED. Never an alert(): design all three (P1-4)."
  type SchoolEnquiryResult {
    ok: Boolean!
    id: ID
    code: String!
    message: String!
  }

  type SchoolEnquiry {
    id: ID!
    schoolName: String!
    town: String
    region: String!
    level: ClubLevel!
    sizeBand: String
    contactName: String!
    contactRole: String
    contactPhone: String!
    contactEmail: String
    note: String
    wantsFrench: Boolean!
    status: EnquiryStatus!
    createdAt: DateTime!
  }

  type SchoolEnquiryList {
    items: [SchoolEnquiry!]!
    total: Int!
    limit: Int!
    offset: Int!
  }

  extend type Query {
    # ── Directory ──
    clubs(region: String, level: ClubLevel, search: String, limit: Int, offset: Int): ClubConnection!
    "Never returns joinCode — the type does not carry it."
    club(slug: String!): Club
    "The join flow. The code goes in; it never comes back out."
    clubByJoinCode(code: String!): ClubSummary
    "Consent-reduced by toPublicPlayer(). teamOnly = players with a board order."
    clubRoster(slug: String!, teamOnly: Boolean): [PublicPlayer!]!
    "This club's row in its division, for the current season."
    clubStanding(slug: String!): DivisionEntry
    clubNetworkSummary: NetworkSummary!

    # ── Competition ──
    "The single ACTIVE season; the most recent ARCHIVED one if none is active (BUILD_PLAN §4.1)."
    currentSeason: Season
    seasons: [Season!]!
    divisions(seasonId: ID!, level: ClubLevel): [Division!]!
    divisionTable(divisionId: ID!): [DivisionEntry!]!
    fixtures(
      seasonId: ID!
      clubId: ID
      divisionId: ID
      competition: Competition
      status: FixtureStatus
      from: DateTime
      to: DateTime
      orderBy: FixtureOrder = SCHEDULED_ASC
      limit: Int
    ): [Fixture!]!
    fixture(id: ID!): Fixture
    fixtureEvents(fixtureId: ID!): [FixtureEvent!]!
    liveFixtures: [Fixture!]!
    "Includes placeholder ties — rows with no clubs yet and a source label instead."
    cupBracket(seasonId: ID!): [Fixture!]!

    # ── The record ──
    playerStandings(seasonId: ID!, region: String, level: ClubLevel, limit: Int): [PlayerStanding!]!
    schoolStandings(seasonId: ID!, region: String, limit: Int): [SchoolStanding!]!
    publicPlayer(id: ID!): PublicPlayer

    # ── Intake (staff only) ──
    schoolEnquiries(status: EnquiryStatus, limit: Int, offset: Int): SchoolEnquiryList!
  }

  extend type Mutation {
    "Public and rate-limited: IP + phone throttle backed by a table, plus the honeypot above."
    submitSchoolEnquiry(input: SchoolEnquiryInput!): SchoolEnquiryResult!
    "Staff only — moves an enquiry along the intake pipeline."
    adminUpdateSchoolEnquiryStatus(id: ID!, status: EnquiryStatus!): SchoolEnquiry!
  }

`;
