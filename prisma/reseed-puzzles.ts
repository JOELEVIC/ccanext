/**
 * Reseed the puzzles table from the canonical list in
 * backfill-puzzles-and-profiles.ts.
 *
 * Use this when the puzzles table already has stale / broken entries
 * (the backfill script skips when puzzles exist). This script DELETES
 * everything first, then re-inserts the verified set.
 *
 *   npx tsx prisma/reseed-puzzles.ts          # safe — prints what would change
 *   FORCE=1 npx tsx prisma/reseed-puzzles.ts  # actually wipe + reinsert
 *
 * Every solution is a single ply that has been validated against
 * chess.js. Mate-in-1 puzzles produce checkmate; tactic puzzles play
 * a legal key move.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface PuzzleSpec {
  fen: string;
  solution: string;
  difficulty: number;
  theme: string[];
}

const PUZZLES: PuzzleSpec[] = [
  // === Mate in 1 ===
  { fen: "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2",      solution: "d8h4",  difficulty: 600,  theme: ["mateIn1", "fool"] },
  { fen: "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1",                                solution: "a1a8",  difficulty: 700,  theme: ["mateIn1", "backRank"] },
  { fen: "6k1/5ppp/8/8/8/8/3Q1PPP/6K1 w - - 0 1",                               solution: "d2d8",  difficulty: 1100, theme: ["mateIn1", "queenMate", "backRank"] },
  { fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", solution: "h5f7",  difficulty: 900,  theme: ["mateIn1", "scholarsMate"] },
  { fen: "6rk/6pp/7N/8/8/8/8/7K w - - 0 1",                                     solution: "h6f7",  difficulty: 1500, theme: ["mateIn1", "smotheredMate"] },
  { fen: "7k/8/5K2/8/8/8/8/6Q1 w - - 0 1",                                      solution: "g1g7",  difficulty: 900,  theme: ["mateIn1", "endgame"] },
  { fen: "7k/5Npp/8/8/8/8/8/4Q2K w - - 0 1",                                    solution: "e1e8",  difficulty: 1100, theme: ["mateIn1", "knight"] },
  { fen: "7k/6p1/6KQ/8/8/8/8/8 w - - 0 1",                                      solution: "h6g7",  difficulty: 1300, theme: ["mateIn1", "supportedMate"] },
  { fen: "6k1/5ppp/8/8/8/8/5PPP/R3R1K1 w - - 0 1",                              solution: "a1a8",  difficulty: 800,  theme: ["mateIn1", "backRank"] },

  // === Wins material / forks ===
  { fen: "r1b1kb1r/pppp1ppp/2n2n2/4p1q1/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 0 1", solution: "f3g5", difficulty: 1000, theme: ["winsMaterial", "knight"] },
  { fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R b KQkq - 0 5",    solution: "f6e4", difficulty: 1200, theme: ["fork", "knight"] },
  { fen: "r3k3/8/8/3N4/8/8/8/3K4 w - - 0 1",                                          solution: "d5c7", difficulty: 1100, theme: ["fork", "knight"] },
  { fen: "r3k2r/ppp2ppp/2n5/3qp3/8/2P2N2/PP3PPP/R2QK2R w KQkq - 0 1",                solution: "f3e5", difficulty: 1400, theme: ["removeDefender", "knight"] },

  // === Sacrifices / attacks ===
  { fen: "r1bq1rk1/ppp2ppp/2n2n2/3p4/1bPP4/2N1PN2/PP1B1PPP/R2QKB1R w KQ - 0 1",      solution: "c3d5", difficulty: 1800, theme: ["sacrifice", "knight"] },
  { fen: "r1bq1rk1/pp1nbppp/2p1pn2/3p4/3P4/3BPN2/PPPN1PPP/R1BQ1RK1 w - - 0 1",       solution: "d3h7", difficulty: 1700, theme: ["sacrifice", "greekGift"] },
  { fen: "r4rk1/pp3ppp/2nq4/2bp4/4n3/PB3N2/1PP1QPPP/2BR1RK1 w - - 0 1",              solution: "c1h6", difficulty: 1700, theme: ["sacrifice", "discovery"] },
  { fen: "r1bq1rk1/ppp2ppp/2n5/3P4/2B5/5N2/PP3PPP/RNBQ1RK1 w - - 0 1",               solution: "d5c6", difficulty: 1600, theme: ["pawnCapture", "openFile"] },

  // === Endgame ===
  { fen: "8/8/3k4/8/8/3PK3/8/8 w - - 0 1",                                            solution: "d3d4",  difficulty: 1400, theme: ["endgame", "opposition"] },
  { fen: "8/4P3/4k3/8/8/8/8/4K3 w - - 0 1",                                           solution: "e7e8q", difficulty: 800,  theme: ["endgame", "promotion"] },
  { fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1",                                        solution: "c1c4",  difficulty: 2000, theme: ["endgame", "lucena", "rookEndgame"] },
];

async function main(): Promise<void> {
  const force = process.env.FORCE === "1";
  const existing = await prisma.puzzle.count();
  console.log(`Found ${existing} existing puzzles. New canonical list has ${PUZZLES.length}.`);
  if (!force) {
    console.log("DRY RUN — set FORCE=1 to actually wipe and reseed.");
    return;
  }
  console.log("→ deleting all puzzles…");
  await prisma.puzzle.deleteMany({});
  console.log(`→ inserting ${PUZZLES.length} verified puzzles…`);
  for (const p of PUZZLES) {
    await prisma.puzzle.create({ data: p });
  }
  console.log("✓ reseed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
