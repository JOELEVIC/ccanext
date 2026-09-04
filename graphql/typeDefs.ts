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
    """
    Whether this player may be drawn from the open pool by somebody who did not
    name them. Default true. Visible only to the owner and staff — whether
    somebody is open to a game is their business, not a browsable attribute.

    This gates WHO MAY BE CHALLENGED and has nothing to do with §4.3, which
    gates whose name is published and is unaffected either way.
    """
    openToChallenges: Boolean
    "Whether finished games appear on this player's record. Owner and staff only."
    gamesPublic: Boolean
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

  """
  The switches a player owns. Every field optional: a screen saving one must
  not send the others back as it last read them.
  """
  input MySettingsInput {
    openToChallenges: Boolean
    gamesPublic: Boolean
    """
    A LOOKUP KEY, never an output. Stored normalised so a number typed any of
    the ways Cameroonian numbers are written finds the same account; matched
    only on the whole value, so no query can walk the space of numbers. No
    resolver returns it — not to the owner, not to staff. Null clears it.
    """
    phone: String
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
    """
    Players I can invite directly, and requests waiting on an answer.

    Both consent-reduced: being somebody's friend is not consent to publish
    their name, and a non-consented minor is "Brenda A." to their friends too.
    """
    myFriends: [PublicPlayer!]!
    myFriendRequests: [Friendship!]!

    """
    Find one person you already know, by username, email or phone.

    Username matches by prefix, because a username is public and on every
    roster. Email and phone match the WHOLE value or not at all — a prefix
    search over either would be an oracle for enumerating a school's worth of
    children's contact details. Neither is ever returned.
    """
    findPlayer(query: String!): [PublicPlayer!]!

    """
    Players open to a game from somebody who has not met them, for anyone who
    would rather pick a face than take whatever the seek queue offers.
    """
    openPool(limit: Int): [PublicPlayer!]!

    """
    The seek pool: open invites nobody has named an opponent on, oldest first,
    excluding my own. Pass a cadence to see only the games you would actually
    take.

    This IS matchmaking. "Find me a game" is: accept the oldest of these, or
    post one and be accepted. Creators who have switched themselves out of the
    open pool, or whose club has, are not listed.
    """
    openChallenges(timeControl: String): [Challenge!]!

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

    """
    Ask somebody to be a friend.

    Accept-based and never one-way: the relation grants standing to send a
    child a direct invitation, and standing like that has to be given rather
    than taken. Asking somebody who has already asked you accepts instead of
    creating a mirrored request.
    """
    sendFriendRequest(userId: ID!): Friendship!
    """
    Answer a request addressed to you. Declining DELETES the row: a refusal is
    not a fact worth keeping, and keeping it would block the two from ever
    being friends after they met properly. Blocking is the durable no.
    """
    respondToFriendRequest(friendshipId: ID!, accept: Boolean!): Friendship!
    "Undo a friendship, or withdraw a request you sent."
    removeFriend(userId: ID!): Boolean!
    "No, and stop asking. Replaces whatever was between you."
    blockPlayer(userId: ID!): Boolean!

    "The switches a player owns over their own visibility."
    updateMySettings(input: MySettingsInput!): Profile!

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

  """
  Whether a club is hosted by an institution or stands on its own.

  A separate axis from ClubLevel, not a third value on it: level is the host
  institution's education stage, and an independent club has no host and so no
  stage. On Club this is derived from whether a school is attached — it is
  never stored, so it cannot disagree with the school field.
  """
  enum ClubKind {
    SCHOOL
    INDEPENDENT
  }

  """
  Where two people stand with each other.

  PENDING means I asked them; PENDING_THEM means they asked me — one enum
  rather than a boolean beside a status, because "waiting" without a direction
  is the state a screen cannot draw a button for.
  """
  enum FriendRelation {
    NONE
    PENDING
    PENDING_THEM
    ACCEPTED
    BLOCKED
  }

  """
  A friendship, or a request to be one.

  Both people are PublicPlayer, so §4.3 applies here as everywhere: being
  somebody's friend is not consent to publish their name.
  """
  type Friendship {
    id: ID!
    requester: PublicPlayer!
    addressee: PublicPlayer!
    status: FriendRelation!
    "True when the request is waiting on ME rather than on them."
    awaitingMe: Boolean!
    createdAt: DateTime!
    respondedAt: DateTime
  }

  """
  A club as its patron may edit it.

  Deliberately NOT name or slug: a club's name is in a public directory
  beside real schools and on a league table that has to mean something a
  season later. Renaming is a staff operation. Deliberately not school
  either — claiming to be a named institution's club is the claim the enquiry
  funnel exists to check.
  """
  input UpdateClubInput {
    shortName: String
    region: String
    level: ClubLevel
    foundedOn: DateTime
    crest: CrestInput
    "Hide the member list from anyone who is not in the club."
    isPrivate: Boolean
    """
    Keep this club's members out of the open pool.

    The per-player switch is Profile.openToChallenges and it defaults to on.
    This is the lever a school gets over that default. It does NOT stop a
    named invitation from a club-mate or a friend — only being dealt to a
    stranger who asked for anyone.
    """
    poolOptOut: Boolean
  }

  input CrestInput {
    shield: String
    band: String
    charge: String
  }

  """
  A club anybody may start.

  No schoolId: a self-serve club is INDEPENDENT, and staff attach a school
  at review if there is a reason to. level is the host institution's
  education stage and is meaningless without one, so it is a hint rather than
  a claim.
  """
  input CreateClubInput {
    name: String!
    "2-4 characters. Drives the crest."
    shortName: String!
    "A canonical region key, e.g. SOUTH_WEST."
    region: String!
    level: ClubLevel
  }

  type CreateClubResult {
    club: Club!
    """
    True when the club is waiting on staff. It exists, the caller is its
    patron, and nobody else can see it or join it until somebody approves.
    Said plainly rather than left for the patron to discover from an empty
    directory.
    """
    awaitingApproval: Boolean!
  }

  "A club waiting for somebody to look at it. Staff console."
  type PendingClub {
    id: ID!
    slug: String!
    name: String!
    shortName: String!
    region: String!
    level: ClubLevel!
    "The account that created it, and will run it."
    patronNames: [String!]!
    createdAt: DateTime!
  }

  """
  One switch staff can throw without a deploy.

  A key/value pair rather than a field per setting, because these are
  operational policies rather than domain facts. An unwritten key reads as its
  default, so an empty table is every switch in its safe position.
  """
  type PlatformSetting {
    key: String!
    """
    JSON-encoded, the way analysisJson and bodyJson already are in this
    schema — there is no JSON scalar here and adding one for a table of
    booleans would be a new primitive for one caller. Every current key holds
    "true" or "false".
    """
    value: String!
  }

  enum ClubStatus {
    """
    Created by somebody who is not staff, and not yet approved. Invisible: not
    in the directory, not reachable by slug, and its join code finds nothing.
    A proposal rather than a club.
    """
    PENDING_REVIEW
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
    """
    The host institution's education stage. Meaningful only for a SCHOOL club —
    read kind first. Kept non-null because it is stored non-null and clients
    coerce it; for an INDEPENDENT club its value carries no meaning.
    """
    level: ClubLevel!
    "SCHOOL when a school is attached, INDEPENDENT when none is. Derived, never stored."
    kind: ClubKind!
    status: ClubStatus!
    crest: Crest
    foundedOn: DateTime
    "Null for an independent club — one with no host institution."
    school: School
    "ACTIVE memberships only."
    memberCount: Int!
    """
    A private club's roster is not readable by non-members. The club itself
    stays public — hiding a school that exists would break the directory and
    the league table. What is withheld is the list of its children.
    """
    isPrivate: Boolean!
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
    "The organisation's name: the school for a SCHOOL enquiry, the club's own name for an INDEPENDENT one."
    schoolName: String!
    town: String
    "One of Cameroon's ten canonical region keys. Legacy French free text is normalised server-side."
    region: String!
    "Defaults to SCHOOL. INDEPENDENT is a club with no host institution."
    kind: ClubKind
    "The school's education stage. Omit for an INDEPENDENT enquiry — there is no school to have one."
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
    """
    The club the enquiry created, when it created one. Null whenever it did not
    — a duplicate club name, a rate limit, a validation refusal. The enquiry is
    the record; the club is a bonus and never a precondition of the form
    succeeding.
    """
    club: ProvisionedClub
  }

  """
  A club just created from a public enquiry, returned ONCE to the person who
  submitted the form.

  This is the only type in the schema that carries a join code, and it exists
  precisely so it can. §3.3 invariant 6 keeps joinCode off every public type
  because a code is an admission credential — but the person who just asked for
  this club, in this response, is the one party who must have it: a club made
  from an anonymous form has no patron, and entering this code is what makes
  them one. It is returned in the mutation payload and is not readable back
  from any query.
  """
  type ProvisionedClub {
    id: ID!
    slug: String!
    name: String!
    "The admission code. Show it once; it cannot be fetched again."
    joinCode: String!
    """
    True when the platform requires staff approval for new clubs. The club
    exists but is PENDING_REVIEW, so it is not in the directory and the code
    opens nothing until it is approved.
    """
    awaitingApproval: Boolean!
  }

  type SchoolEnquiry {
    id: ID!
    schoolName: String!
    town: String
    region: String!
    kind: ClubKind!
    "Null for an independent enquiry: no school, no education stage."
    level: ClubLevel
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


  # ===========================================================================
  # THE PATRON CONSOLE — PLATFORM_ROADMAP Milestone 4.3
  # ---------------------------------------------------------------------------
  # The first write surface outside the academy. Everything below is
  # authenticated with a PLAYER token and authorised per club by
  # domains/club/permissions.ts.
  #
  # These types are management-only and are never returned by a public query.
  # That is what lets them carry two things the public schema must never show:
  #
  #   · **real names.** BUILD_PLAN §4.3 gates public *display*. A patron is the
  #     teacher responsible to the school for these children, and a register
  #     that read "Brenda A." would be unusable by the one person who has to
  #     take it.
  #   · **joinCode.** §3.3 invariant 6 — secret, and this is the authenticated
  #     patron surface it was reserved for.
  #
  # A new query returning any of these types must repeat the permission check.
  # There is no public path that could inherit one by accident.
  # ===========================================================================

  enum MembershipRole {
    PLAYER
    CAPTAIN
    PATRON
    ASSISTANT_COACH
  }

  enum MembershipStatus {
    PENDING
    ACTIVE
    LEFT
    REMOVED
  }

  enum AttendanceState {
    PRESENT
    EXCUSED
    ABSENT
  }

  enum SessionStatus {
    SCHEDULED
    HELD
    CANCELLED
  }

  "A club the caller can manage, for the console's club switcher."
  type ManagedClub {
    id: ID!
    slug: String!
    name: String!
    shortName: String!
    region: String!
    level: ClubLevel!
    crest: Crest
    myRole: MembershipRole!
  }

  "The console header: the club, its secret join code, and what needs a decision."
  type ClubConsole {
    club: ManagedClubDetail!
    "How many people have entered the join code and are waiting to be admitted."
    pendingCount: Int!
    activeCount: Int!
    nextSession: ManagedSession
  }

  type ManagedClubDetail {
    id: ID!
    slug: String!
    name: String!
    shortName: String!
    region: String!
    level: ClubLevel!
    status: ClubStatus!
    "Secret — §3.3 invariant 6. Only ever on this authenticated type."
    joinCode: String!
    crest: Crest
    schoolId: ID
    schoolName: String
    "The two settings a patron owns. See UpdateClubInput for what each does."
    isPrivate: Boolean!
    poolOptOut: Boolean!
  }

  "One row of the club roster, as the patron sees it. Names are NOT reduced."
  type ClubMember {
    id: ID!
    userId: ID!
    username: String!
    fullName: String!
    role: MembershipRole!
    status: MembershipStatus!
    schoolYear: String
    boardOrder: Int
    rating: Int!
    joinedAt: DateTime!
  }

  type ManagedSession {
    id: ID!
    title: String!
    startsAt: DateTime!
    location: String
    status: SessionStatus!
    presentCount: Int!
    excusedCount: Int!
    absentCount: Int!
  }

  "Every active member, marked or not — a register with people missing is not a record."
  type RegisterRow {
    member: ClubMember!
    state: AttendanceState
  }

  type SessionRegister {
    session: ManagedSession!
    rows: [RegisterRow!]!
  }

  "A player the caller may name on a board. Strongest first."
  type EligiblePlayer {
    userId: ID!
    username: String!
    fullName: String!
    rating: Int!
    schoolYear: String
    boardOrder: Int
  }

  "One board as the console sees it — both player ids, the scoresheet, the stamp."
  type ManagedBoard {
    id: ID!
    boardNumber: Int!
    homeColor: PieceColor!
    "White-first, always. homeColor is what converts to a home-first score."
    result: GameResult
    homeUserId: ID
    awayUserId: ID
    homeName: String
    awayName: String
    scoresheetUrl: String
    moveCount: Int
    "Set once, at validation. Non-null means this board has been rated."
    ratedAt: DateTime
    recordedAt: DateTime
  }

  type MatchDayFixture {
    id: ID!
    scheduledAt: DateTime!
    venue: String
    status: FixtureStatus!
    competition: Competition!
    isBye: Boolean!
    boardCount: Int!
    "Derived from the boards. Never entered — §3.3 invariant 1."
    homeScore: Float!
    awayScore: Float!
    homeClub: ClubSummary
    awayClub: ClubSummary
    boards: [ManagedBoard!]!
  }

  type TeamSheetView {
    fixture: MatchDayFixture!
    "Which side the caller is filing for."
    side: String!
    clubId: ID!
    "False once a result exists: board order identifies the players in a played game."
    editable: Boolean!
    eligible: [EligiblePlayer!]!
  }

  input ClubSessionInput {
    title: String!
    startsAt: DateTime!
    location: String
  }

  input ClubSessionUpdateInput {
    title: String
    startsAt: DateTime
    location: String
    status: SessionStatus
  }

  input AttendanceInput {
    userId: ID!
    state: AttendanceState!
  }

  input TeamSheetBoardInput {
    boardNumber: Int!
    userId: ID!
  }

  input RecordBoardResultInput {
    fixtureId: ID!
    boardNumber: Int!
    "White-first. There is no home-first encoding — §3.3 invariant 5."
    result: GameResult!
    moveCount: Int
    scoresheetUrl: String
  }

  extend type Query {
    "Clubs the caller is a patron or assistant coach of."
    myManagedClubs: [ManagedClub!]!
    clubConsole(clubId: ID!): ClubConsole!
    clubMembers(clubId: ID!, status: MembershipStatus): [ClubMember!]!
    clubSessions(clubId: ID!, limit: Int): [ManagedSession!]!
    sessionRegister(sessionId: ID!): SessionRegister!
    teamSheet(fixtureId: ID!): TeamSheetView!
    "Fixtures this club still has to file or have signed off."
    clubMatchDayQueue(clubId: ID!): [MatchDayFixture!]!
  }

  extend type Mutation {
    """
    Start a club.

    Anybody signed in. It lands PENDING_REVIEW while
    club.creation.requiresApproval is on — invisible, unjoinable, a proposal
    — and ONBOARDING when staff have turned that off. Either way the creator
    becomes its patron, because a club whose first join request nobody can
    admit is inert.

    Refused while the caller is already an ACTIVE member of another club.
    """
    createClub(input: CreateClubInput!): CreateClubResult!

    """
    Edit your own club. Patron or assistant coach — the club:manage
    permission the console already checks.

    The hole this fills: the schema had adminCreateClub and five session
    mutations and nothing that changed a club after it existed, so a patron
    with a typo in their short name had to email the academy.
    """
    updateClub(clubId: ID!, input: UpdateClubInput!): ManagedClubDetail!

    """
    Mint a new join code, retiring the old one.

    Staff have had this since the console existed and a patron has not, which
    is backwards: the person who sees a code reach a WhatsApp group it should
    not have is the patron, and Monday at 8am is not the hour to be emailing
    an academy. Existing members are unaffected — the code is how you ask to
    join, not what proves you are in.
    """
    regenerateJoinCode(clubId: ID!): ManagedClubDetail!

    "Admit a pending join-code request, or decline it."
    decideMembership(membershipId: ID!, admit: Boolean!): ClubMember!
    setMembershipRole(membershipId: ID!, role: MembershipRole!): ClubMember!
    removeMember(membershipId: ID!): ClubMember!

    createClubSession(clubId: ID!, input: ClubSessionInput!): ManagedSession!
    updateClubSession(sessionId: ID!, input: ClubSessionUpdateInput!): ManagedSession!
    "Replaces the whole register in one write — a patron marks a room, not a person."
    markAttendance(sessionId: ID!, entries: [AttendanceInput!]!): ManagedSession!

    "Replaces this club's whole sheet. Refused once a result exists."
    submitTeamSheet(fixtureId: ID!, boards: [TeamSheetBoardInput!]!): MatchDayFixture!
    "Either club may record any board. Every write appends an event; none erase one."
    recordBoardResult(input: RecordBoardResultInput!): MatchDayFixture!
    "The arbiter's signature: freezes the table entry and rates every board, once."
    validateFixture(fixtureId: ID!): MatchDayFixture!
  }


  # ===========================================================================
  # MY CLUB — the member's own view. PLATFORM_ROADMAP 4.2
  # ---------------------------------------------------------------------------
  # The counterpart to the patron console: same club, the other side of it.
  #
  # These carry no other person's data. Everything about fellow members on the
  # screens this feeds comes from clubRoster, which is the public, already
  # consent-reduced path (BUILD_PLAN 4.3). A member is not a patron, and does
  # not get the register.
  # ===========================================================================

  type MyClub {
    id: ID!
    slug: String!
    name: String!
    shortName: String!
    region: String!
    level: ClubLevel!
    status: ClubStatus!
    crest: Crest
    schoolName: String
    memberCount: Int!
  }

  "The caller's own standing in one club. Includes memberships still PENDING."
  type MyMembership {
    id: ID!
    role: MembershipRole!
    "PENDING means a join code was entered and a patron has not decided yet."
    status: MembershipStatus!
    schoolYear: String
    "A-team board 1-4. Null means not currently selected."
    boardOrder: Int
    joinedAt: DateTime!
    club: MyClub!
  }

  extend type Query {
    "Every club the caller belongs to, pending ones included."
    myMemberships: [MyMembership!]!
  }

  # ==========================================================================
  # CLUBS, FROM THE STAFF CONSOLE
  # ==========================================================================
  #
  # Until this existed a club could only be created by running
  # scripts/onboard-clubs.ts from a developer's machine — everything
  # downstream of a club existing was shipped, and the first step was a
  # terminal.
  #
  # Staff-only, and that is a decision rather than a shortcut: a club is an
  # institution whose members are children, its name appears in a public
  # directory, and it plays in a league whose table has to mean something.
  # The enquiry funnel is the public door.
  #
  # AdminClub is the ONE list type in this schema carrying joinCode, reachable
  # only with the separately-signed admin token.

  type AdminClub {
    id: ID!
    slug: String!
    name: String!
    shortName: String!
    region: String!
    level: ClubLevel!
    status: ClubStatus!
    schoolName: String
    "Secret. Never on a public type — see BUILD_PLAN 3.3 invariant 6."
    joinCode: String!
    memberCount: Int!
    "Requests waiting on a patron."
    pendingCount: Int!
    "Named, not counted: a club with none is inert and a zero is easy to read past."
    patronNames: [String!]!
    createdAt: DateTime!
  }

  input AdminCreateClubInput {
    name: String!
    "2-4 characters. Drives the crest."
    shortName: String!
    "A canonical region key, e.g. SOUTH_WEST."
    region: String!
    "Null for an independent club — one with no host institution."
    schoolId: ID
    level: ClubLevel
    """
    The teacher who will run it, by username or email.

    A club created without one is inert: a join request can only be admitted
    by a patron of that club, so an empty club's first request can never be
    answered by anybody. Set it here or with adminSetClubPatron.
    """
    patronUsername: String
  }

  extend type Query {
    "Every club, newest first, with its join code and its waiting count."
    adminClubs(search: String, limit: Int, offset: Int): [AdminClub!]!
    "Clubs proposed from outside the academy, oldest first — a queue, not a list."
    adminPendingClubs(limit: Int): [PendingClub!]!
    "Every operational switch, with whatever is stored or its default."
    platformSettings: [PlatformSetting!]!
  }

  extend type Mutation {
    "Create a club. It starts ONBOARDING — appearing in the public directory is a separate decision."
    adminCreateClub(input: AdminCreateClubInput!): AdminClub!

    """
    Install the club's patron: an ACTIVE PATRON membership, made without
    anybody approving it, because for the first one there is nobody to ask.
    Does not demote an existing patron; a club may have several.
    """
    adminSetClubPatron(clubId: ID!, username: String!): AdminClub!
    "Clubs somebody outside the academy has proposed. Oldest first."
    adminApproveClub(clubId: ID!): AdminClub!
    """
    Refuse a proposed club. Archived rather than deleted, so staff have
    something to answer from when the teacher writes in, and so the name
    cannot be re-proposed five minutes later.
    """
    adminRejectClub(clubId: ID!): Boolean!
    "One operational switch. See PlatformSetting."
    setPlatformSetting(key: String!, value: String!): PlatformSetting!

    """
    Mint a new join code, retiring the old one — for the day a code reaches a
    group chat it should not have. Members are unaffected: the code is how you
    ask to join, not what proves you are in.
    """
    adminRegenerateJoinCode(clubId: ID!): AdminClub!

    adminSetClubStatus(clubId: ID!, status: ClubStatus!): AdminClub!
  }

  extend type Mutation {
    """
    Spend a club's join code on the account already signed in, creating a
    PENDING membership a patron then admits.

    The counterpart to RegisterInput.joinCode, which was the only place a code
    could be spent: that one covers the student who arrives holding it, and
    left everybody else — somebody who installed the app before their school
    signed up, a student whose club started this term — with an account and no
    way to attach it to a club.

    Entering the same code twice is not a second request: every path updates
    the one membership row, so a patron never sees a stranger ask again.
    Refused while the caller is active at another club, or waiting on one.
    """
    joinClubByCode(joinCode: String!): MyMembership!
  }

  # ==========================================================================
  # THE LADDER — the Android app's tiered curriculum, attached to an account
  # ==========================================================================
  #
  # Eleven Elo-banded tiers of lessons, drills, exams and diplomas, all of
  # which the app runs offline against a database on the phone. This surface
  # exists so a student who changes phone, or loses one, does not lose the
  # ladder they climbed.
  #
  # Distinct from Course/CourseProgress above, which is the legacy site's
  # per-course flag and stays as it is.
  #
  # PRIVATE. Every field here is about the caller and only the caller — there
  # is no query that reads another student's progress, and adding one is a
  # guardian-consent decision (BUILD_PLAN §4.3) rather than a convenience.

  "Yusupov's bands, which the app's exams use verbatim."
  enum LadderExamGrade {
    "Under 60%. The chapter is repeated."
    FAIL
    "60-74%."
    PASS
    "75-89%."
    GOOD
    "90% and over."
    EXCELLENT
  }

  type LadderLessonProgress {
    "The app's own lesson slug. Opaque to the server: the curriculum ships in the app."
    lessonId: ID!
    tierId: ID!
    "The earliest date any device claimed this lesson was finished."
    completedAt: DateTime!
  }

  type LadderExamResult {
    "Generated on the device. Two pushes of the same attempt are one sitting."
    attemptId: ID!
    examId: ID!
    tierId: ID!
    scorePoints: Int!
    maxPoints: Int!
    "Derived from the score by the server, never accepted from the client."
    percent: Int!
    "Derived from the percentage by the server, never accepted from the client."
    grade: LadderExamGrade!
    "Any grade but FAIL."
    passed: Boolean!
    startedAt: DateTime!
    finishedAt: DateTime!
  }

  "A tier's seal, holding the best sitting that earned it."
  type LadderDiploma {
    tierId: ID!
    percent: Int!
    grade: LadderExamGrade!
    earnedAt: DateTime!
  }

  type LadderProgress {
    lessons: [LadderLessonProgress!]!
    "Every sitting, oldest first. Append-only, so a re-sit is visible."
    exams: [LadderExamResult!]!
    diplomas: [LadderDiploma!]!
  }

  input LadderLessonInput {
    lessonId: ID!
    tierId: ID!
    completedAt: DateTime!
  }

  "A sat exam. Carries no percentage and no grade — the server computes both."
  input LadderExamInput {
    "The device's own id for this sitting. Makes a retried push harmless."
    attemptId: ID!
    examId: ID!
    tierId: ID!
    scorePoints: Int!
    maxPoints: Int!
    startedAt: DateTime!
    finishedAt: DateTime!
  }

  extend type Query {
    "The caller's own ladder. Requires a token; there is no way to ask about anybody else."
    myLadderProgress: LadderProgress!
  }

  extend type Mutation {
    """
    Records finished lessons and answers with the whole ladder, so a push and a
    pull are one round trip. Idempotent: a lesson already recorded is left
    alone unless the incoming claim is earlier.
    """
    recordLadderLessons(lessons: [LadderLessonInput!]!): LadderProgress!

    """
    Records one sitting, seals the tier when it earns that, and answers with
    the whole ladder. Pushing the same attemptId twice is one sitting.
    """
    recordLadderExam(input: LadderExamInput!): LadderProgress!
  }



`;
