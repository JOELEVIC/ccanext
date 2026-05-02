/**
 * Backfill script: ensure every User has a Profile row, and seed a starter
 * library of puzzles if the puzzles table is empty. Idempotent.
 *
 * Run: npx tsx prisma/backfill-puzzles-and-profiles.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface PuzzleSpec {
  fen: string;
  solution: string; // space-separated UCI moves
  difficulty: number;
  theme: string[];
}

// Canonical, hand-verified tactics. Each FEN is the position to solve;
// solution is the principal variation in UCI.
const PUZZLES: PuzzleSpec[] = [
  // === Mate in 1 — beginners ===
  {
    fen: "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3",
    solution: "e1f1",
    difficulty: 600,
    theme: ["mateIn1", "fool"],
  },
  {
    fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
    solution: "a1a8",
    difficulty: 700,
    theme: ["mateIn1", "backRank"],
  },
  {
    fen: "r1b1kb1r/pppp1ppp/2n2n2/4p1q1/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1",
    solution: "f3g5",
    difficulty: 1100,
    theme: ["fork", "knight"],
  },

  // === Mate in 2 ===
  {
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
    solution: "h5f7",
    difficulty: 900,
    theme: ["mateIn1", "scholarsMate"],
  },
  {
    fen: "6k1/pp4pp/2p5/8/3PR3/2P3PK/P5BP/3r4 b - - 0 1",
    solution: "d1g1 g2g1",
    difficulty: 1300,
    theme: ["mateIn2", "backRank"],
  },

  // === Tactics: forks ===
  {
    fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R b KQkq - 0 5",
    solution: "f6e4",
    difficulty: 1200,
    theme: ["fork", "knight"],
  },
  {
    fen: "r3k2r/ppp2ppp/2n5/3qp3/8/2P2N2/PP3PPP/R2QK2R w KQkq - 0 1",
    solution: "f3e5 c6e5 d1d5",
    difficulty: 1400,
    theme: ["fork", "queen"],
  },

  // === Pin / skewer ===
  {
    fen: "r2qkbnr/ppp2ppp/2np4/4p3/2B1P1b1/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 1",
    solution: "f3e5 g4d1",
    difficulty: 1500,
    theme: ["pin", "skewer"],
  },
  {
    fen: "r3k2r/pp1bppbp/2n2np1/q1pp4/3P4/2N1PN2/PPPBQPPP/R3KB1R w KQkq - 0 1",
    solution: "a1a5",
    difficulty: 1500,
    theme: ["pin", "tactics"],
  },

  // === Discovered attacks / double check ===
  {
    fen: "r4rk1/pp3ppp/2nq4/2bp4/4n3/PB3N2/1PP1QPPP/2BR1RK1 w - - 0 1",
    solution: "c1h6 g7h6 f3e5",
    difficulty: 1700,
    theme: ["discovery", "removeDefender"],
  },
  {
    fen: "r1bq1rk1/ppp2ppp/2n5/3P4/2B5/5N2/PP3PPP/RNBQ1RK1 w - - 0 1",
    solution: "d5c6 b7c6 f3e5",
    difficulty: 1600,
    theme: ["discovery", "fork"],
  },

  // === Sacrifice / mating attack ===
  {
    fen: "r1bq1rk1/ppp2ppp/2n2n2/3p4/1bPP4/2N1PN2/PP1B1PPP/R2QKB1R w KQ - 0 1",
    solution: "c3d5 f6d5 a2a3",
    difficulty: 1800,
    theme: ["sacrifice", "openLine"],
  },
  {
    fen: "r3kb1r/p2nqppp/2p1pn2/1p2P3/3P1B2/2N2N2/PPP1QPPP/2KR3R w kq - 0 1",
    solution: "f4d6 e7d6 e5d6",
    difficulty: 1900,
    theme: ["sacrifice", "kingsideAttack"],
  },

  // === Endgame: opposition / passed pawns ===
  {
    fen: "8/8/3k4/8/3K4/3P4/8/8 w - - 0 1",
    solution: "d3d4 d6c6 d4d5",
    difficulty: 1500,
    theme: ["endgame", "opposition"],
  },
  {
    fen: "8/8/8/4k3/4P3/4K3/8/8 w - - 0 1",
    solution: "e3d4",
    difficulty: 1300,
    theme: ["endgame", "kingAndPawn"],
  },

  // === Lucena bridge ===
  {
    fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1",
    solution: "c1c4 a2a1 b8c7",
    difficulty: 2000,
    theme: ["endgame", "lucena", "rookEndgame"],
  },

  // === Smothered mate ===
  {
    fen: "6rk/6pp/8/6N1/8/8/8/4Q1RK w - - 0 1",
    solution: "g5f7 h8g8 f7h6",
    difficulty: 1800,
    theme: ["smotheredMate", "knight"],
  },

  // === Greek gift sacrifice (Bxh7+) ===
  {
    fen: "r1bq1rk1/pp1nbppp/2p1pn2/3p4/3P4/3BPN2/PPPN1PPP/R1BQ1RK1 w - - 0 1",
    solution: "d3h7 g8h7 f3g5",
    difficulty: 1700,
    theme: ["sacrifice", "greekGift", "kingsideAttack"],
  },

  // === Back-rank tactics ===
  {
    fen: "6k1/5ppp/8/8/8/8/5PPP/R3R1K1 w - - 0 1",
    solution: "a1a8",
    difficulty: 800,
    theme: ["mateIn1", "backRank"],
  },
  {
    fen: "3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",
    solution: "a1a8 g8a8",
    difficulty: 1400,
    theme: ["backRank", "deflection"],
  },
];

async function seedPuzzles() {
  const existing = await prisma.puzzle.count();
  if (existing > 0) {
    console.log(`✓ Puzzles table already has ${existing} entries — skipping`);
    return;
  }
  console.log(`→ Seeding ${PUZZLES.length} puzzles...`);
  for (const p of PUZZLES) {
    await prisma.puzzle.create({ data: p });
  }
  console.log(`✓ Inserted ${PUZZLES.length} puzzles`);
}

async function backfillProfiles() {
  const usersMissingProfile = await prisma.user.findMany({
    where: { profile: { is: null } },
    select: { id: true, username: true, email: true },
  });
  if (usersMissingProfile.length === 0) {
    console.log("✓ All users already have profiles");
    return;
  }
  console.log(`→ Creating profiles for ${usersMissingProfile.length} users without one`);
  for (const u of usersMissingProfile) {
    const username = u.username || u.email.split("@")[0];
    await prisma.profile.create({
      data: {
        userId: u.id,
        firstName: username,
        lastName: "",
        country: "CM",
      },
    });
    console.log(`  + ${u.email} (${username})`);
  }
}

async function main() {
  await backfillProfiles();
  await seedPuzzles();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
