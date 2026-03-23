/**
 * DEV seed: DChessAcademy demo data. Re-runnable: removes prior @seed.* users and platform tournaments first.
 */
import { PrismaClient, ChessVariant, GameStatus, GameResult, TournamentStatus, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const PLATFORM_SCHOOL_ID = "a0000001-0000-4000-8000-000000000001";
const SALT = 12;

const VARIANTS: ChessVariant[] = [
  "ULTRABULLET",
  "BULLET",
  "BLITZ",
  "RAPID",
  "CLASSIC",
  "CRAZYHOUSE",
  "CHESS960",
  "KOTH",
  "THREECHECK",
  "ANTICHESS",
  "ATOMIC",
  "HORDE",
  "RACING_KINGS",
];

const radarDefault = {
  sacrifice: 62,
  endgame: 71,
  positional: 58,
  matingAttack: 65,
  tactics: 88,
  opening: 74,
};

const SEED_EMAIL_SUFFIXES = ["@seed.dchessacademy", "@seed.chess.pro"] as const;

async function wipeSeedScope() {
  const seedUsers = await prisma.user.findMany({
    where: {
      OR: SEED_EMAIL_SUFFIXES.map((suffix) => ({ email: { endsWith: suffix } })),
    },
    select: { id: true },
  });
  const seedIds = seedUsers.map((u) => u.id);
  if (seedIds.length) {
    await prisma.gameXpAward.deleteMany({
      where: { OR: [{ userId: { in: seedIds } }] },
    });
    await prisma.game.deleteMany({
      where: {
        OR: [{ whiteId: { in: seedIds } }, { blackId: { in: seedIds } }],
      },
    });
    await prisma.tournamentParticipant.deleteMany({
      where: { userId: { in: seedIds } },
    });
    await prisma.userVariantRating.deleteMany({ where: { userId: { in: seedIds } } });
    await prisma.puzzleUserStats.deleteMany({ where: { userId: { in: seedIds } } });
    await prisma.courseProgress.deleteMany({ where: { userId: { in: seedIds } } });
    await prisma.badge.deleteMany({
      where: { profile: { userId: { in: seedIds } } },
    });
    await prisma.profile.deleteMany({ where: { userId: { in: seedIds } } });
    await prisma.user.deleteMany({ where: { id: { in: seedIds } } });
  }

  const platformTournaments = await prisma.tournament.findMany({
    where: { schoolId: PLATFORM_SCHOOL_ID },
    select: { id: true },
  });
  const tids = platformTournaments.map((t) => t.id);
  if (tids.length) {
    await prisma.game.deleteMany({ where: { tournamentId: { in: tids } } });
    await prisma.tournamentParticipant.deleteMany({ where: { tournamentId: { in: tids } } });
    await prisma.tournament.deleteMany({ where: { id: { in: tids } } });
  }
}

function sameDayBase(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

async function main() {
  await wipeSeedScope();

  await prisma.school.upsert({
    where: { id: PLATFORM_SCHOOL_ID },
    create: {
      id: PLATFORM_SCHOOL_ID,
      name: "DChessAcademy Global",
      region: "International",
    },
    update: { name: "DChessAcademy Global", region: "International" },
  });

  await prisma.platformMetric.upsert({
    where: { key: "players_total" },
    create: { key: "players_total", intValue: 1_308_096 },
    update: { intValue: 1_308_096 },
  });
  await prisma.platformMetric.upsert({
    where: { key: "playing_now" },
    create: { key: "playing_now", intValue: 42_891 },
    update: { intValue: 42_891 },
  });

  const demoPassword = bcrypt.hashSync("demo1234", SALT);

  const usernames = [
    "grasevandir",
    "Inventing_Invention",
    "DarkKnight88",
    "QueenSacrifice",
    "EndgameOnly",
    "RapidRider",
    "BulletTrain",
    "TacticalNinja",
    "PawnStorm",
    "CastleKing",
    "Fianchetto",
    "SkewerMaster",
    "StalemateTrap",
    "EnPassantPro",
    "ZugzwangZen",
  ];

  const titles = ["GM", "IM", "FM", "WGM", null, null, null, "GM", "IM", null, null, "FM", null, null, null];
  const countries = ["NO", "US", "CM", "FR", "DE", "IN", "RU", "ES", "BR", "UK", "IT", "PL", "SE", "NL", "CA"];

  const users: { id: string; username: string }[] = [];

  for (let i = 0; i < usernames.length; i++) {
    const u = usernames[i]!;
    const email = `${u.toLowerCase().replace(/[^a-z0-9]/g, "")}@seed.dchessacademy`;
    const rating = 2890 - i * 45;
    const user = await prisma.user.create({
      data: {
        email,
        username: u,
        passwordHash: demoPassword,
        role: UserRole.STUDENT,
        schoolId: PLATFORM_SCHOOL_ID,
        rating,
        profile: {
          create: {
            firstName: u.split("_")[0] ?? u,
            lastName: "Player",
            country: countries[i] ?? "US",
            ...(titles[i] ? { chessTitle: titles[i]! } : {}),
            avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u)}`,
            followerCount: 120 + i * 17,
            friendCount: 40 + i * 3,
            xp: 500 + i * 200,
            ratingTrendJson: [rating - 40, rating - 22, rating - 10, rating - 5, rating],
            puzzleStreakCount: i % 7,
          },
        },
      },
      include: { profile: true },
    });
    users.push({ id: user.id, username: user.username });

    for (const v of VARIANTS) {
      const base = rating + (VARIANTS.indexOf(v) % 5) * 12 - 60;
      await prisma.userVariantRating.create({
        data: {
          userId: user.id,
          variant: v,
          rating: Math.max(800, Math.min(3200, base + (i * 7) % 90)),
          ratingDelta: (i % 5) - 2 + (VARIANTS.indexOf(v) % 3) * 3,
          gamesPlayed: 20 + i * 11 + VARIANTS.indexOf(v) * 2,
        },
      });
    }
  }

  const demoUserId = users[0]!.id;

  await prisma.puzzleUserStats.create({
    data: {
      userId: demoUserId,
      periodDays: 30,
      solvedCount: 842,
      performanceRating: 2156,
      successRate: 0.73,
      radarSkillsJson: radarDefault,
    },
  });

  const courseDefs = [
    { slug: "cm1", title: "Piece Checkmates I", category: "Checkmates", sortOrder: 1 },
    { slug: "cm2", title: "Piece Checkmates II", category: "Checkmates", sortOrder: 2 },
    { slug: "cm3", title: "Back rank mates", category: "Checkmates", sortOrder: 3 },
    { slug: "bt1", title: "Forks and pins", category: "Basic tactics", sortOrder: 1 },
    { slug: "bt2", title: "Discovered attacks", category: "Basic tactics", sortOrder: 2 },
    { slug: "bt3", title: "Deflection", category: "Basic tactics", sortOrder: 3 },
  ];

  for (const c of courseDefs) {
    await prisma.course.upsert({
      where: { slug: c.slug },
      create: c,
      update: { title: c.title, category: c.category, sortOrder: c.sortOrder },
    });
  }

  const courses = await prisma.course.findMany();
  for (const c of courses) {
    await prisma.courseProgress.create({
      data: {
        userId: demoUserId,
        courseId: c.id,
        completed: c.sortOrder <= 2 && c.category === "Checkmates",
        bookmarked: c.slug === "bt2" || c.slug === "cm3",
      },
    });
  }

  const day0 = sameDayBase();
  const tournamentTemplates: Array<{
    name: string;
    minutesFromMidnight: number;
    lenMin: number;
    variant: string;
    tc: string;
    color: string;
    icon?: string;
    sponsored?: boolean;
    prize?: object;
    max: number;
    parts: number;
    status: TournamentStatus;
  }> = [
    { name: "Hourly Blitz Arena", minutesFromMidnight: 9 * 60, lenMin: 55, variant: "Blitz", tc: "3+0", color: "tan", icon: "lightning", max: 450, parts: 254, status: TournamentStatus.ONGOING },
    { name: "Daily Rapid Arena", minutesFromMidnight: 9 * 60 + 10, lenMin: 50, variant: "Rapid", tc: "10+0", color: "blue", icon: "rabbit", max: 300, parts: 180, status: TournamentStatus.UPCOMING },
    { name: "2021 airBaltic Spring Marathon", minutesFromMidnight: 9 * 60 + 20, lenMin: 180, variant: "Rapid", tc: "10+0", color: "lime", icon: "fire", max: 2000, parts: 1200, status: TournamentStatus.UPCOMING, sponsored: true, prize: { first: 1500, second: 800, third: 400 } },
    { name: "Week Bullet Arena", minutesFromMidnight: 9 * 60 + 40, lenMin: 30, variant: "Bullet", tc: "1+0", color: "purple", icon: "lightning", max: 500, parts: 320, status: TournamentStatus.UPCOMING },
    { name: "Morning Hyperbullet", minutesFromMidnight: 10 * 60, lenMin: 20, variant: "Bullet", tc: "30+0", color: "tan", max: 200, parts: 89, status: TournamentStatus.UPCOMING },
    { name: "Lunch Blitz", minutesFromMidnight: 12 * 60, lenMin: 45, variant: "Blitz", tc: "5+0", color: "blue", max: 400, parts: 210, status: TournamentStatus.UPCOMING },
    { name: "Afternoon Classic", minutesFromMidnight: 14 * 60, lenMin: 120, variant: "Classic", tc: "15+10", color: "blue", max: 100, parts: 45, status: TournamentStatus.UPCOMING },
    { name: "Chess960 Evening", minutesFromMidnight: 16 * 60, lenMin: 60, variant: "Chess960", tc: "3+2", color: "purple", max: 250, parts: 112, status: TournamentStatus.UPCOMING },
    { name: "Night Arena", minutesFromMidnight: 20 * 60, lenMin: 90, variant: "Blitz", tc: "3+0", color: "tan", max: 600, parts: 400, status: TournamentStatus.UPCOMING },
  ];

  const tournaments: { id: string; participants: number; demoJoined?: boolean }[] = [];

  for (let i = 0; i < tournamentTemplates.length; i++) {
    const tt = tournamentTemplates[i]!;
    const start = new Date(day0.getTime() + tt.minutesFromMidnight * 60 * 1000);
    const end = new Date(start.getTime() + tt.lenMin * 60 * 1000);
    const t = await prisma.tournament.create({
      data: {
        name: tt.name,
        schoolId: PLATFORM_SCHOOL_ID,
        startDate: start,
        endDate: end,
        status: tt.status,
        chessVariant: tt.variant,
        arenaTimeControl: tt.tc,
        format: "ARENA",
        maxPlayers: tt.max,
        durationMinutes: tt.lenMin,
        cardColor: tt.color,
        isSponsored: !!tt.sponsored,
        isRated: true,
        iconType: tt.icon ?? null,
        prizePoolJson: tt.prize ?? undefined,
      },
    });
    const participantCount = Math.min(tt.parts, users.length);
    for (let p = 0; p < participantCount; p++) {
      await prisma.tournamentParticipant.create({
        data: { tournamentId: t.id, userId: users[p]!.id, score: 0 },
      });
    }
    tournaments.push({ id: t.id, participants: participantCount, demoJoined: tt.name.includes("Blitz Arena") });
  }

  const w = users[1]!;
  const b = users[2]!;
  const analysisJson = {
    white: { inaccuracies: 4, mistakes: 1, blunders: 0, acpl: 28 },
    black: { inaccuracies: 6, mistakes: 2, blunders: 1, acpl: 45 },
    evalSeries: [
      { ply: 0, cp: 15 },
      { ply: 10, cp: -40 },
      { ply: 25, cp: 120 },
      { ply: 40, cp: 400 },
      { ply: 55, cp: 600 },
    ],
  };

  await prisma.game.create({
    data: {
      whiteId: w.id,
      blackId: b.id,
      moves: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7",
      result: GameResult.WHITE_WIN,
      status: GameStatus.COMPLETED,
      timeControl: "1+1",
      analysisJson,
    },
  });

  console.log("Seed OK. Demo login: grasevandir@seed.dchessacademy / demo1234");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
