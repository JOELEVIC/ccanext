/**
 * ══════════════════════════════════════════════════════════════════════════
 * Remove the sample academy — PLATFORM_ROADMAP Milestone 3.1.
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   npx tsx scripts/purge-sample-data.ts                  # dry run, counts only
 *   npx tsx scripts/purge-sample-data.ts --apply          # delete
 *   npx tsx scripts/purge-sample-data.ts --apply --allow-empty
 *
 * Every seeded row is marked three ways — `sample-` primary key, `sample-`
 * slug, `SAMPLE - ` display name — and this deletes on the primary key, which
 * is the one a human cannot accidentally reproduce when typing a real club
 * name.
 *
 * The real season and its four divisions survive. They were always real.
 *
 * ── Why this is a script and not the SQL in the seed's header ─────────────
 *
 * It was a paste-into-Supabase statement, which meant the single most
 * destructive operation in the project had no dry run, no counts, and no way
 * to be wrong safely. It also could not enforce the one rule the roadmap
 * writes down about it.
 *
 * ── The rule it enforces ──────────────────────────────────────────────────
 *
 * **"Run the purge only once real clubs are ready to replace them — the site
 * should not go empty in between."**
 *
 * A comment cannot enforce that; this refuses. If deleting the sample rows
 * would leave `/clubs` with nothing in it, the script stops and says so.
 * `--allow-empty` is there for the case where that is genuinely wanted, and
 * requires someone to have decided it on purpose.
 *
 * ── Order ─────────────────────────────────────────────────────────────────
 *
 * Children before parents, so no delete hits a foreign key. Most of these
 * would cascade from `users` or `clubs` anyway; doing it explicitly means the
 * counts printed are real counts rather than a guess about what cascaded.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const ALLOW_EMPTY = process.argv.includes("--allow-empty");

const SAMPLE = { startsWith: "sample-" } as const;

/** Children first. The label is what gets printed. */
const STEPS: { label: string; count: () => Promise<number>; remove: () => Promise<{ count: number }> }[] = [
  {
    label: "fixture events",
    count: () => prisma.fixtureEvent.count({ where: { id: SAMPLE } }),
    remove: () => prisma.fixtureEvent.deleteMany({ where: { id: SAMPLE } }),
  },
  {
    label: "fixture boards",
    // Two prefixes: division boards are `sample-fb-`, cup boards `sample-cfb-`.
    // Both start `sample-`, so one filter covers them — but a board attached to
    // a sample fixture without the prefix would survive, so the fixture id is
    // checked too.
    count: () =>
      prisma.fixtureBoard.count({ where: { OR: [{ id: SAMPLE }, { fixtureId: SAMPLE }] } }),
    remove: () =>
      prisma.fixtureBoard.deleteMany({ where: { OR: [{ id: SAMPLE }, { fixtureId: SAMPLE }] } }),
  },
  {
    label: "fixtures",
    count: () => prisma.fixture.count({ where: { id: SAMPLE } }),
    remove: () => prisma.fixture.deleteMany({ where: { id: SAMPLE } }),
  },
  {
    label: "division entries",
    count: () => prisma.divisionEntry.count({ where: { OR: [{ id: SAMPLE }, { clubId: SAMPLE }] } }),
    remove: () =>
      prisma.divisionEntry.deleteMany({ where: { OR: [{ id: SAMPLE }, { clubId: SAMPLE }] } }),
  },
  {
    label: "club honours",
    count: () => prisma.clubHonour.count({ where: { OR: [{ id: SAMPLE }, { clubId: SAMPLE }] } }),
    remove: () => prisma.clubHonour.deleteMany({ where: { OR: [{ id: SAMPLE }, { clubId: SAMPLE }] } }),
  },
  {
    label: "session attendance",
    count: () => prisma.sessionAttendance.count({ where: { OR: [{ id: SAMPLE }, { userId: SAMPLE }] } }),
    remove: () =>
      prisma.sessionAttendance.deleteMany({ where: { OR: [{ id: SAMPLE }, { userId: SAMPLE }] } }),
  },
  {
    label: "club sessions",
    count: () => prisma.clubSession.count({ where: { OR: [{ id: SAMPLE }, { clubId: SAMPLE }] } }),
    remove: () => prisma.clubSession.deleteMany({ where: { OR: [{ id: SAMPLE }, { clubId: SAMPLE }] } }),
  },
  {
    label: "club memberships",
    count: () =>
      prisma.clubMembership.count({ where: { OR: [{ id: SAMPLE }, { clubId: SAMPLE }, { userId: SAMPLE }] } }),
    remove: () =>
      prisma.clubMembership.deleteMany({
        where: { OR: [{ id: SAMPLE }, { clubId: SAMPLE }, { userId: SAMPLE }] },
      }),
  },
  {
    label: "clubs",
    count: () => prisma.club.count({ where: { id: SAMPLE } }),
    remove: () => prisma.club.deleteMany({ where: { id: SAMPLE } }),
  },
  {
    label: "guardian consents",
    count: () => prisma.guardianConsent.count({ where: { OR: [{ id: SAMPLE }, { userId: SAMPLE }] } }),
    remove: () =>
      prisma.guardianConsent.deleteMany({ where: { OR: [{ id: SAMPLE }, { userId: SAMPLE }] } }),
  },
  {
    label: "player ratings",
    // Not in the original SQL. These cascade from `users`, but a sample
    // player's rating is the row that would otherwise sit on the national
    // leaderboard, so it is counted explicitly rather than assumed.
    count: () => prisma.playerRating.count({ where: { userId: SAMPLE } }),
    remove: () => prisma.playerRating.deleteMany({ where: { userId: SAMPLE } }),
  },
  {
    label: "profiles",
    count: () => prisma.profile.count({ where: { OR: [{ id: SAMPLE }, { userId: SAMPLE }] } }),
    remove: () => prisma.profile.deleteMany({ where: { OR: [{ id: SAMPLE }, { userId: SAMPLE }] } }),
  },
  {
    label: "users",
    count: () => prisma.user.count({ where: { id: SAMPLE } }),
    remove: () => prisma.user.deleteMany({ where: { id: SAMPLE } }),
  },
  {
    label: "schools",
    count: () => prisma.school.count({ where: { id: SAMPLE } }),
    remove: () => prisma.school.deleteMany({ where: { id: SAMPLE } }),
  },
];

async function main() {
  const before = await prisma.club.count();
  const sampleClubs = await prisma.club.count({ where: { id: SAMPLE } });
  const realClubs = before - sampleClubs;

  console.log(`\n${APPLY ? "Purging" : "DRY RUN — nothing will be deleted"}\n`);

  let total = 0;
  const planned: { label: string; n: number }[] = [];
  for (const step of STEPS) {
    const n = await step.count();
    planned.push({ label: step.label, n });
    total += n;
  }
  for (const { label, n } of planned) {
    console.log(`  ${String(n).padStart(5)}  ${label}`);
  }
  console.log(`  ${String(total).padStart(5)}  rows in total`);

  console.log(`\n  clubs now: ${before}  ·  real: ${realClubs}  ·  sample: ${sampleClubs}`);

  // The rule from the roadmap, enforced.
  if (realClubs === 0 && !ALLOW_EMPTY) {
    console.error(
      "\nRefusing to purge: this would leave /clubs with nothing in it.\n" +
        "Milestone 3.1 says to run this only once real clubs are ready to replace\n" +
        "the samples. Onboard them first with scripts/onboard-clubs.ts, or pass\n" +
        "--allow-empty if an empty site is genuinely what you want."
    );
    process.exit(1);
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to delete.");
    return;
  }

  for (const step of STEPS) {
    const { count } = await step.remove();
    if (count) console.log(`  removed ${count} ${step.label}`);
  }

  const after = await prisma.club.count();
  const leftovers = await prisma.club.count({ where: { id: SAMPLE } });
  console.log(`\nDone. Clubs: ${after}. Sample clubs remaining: ${leftovers}.`);
  console.log("Check clubNetworkSummary on the deployed API before announcing anything.");
}

main()
  .catch((error) => {
    console.error("\n" + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
