/**
 * ══════════════════════════════════════════════════════════════════════════
 * Draw a division's fixtures — PLATFORM_ROADMAP Milestone 3.3.
 * ══════════════════════════════════════════════════════════════════════════
 *
 *   npx tsx scripts/draw-fixtures.ts --division "Fako & Meme" --from 2026-09-19
 *   npx tsx scripts/draw-fixtures.ts --division "Fako & Meme" --from 2026-09-19 --apply
 *
 * Options:
 *   --division <name>   required; must exist in the ACTIVE season
 *   --from <YYYY-MM-DD> the first match day; the rest fall every --every days
 *   --every <n>         days between match days (default 14)
 *   --boards <n>        boards per fixture (default 4)
 *   --venue "<text>"    venue label; defaults to the home club's town
 *   --apply             write; otherwise print the draw and stop
 *
 * ── It reuses the pairing engine ──────────────────────────────────────────
 *
 * `roundRobinSchedule` in `domains/tournament/pairing.ts` is the Berger circle
 * method with colour balancing and dummy handling, and it has real tests. A
 * league draw is the same problem as a round-robin tournament draw, so this
 * calls it rather than writing a second implementation that would drift.
 *
 * What this adds on top is the league's own rules:
 *
 *   · **A bye is a fixture.** BUILD_PLAN §3.3 invariant 4 — `isBye: true`, no
 *     away club, `boardCount: 0`, created `VALIDATED`. It increments `played`,
 *     carries the bye credit into match points and contributes zero board
 *     points. The pairing engine returns a null opponent; this turns that into
 *     a row rather than dropping it.
 *   · **Home and away are the pairing's colours.** The engine already
 *     alternates them for balance, so a club that is home on match day 1 is
 *     away on match day 2, which is what makes a venue rota fair.
 *
 * ── Idempotent, and the key is why ────────────────────────────────────────
 *
 * Fixture ids are `draw-<division-slug>-md<n>-<i>`, derived from the draw
 * rather than random, so re-running with a corrected date moves the fixtures
 * instead of creating a second season's worth beside them. Re-running after
 * results have been entered updates the schedule and leaves the boards alone.
 */

import { Competition, FixtureStatus, PrismaClient } from "@prisma/client";

import { balanceHomeAway, hostingSpread } from "../domains/fixture/drawBalance";
import { roundRobinSchedule } from "../domains/tournament/pairing";

const prisma = new PrismaClient();

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
}
const APPLY = process.argv.includes("--apply");

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  const divisionName = arg("division");
  const from = arg("from");
  const every = Number(arg("every", "14"));
  const boards = Number(arg("boards", "4"));
  const venueArg = arg("venue");

  if (!divisionName || !from) {
    console.error('Usage: --division "Fako & Meme" --from 2026-09-19 [--every 14] [--apply]');
    process.exit(1);
  }
  const firstDay = new Date(`${from}T15:00:00+01:00`);
  if (Number.isNaN(firstDay.getTime())) throw new Error(`--from ${from} is not a date`);

  const season = await prisma.season.findFirst({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, startsOn: true, endsOn: true },
  });
  if (!season) throw new Error("No ACTIVE season.");

  const division = await prisma.division.findFirst({
    where: { seasonId: season.id, name: divisionName },
    select: { id: true, name: true },
  });
  if (!division) {
    const have = await prisma.division.findMany({
      where: { seasonId: season.id },
      select: { name: true },
    });
    throw new Error(
      `Division ${JSON.stringify(divisionName)} not in ${season.name}. Have: ${have.map((d) => d.name).join(", ")}`
    );
  }

  const entries = await prisma.divisionEntry.findMany({
    where: { divisionId: division.id },
    select: { club: { select: { id: true, name: true, slug: true, school: { select: { town: true } } } } },
  });
  const clubs = entries.map((e) => e.club);

  if (clubs.length < 2) {
    throw new Error(
      `${division.name} has ${clubs.length} club(s). Onboard clubs into it first — scripts/onboard-clubs.ts.`
    );
  }

  const byId = new Map(clubs.map((c) => [c.id, c]));

  // The pairing engine balances colours, which is the right thing for a
  // tournament in one room. A league is not in one room — the first-named club
  // hosts, which means paying for a hall or paying for a bus. Raw, a five-club
  // draw came out 0/2/2/2/4: one club hosting everything, one travelling to
  // everything. See `domains/fixture/drawBalance.ts`.
  const rounds = balanceHomeAway(
    roundRobinSchedule(clubs.map((c) => c.id)).map((round) =>
      round.map((p) => ({ homeClubId: p.whiteUserId, awayClubId: p.blackUserId }))
    )
  );

  const lastDay = new Date(firstDay.getTime() + (rounds.length - 1) * every * 86400000);
  if (lastDay > season.endsOn) {
    console.warn(
      `\n  ! The last match day (${lastDay.toISOString().slice(0, 10)}) falls after the season ends ` +
        `(${season.endsOn.toISOString().slice(0, 10)}). Shorten --every or move --from.\n`
    );
  }

  console.log(
    `\n${division.name} · ${season.name} · ${clubs.length} clubs · ${rounds.length} match days` +
      `${APPLY ? "" : "   (DRY RUN — nothing written)"}\n`
  );

  let written = 0;

  for (const [r, round] of rounds.entries()) {
    const matchDay = r + 1;
    const scheduledAt = new Date(firstDay.getTime() + r * every * 86400000);
    console.log(`  Match day ${matchDay} — ${scheduledAt.toISOString().slice(0, 10)}`);

    for (const [i, pairing] of round.entries()) {
      const home = byId.get(pairing.homeClubId)!;
      const away = pairing.awayClubId ? byId.get(pairing.awayClubId)! : null;
      const fixtureId = `draw-${slugify(division.name)}-md${matchDay}-${i}`;

      console.log(
        away ? `      ${home.name}  v  ${away.name}` : `      ${home.name}  — bye`
      );

      if (!APPLY) continue;

      await prisma.fixture.upsert({
        where: { id: fixtureId },
        create: {
          id: fixtureId,
          seasonId: season.id,
          divisionId: division.id,
          competition: Competition.DIVISION,
          matchDay,
          homeClubId: home.id,
          awayClubId: away?.id ?? null,
          // BUILD_PLAN §3.3 #4 — a bye is a fixture, validated on creation
          // because there is nothing to play and nothing to validate later.
          isBye: !away,
          scheduledAt,
          venue: away ? (venueArg ?? `${home.school?.town ?? home.name} hall`) : null,
          boardCount: away ? boards : 0,
          status: away ? FixtureStatus.SCHEDULED : FixtureStatus.VALIDATED,
          validatedAt: away ? null : scheduledAt,
        },
        // A re-draw moves the date and the pairing. It does NOT touch status
        // or scores: a fixture that has already been played keeps its result.
        update: {
          matchDay,
          scheduledAt,
          homeClubId: home.id,
          awayClubId: away?.id ?? null,
          isBye: !away,
        },
      });
      written += 1;
    }
  }

  // Printed every time: an unbalanced draw is invisible in a fixture list and
  // expensive to the club on the wrong end of it.
  console.log(`\n  hosting spread: ${hostingSpread(rounds)} (0 or 1 is fair)`);
  console.log(
    APPLY
      ? `${written} fixtures written. Appoint arbiters before the first match day.`
      : "Re-run with --apply to write."
  );
}

main()
  .catch((error) => {
    console.error("\n" + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
