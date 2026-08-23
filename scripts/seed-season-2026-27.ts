/**
 * Seed the 2026/27 season — BUILD_PLAN T0.1 step 7.
 *
 *   npx tsx scripts/seed-season-2026-27.ts
 *   SEED_SAMPLE_PLAYERS=0 npx tsx scripts/seed-season-2026-27.ts   # clubs only
 *
 * Re-runnable: every row is upserted on a deterministic key, so running it
 * twice changes nothing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS REAL AND WHAT IS SAMPLE — read this before showing anyone the site
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * REAL (locked by the academy, keep):
 *   • The 2026/27 season itself.
 *   • Its four divisions, named after their CATCHMENT, never after a region
 *     (BUILD_PLAN §2): Fako & Meme, Wouri, Mezam, Mfoundi — and their zones
 *     (COASTAL, GRASSFIELDS, CENTRE_SOUTH), from the locked four-zone split.
 *
 * SAMPLE (placeholder, MUST BE PURGED BEFORE LAUNCH — these sit on a public
 * credibility page and no real school has signed yet):
 *   • Every school, club, player, membership, fixture, board, event, honour and
 *     division entry created below.
 *
 * Sample rows are marked THREE ways so they cannot be mistaken for real data:
 *
 *   1. THE PRIMARY KEY of every sample row starts with "sample-". This is the
 *      one predicate that finds all of them, in every table:
 *
 *          SELECT * FROM clubs WHERE id LIKE 'sample-%';
 *
 *   2. Slugs start with "sample-", so every URL says so: /clubs/sample-limbe-a.
 *   3. Display names start with "SAMPLE - ", so the marker survives into any
 *      screenshot, OG card or PDF.
 *
 * TO FIND EVERYTHING, one query:
 *
 *   SELECT 'clubs' t, id, name FROM clubs               WHERE id LIKE 'sample-%'
 *   UNION ALL SELECT 'schools',           id, name       FROM schools           WHERE id LIKE 'sample-%'
 *   UNION ALL SELECT 'users',             id, username   FROM users             WHERE id LIKE 'sample-%'
 *   UNION ALL SELECT 'fixtures',          id, status::text FROM fixtures        WHERE id LIKE 'sample-%'
 *   UNION ALL SELECT 'division_entries',  id, ''         FROM division_entries  WHERE id LIKE 'sample-%'
 *   UNION ALL SELECT 'club_memberships',  id, ''         FROM club_memberships  WHERE id LIKE 'sample-%'
 *   UNION ALL SELECT 'club_honours',      id, title      FROM club_honours      WHERE id LIKE 'sample-%'
 *   UNION ALL SELECT 'fixture_boards',    id, ''         FROM fixture_boards    WHERE id LIKE 'sample-%'
 *   UNION ALL SELECT 'fixture_events',    id, message    FROM fixture_events    WHERE id LIKE 'sample-%';
 *
 * TO DELETE EVERYTHING, one statement (FK-safe order, wrapped so it is a single
 * paste into the Supabase SQL editor). The real season and its four divisions
 * survive:
 *
 *   DO $$
 *   BEGIN
 *     DELETE FROM fixture_events     WHERE id LIKE 'sample-%';
 *     DELETE FROM fixture_boards     WHERE id LIKE 'sample-%';
 *     DELETE FROM fixtures           WHERE id LIKE 'sample-%';
 *     DELETE FROM division_entries   WHERE id LIKE 'sample-%';
 *     DELETE FROM club_honours       WHERE id LIKE 'sample-%';
 *     DELETE FROM session_attendance WHERE id LIKE 'sample-%';
 *     DELETE FROM club_sessions      WHERE id LIKE 'sample-%';
 *     DELETE FROM club_memberships   WHERE id LIKE 'sample-%';
 *     DELETE FROM clubs              WHERE id LIKE 'sample-%';
 *     DELETE FROM guardian_consents  WHERE id LIKE 'sample-%';
 *     DELETE FROM profiles           WHERE id LIKE 'sample-%';
 *     DELETE FROM users              WHERE id LIKE 'sample-%';
 *     DELETE FROM schools            WHERE id LIKE 'sample-%';
 *   END $$;
 *
 * ⚠️ SEED_SAMPLE_PLAYERS: sample players are real rows in `users` and will
 * appear on the national rating leaderboard alongside genuine accounts. Set
 * SEED_SAMPLE_PLAYERS=0 to seed clubs, fixtures and tables without them.
 */

import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import {
  PrismaClient,
  ClubLevel,
  ClubStatus,
  Competition,
  ConsentStatus,
  EventKind,
  FixtureStatus,
  GameResult,
  GameSource,
  HonourKind,
  MembershipRole,
  MembershipStatus,
  PieceColor,
  PublicNameMode,
  SchoolKind,
  SeasonStatus,
  UserRole,
} from "@prisma/client";
import { SeasonService } from "../domains/season/season.service";

const prisma = new PrismaClient();

const SEED_PLAYERS = process.env.SEED_SAMPLE_PLAYERS !== "0";
const LABEL = "SAMPLE - ";

// ── The season (REAL) ─────────────────────────────────────────────────────────

const SEASON = {
  slug: "2026-27",
  name: "2026/27",
  startsOn: new Date("2026-09-07T00:00:00Z"),
  endsOn: new Date("2027-07-02T00:00:00Z"),
};

// ── The divisions (REAL, LOCKED) ──────────────────────────────────────────────
// Catchment names, never bare region names (BUILD_PLAN §2). Zones come from the
// locked geographic four-way split covering all ten regions.

interface DivisionSpec {
  key: string;
  name: string;
  zone: string;
  regions: string[];
  catchment: string;
}

const DIVISIONS: DivisionSpec[] = [
  { key: "fako", name: "Fako & Meme", zone: "COASTAL", regions: ["SOUTH_WEST"], catchment: "Limbe, Buea, Kumba" },
  { key: "wouri", name: "Wouri", zone: "COASTAL", regions: ["LITTORAL"], catchment: "Douala" },
  { key: "mezam", name: "Mezam", zone: "GRASSFIELDS", regions: ["NORTH_WEST"], catchment: "Bamenda" },
  { key: "mfoundi", name: "Mfoundi", zone: "CENTRE_SOUTH", regions: ["CENTRE"], catchment: "Yaounde" },
];

// ── The clubs (SAMPLE) ────────────────────────────────────────────────────────

interface ClubSpec {
  key: string;
  club: string;
  shortName: string;
  town: string;
  region: string;
  division: string;
  /** Two clubs sharing a schoolKey model "one school, more than one club" (§2). */
  schoolKey: string;
  school: string;
}

const CLUBS: ClubSpec[] = [
  // Fako & Meme — five clubs, deliberately ODD so every match day has a bye.
  { key: "limbe-a", club: "Limbe Secondary A", shortName: "LA", town: "Limbe", region: "SOUTH_WEST", division: "fako", schoolKey: "limbe-secondary", school: "Limbe Secondary School" },
  { key: "limbe-b", club: "Limbe Secondary B", shortName: "LB", town: "Limbe", region: "SOUTH_WEST", division: "fako", schoolKey: "limbe-secondary", school: "Limbe Secondary School" },
  { key: "buea-a", club: "Buea Secondary A", shortName: "BA", town: "Buea", region: "SOUTH_WEST", division: "fako", schoolKey: "buea-secondary", school: "Buea Secondary School" },
  { key: "buea-b", club: "Buea Secondary B", shortName: "BB", town: "Buea", region: "SOUTH_WEST", division: "fako", schoolKey: "buea-college", school: "Buea College" },
  { key: "kumba-a", club: "Kumba Secondary A", shortName: "KA", town: "Kumba", region: "SOUTH_WEST", division: "fako", schoolKey: "kumba-secondary", school: "Kumba Secondary School" },

  // Wouri — Douala.
  { key: "douala-a", club: "Douala Secondary A", shortName: "DA", town: "Douala", region: "LITTORAL", division: "wouri", schoolKey: "douala-secondary", school: "Douala Secondary School" },
  { key: "douala-b", club: "Douala Secondary B", shortName: "DB", town: "Douala", region: "LITTORAL", division: "wouri", schoolKey: "douala-college", school: "Douala College" },
  { key: "douala-c", club: "Douala Bonaberi A", shortName: "DC", town: "Douala", region: "LITTORAL", division: "wouri", schoolKey: "douala-bonaberi", school: "Douala Bonaberi School" },
  { key: "douala-d", club: "Douala Bonaberi B", shortName: "DD", town: "Douala", region: "LITTORAL", division: "wouri", schoolKey: "douala-bonaberi", school: "Douala Bonaberi School" },

  // Mezam — Bamenda.
  { key: "bamenda-a", club: "Bamenda Secondary A", shortName: "BM", town: "Bamenda", region: "NORTH_WEST", division: "mezam", schoolKey: "bamenda-secondary", school: "Bamenda Secondary School" },
  { key: "bamenda-b", club: "Bamenda Secondary B", shortName: "BN", town: "Bamenda", region: "NORTH_WEST", division: "mezam", schoolKey: "bamenda-college", school: "Bamenda College" },
  { key: "bamenda-c", club: "Bamenda Nkwen A", shortName: "BO", town: "Bamenda", region: "NORTH_WEST", division: "mezam", schoolKey: "bamenda-nkwen", school: "Bamenda Nkwen School" },
  { key: "bamenda-d", club: "Bamenda Nkwen B", shortName: "BP", town: "Bamenda", region: "NORTH_WEST", division: "mezam", schoolKey: "bamenda-nkwen", school: "Bamenda Nkwen School" },

  // Mfoundi — Yaounde.
  { key: "yaounde-a", club: "Yaounde Secondary A", shortName: "YA", town: "Yaounde", region: "CENTRE", division: "mfoundi", schoolKey: "yaounde-secondary", school: "Yaounde Secondary School" },
  { key: "yaounde-b", club: "Yaounde Secondary B", shortName: "YB", town: "Yaounde", region: "CENTRE", division: "mfoundi", schoolKey: "yaounde-college", school: "Yaounde College" },
  { key: "yaounde-c", club: "Yaounde Mvog-Ada A", shortName: "YC", town: "Yaounde", region: "CENTRE", division: "mfoundi", schoolKey: "yaounde-mvogada", school: "Yaounde Mvog-Ada School" },
  { key: "yaounde-d", club: "Yaounde Mvog-Ada B", shortName: "YD", town: "Yaounde", region: "CENTRE", division: "mfoundi", schoolKey: "yaounde-mvogada", school: "Yaounde Mvog-Ada School" },
];

// ── Sample players ────────────────────────────────────────────────────────────
// The first club's five players deliberately cover EVERY branch of the consent
// truth table (BUILD_PLAN §4.3), so the rule can be eyeballed on a live page:
//
//   board 1  adult                                  -> full name, avatar
//   board 2  minor, GRANTED,  publicNameMode FULL    -> full name, avatar
//   board 3  minor, GRANTED,  publicNameMode INITIAL -> "Brenda A.", no avatar
//   board 4  minor, PENDING                          -> "Brenda A.", no avatar
//   reserve  no Profile at all                       -> reduced, no avatar

type ConsentSpec = ConsentStatus | null;

interface PlayerSpec {
  handle: string;
  firstName: string | null;
  lastName: string | null;
  /** null = no Profile row at all — the protective default branch. */
  birthYear: number | null;
  consent: ConsentSpec;
  nameMode: PublicNameMode;
  rating: number;
  schoolYear: string;
  boardOrder: number | null;
  role?: MembershipRole;
}

const FIRST_NAMES = ["Brenda", "Ndip", "Achille", "Fri", "Mesumbe", "Junior", "Larissa", "Etienne", "Nadege", "Bertrand"];
const LAST_NAMES = ["Ateba", "Mbah", "Nkeng", "Tanyi", "Efon", "Bakang", "Ngwa", "Fotso", "Mbeki", "Sone"];

function showcaseSquad(): PlayerSpec[] {
  return [
    { handle: "a1", firstName: "Etienne", lastName: "Fotso", birthYear: 2004, consent: null, nameMode: PublicNameMode.INITIAL, rating: 1580, schoolYear: "Upper Sixth", boardOrder: 1, role: MembershipRole.CAPTAIN },
    { handle: "a2", firstName: "Brenda", lastName: "Ateba", birthYear: 2011, consent: ConsentStatus.GRANTED, nameMode: PublicNameMode.FULL, rating: 1470, schoolYear: "Form 5", boardOrder: 2 },
    { handle: "a3", firstName: "Ndip", lastName: "Mbah", birthYear: 2012, consent: ConsentStatus.GRANTED, nameMode: PublicNameMode.INITIAL, rating: 1390, schoolYear: "Form 4", boardOrder: 3 },
    { handle: "a4", firstName: "Fri", lastName: "Tanyi", birthYear: 2013, consent: ConsentStatus.PENDING, nameMode: PublicNameMode.INITIAL, rating: 1310, schoolYear: "Form 3", boardOrder: 4 },
    { handle: "a5", firstName: null, lastName: null, birthYear: null, consent: null, nameMode: PublicNameMode.INITIAL, rating: 1180, schoolYear: "Form 3", boardOrder: null },
  ];
}

/** Every other club: four team players, protective default throughout. */
function ordinarySquad(seed: number): PlayerSpec[] {
  return [1, 2, 3, 4].map((board) => {
    const i = (seed + board * 3) % FIRST_NAMES.length;
    const j = (seed * 2 + board) % LAST_NAMES.length;
    return {
      handle: `p${board}`,
      firstName: FIRST_NAMES[i],
      lastName: LAST_NAMES[j],
      birthYear: 2010 + (board % 3),
      consent: board === 1 ? ConsentStatus.GRANTED : ConsentStatus.PENDING,
      nameMode: PublicNameMode.INITIAL,
      rating: 1500 - seed * 17 - board * 35,
      schoolYear: `Form ${6 - board}`,
      boardOrder: board,
      role: board === 1 ? MembershipRole.CAPTAIN : MembershipRole.PLAYER,
    } satisfies PlayerSpec;
  });
}

// ── Fixture plan ──────────────────────────────────────────────────────────────
// Board outcomes are written from the HOME club's point of view ("H" | "A" |
// "D") and converted to the stored GameResult using that board's homeColor, so
// the seed exercises the same White-first / home-first conversion the scoring
// module owns rather than hard-coding WHITE_WIN everywhere.

type Outcome = "H" | "A" | "D";

interface FixturePlan {
  matchDay: number;
  home: string;
  away: string | null;
  status: FixtureStatus;
  /** One entry per board. Empty = no results recorded yet. */
  boards: Outcome[];
  venueTown: string;
}

/** Board 1 White at home, then alternating — the real match-day convention. */
function colorForBoard(boardNumber: number): PieceColor {
  return boardNumber % 2 === 1 ? PieceColor.WHITE : PieceColor.BLACK;
}

function resultFor(outcome: Outcome, homeColor: PieceColor): GameResult {
  if (outcome === "D") return GameResult.DRAW;
  const homeWins = outcome === "H";
  const homeIsWhite = homeColor === PieceColor.WHITE;
  return homeWins === homeIsWhite ? GameResult.WHITE_WIN : GameResult.BLACK_WIN;
}

/**
 * Two completed match days plus a third in progress, per division. Two
 * validated match days is the minimum that makes `previousPosition` — and so
 * the movement arrows on the public table — mean anything.
 */
function fixturePlan(clubs: ClubSpec[]): FixturePlan[] {
  const keys = clubs.map((c) => c.key);
  const town = clubs[0].town;
  const plans: FixturePlan[] = [];

  // The plan below is written against a division of four or five clubs and
  // indexes up to `clubs[4]`. Mezam shipped with three and this threw
  // `Cannot read properties of undefined (reading 'town')` partway through the
  // seed — after the season, divisions, clubs and players had already been
  // written, so the database was left half-seeded and the failure looked like
  // a database problem rather than an off-by-one in a fixture list.
  //
  // A division too small for a given pairing now skips that pairing instead of
  // crashing. Skipping is the right answer rather than inventing an opponent:
  // fixtures are sample data, and a division with fewer clubs simply has fewer
  // of them.
  const pair = (md: number, a: number, b: number, status: FixtureStatus, boards: Outcome[]) => {
    if (!clubs[a] || !clubs[b]) return;
    plans.push({ matchDay: md, home: keys[a], away: keys[b], status, boards, venueTown: clubs[a].town });
  };

  // Match day 1 — validated.
  pair(1, 0, 1, FixtureStatus.VALIDATED, ["H", "H", "D", "A"]); // 2.5 - 1.5
  pair(1, 2, 3, FixtureStatus.VALIDATED, ["D", "D", "D", "D"]); // 2 - 2
  if (keys.length === 5) {
    plans.push({ matchDay: 1, home: keys[4], away: null, status: FixtureStatus.VALIDATED, boards: [], venueTown: clubs[4]!.town });
  }

  // Match day 2 — validated.
  pair(2, 1, 2, FixtureStatus.VALIDATED, ["A", "A", "A", "D"]); // 0.5 - 3.5
  if (keys.length === 5) {
    pair(2, 3, 4, FixtureStatus.VALIDATED, ["H", "D", "H", "H"]); // 3.5 - 0.5
    plans.push({ matchDay: 2, home: keys[0], away: null, status: FixtureStatus.VALIDATED, boards: [], venueTown: town });
  } else {
    pair(2, 3, 0, FixtureStatus.VALIDATED, ["H", "D", "H", "H"]);
  }

  // Match day 3 — in flight. Between them these cover the remaining five
  // FixtureStatus values the public fixture page has to render (P1-9).
  pair(3, 0, 2, FixtureStatus.LIVE, ["H", "D"]); // two boards decided so far
  pair(3, 1, 3, FixtureStatus.AWAITING_VALIDATION, ["A", "H", "H", "D"]);
  if (keys.length === 5) {
    pair(3, 4, 0, FixtureStatus.SCHEDULED, []);
  }
  pair(4, 2, 1, FixtureStatus.TEAM_SHEETS, []);
  pair(4, 3, 0, FixtureStatus.CANCELLED, []);

  return plans;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function matchDayDate(matchDay: number): Date {
  // Saturdays, a fortnight apart, from the third week of the season.
  const start = new Date("2026-09-19T09:00:00Z").getTime();
  return new Date(start + (matchDay - 1) * 14 * 24 * 3600 * 1000);
}

async function main() {
  const startedAt = Date.now();
  console.log("Seeding the 2026/27 season.");
  console.log(SEED_PLAYERS ? "  Sample players: ON" : "  Sample players: OFF (SEED_SAMPLE_PLAYERS=0)");

  // ── Season ─────────────────────────────────────────────────────────────────
  // Exactly one season may be ACTIVE (BUILD_PLAN §4.1) — currentSeason() throws
  // otherwise, so refuse rather than create the fault.
  const otherActive = await prisma.season.findMany({
    where: { status: SeasonStatus.ACTIVE, slug: { not: SEASON.slug } },
  });
  if (otherActive.length > 0) {
    throw new Error(
      `Refusing to seed: ${otherActive.map((s) => s.slug).join(", ")} already ACTIVE. ` +
        "Exactly one season may be ACTIVE at a time (BUILD_PLAN §4.1). Archive it first."
    );
  }

  const season = await prisma.season.upsert({
    where: { slug: SEASON.slug },
    create: { ...SEASON, status: SeasonStatus.ACTIVE },
    update: { ...SEASON, status: SeasonStatus.ACTIVE },
  });
  console.log(`  Season ${season.name} (${season.slug})`);

  // ── Divisions ──────────────────────────────────────────────────────────────
  const divisionIds = new Map<string, string>();
  for (const spec of DIVISIONS) {
    const division = await prisma.division.upsert({
      where: {
        seasonId_name_level: {
          seasonId: season.id,
          name: spec.name,
          level: ClubLevel.SECONDARY,
        },
      },
      create: {
        seasonId: season.id,
        name: spec.name,
        zone: spec.zone,
        regions: spec.regions,
        level: ClubLevel.SECONDARY,
        totalMatchDays: 14,
      },
      update: { zone: spec.zone, regions: spec.regions, totalMatchDays: 14 },
    });
    divisionIds.set(spec.key, division.id);
    console.log(`  Division ${spec.name} (${spec.zone}) - ${spec.catchment}`);
  }

  // ── Schools + clubs (SAMPLE) ───────────────────────────────────────────────
  const schoolSpecs = new Map<string, ClubSpec>();
  for (const c of CLUBS) if (!schoolSpecs.has(c.schoolKey)) schoolSpecs.set(c.schoolKey, c);

  for (const [key, spec] of schoolSpecs) {
    await prisma.school.upsert({
      where: { id: `sample-school-${key}` },
      create: {
        id: `sample-school-${key}`,
        name: `${LABEL}${spec.school}`,
        slug: `sample-${key}`,
        region: spec.region,
        kind: SchoolKind.SECONDARY,
        town: spec.town,
      },
      update: { name: `${LABEL}${spec.school}`, region: spec.region, town: spec.town },
    });
  }

  for (const spec of CLUBS) {
    await prisma.club.upsert({
      where: { id: `sample-club-${spec.key}` },
      create: {
        id: `sample-club-${spec.key}`,
        slug: `sample-${spec.key}`,
        name: `${LABEL}${spec.club} Chess Club`,
        shortName: spec.shortName,
        schoolId: `sample-school-${spec.schoolKey}`,
        region: spec.region,
        level: ClubLevel.SECONDARY,
        status: ClubStatus.ACTIVE,
        // crestJson stays null on purpose: the client MUST be able to derive a
        // complete crest from the slug alone (BUILD_PLAN §5 fallback), and a
        // seed full of hand-written crests would hide a broken fallback.
        crestJson: undefined,
        joinCode: `SAMPLE-${spec.shortName}${spec.key.length}`,
        foundedOn: new Date("2026-09-07T00:00:00Z"),
      },
      update: {
        name: `${LABEL}${spec.club} Chess Club`,
        shortName: spec.shortName,
        region: spec.region,
        status: ClubStatus.ACTIVE,
      },
    });
  }
  console.log(`  ${CLUBS.length} sample clubs across ${schoolSpecs.size} sample schools`);

  // ── Players + memberships (SAMPLE, optional) ───────────────────────────────
  const teamByClub = new Map<string, { userId: string; boardOrder: number }[]>();

  if (SEED_PLAYERS) {
    // Sample accounts are not sign-in-able: the password is random and thrown
    // away, so the hash can never be matched.
    const unusablePassword = bcrypt.hashSync(randomBytes(24).toString("hex"), 10);
    let created = 0;

    for (const [index, spec] of CLUBS.entries()) {
      const squad = index === 0 ? showcaseSquad() : ordinarySquad(index);
      const team: { userId: string; boardOrder: number }[] = [];

      for (const p of squad) {
        const userId = `sample-user-${spec.key}-${p.handle}`;
        await prisma.user.upsert({
          where: { id: userId },
          create: {
            id: userId,
            email: `${spec.key}-${p.handle}@sample.invalid`,
            username: `sample_${spec.key.replace(/-/g, "_")}_${p.handle}`,
            passwordHash: unusablePassword,
            role: UserRole.STUDENT,
            schoolId: `sample-school-${spec.schoolKey}`,
            rating: p.rating,
            publicNameMode: p.nameMode,
            placementRequired: false,
            placementCompletedAt: new Date("2026-09-01T00:00:00Z"),
          },
          update: { rating: p.rating, publicNameMode: p.nameMode },
        });
        created += 1;

        if (p.firstName && p.lastName && p.birthYear) {
          await prisma.profile.upsert({
            where: { id: `sample-prof-${spec.key}-${p.handle}` },
            create: {
              id: `sample-prof-${spec.key}-${p.handle}`,
              userId,
              firstName: p.firstName,
              lastName: p.lastName,
              dateOfBirth: new Date(`${p.birthYear}-05-14T00:00:00Z`),
              country: "CM",
              avatarUrl: null,
            },
            update: { firstName: p.firstName, lastName: p.lastName },
          });
        }

        if (p.consent) {
          await prisma.guardianConsent.upsert({
            where: { id: `sample-gc-${spec.key}-${p.handle}` },
            create: {
              id: `sample-gc-${spec.key}-${p.handle}`,
              userId,
              status: p.consent,
              decidedAt: p.consent === ConsentStatus.PENDING ? null : new Date("2026-09-10T00:00:00Z"),
            },
            update: { status: p.consent },
          });
        }

        await prisma.clubMembership.upsert({
          where: { id: `sample-mem-${spec.key}-${p.handle}` },
          create: {
            id: `sample-mem-${spec.key}-${p.handle}`,
            clubId: `sample-club-${spec.key}`,
            userId,
            role: p.role ?? MembershipRole.PLAYER,
            status: MembershipStatus.ACTIVE,
            schoolYear: p.schoolYear,
            boardOrder: p.boardOrder,
          },
          update: { schoolYear: p.schoolYear, boardOrder: p.boardOrder, status: MembershipStatus.ACTIVE },
        });

        if (p.boardOrder) team.push({ userId, boardOrder: p.boardOrder });
      }

      team.sort((a, b) => a.boardOrder - b.boardOrder);
      teamByClub.set(spec.key, team);
    }
    console.log(`  ${created} sample players with ACTIVE memberships`);
  }

  // ── Division entries (SAMPLE rows in REAL divisions) ───────────────────────
  for (const spec of CLUBS) {
    const divisionId = divisionIds.get(spec.division);
    if (!divisionId) continue;
    await prisma.divisionEntry.upsert({
      where: { id: `sample-de-${spec.division}-${spec.key}` },
      create: {
        id: `sample-de-${spec.division}-${spec.key}`,
        divisionId,
        clubId: `sample-club-${spec.key}`,
      },
      update: {},
    });
  }

  // ── Fixtures, boards, events (SAMPLE) ──────────────────────────────────────
  let fixtureCount = 0;
  for (const div of DIVISIONS) {
    const divisionId = divisionIds.get(div.key)!;
    const clubs = CLUBS.filter((c) => c.division === div.key);

    for (const [i, plan] of fixturePlan(clubs).entries()) {
      const fixtureId = `sample-fx-${div.key}-md${plan.matchDay}-${i}`;
      const isBye = plan.away === null;
      const scheduledAt = matchDayDate(plan.matchDay);

      await prisma.fixture.upsert({
        where: { id: fixtureId },
        create: {
          id: fixtureId,
          seasonId: season.id,
          divisionId,
          competition: Competition.DIVISION,
          matchDay: plan.matchDay,
          homeClubId: `sample-club-${plan.home}`,
          awayClubId: plan.away ? `sample-club-${plan.away}` : null,
          // BUILD_PLAN §3.3 #4: a bye is a fixture — no away club, zero boards,
          // VALIDATED. Worth 3 match points and no board points.
          isBye,
          scheduledAt,
          venue: isBye ? null : `${LABEL}${plan.venueTown} hall`,
          boardCount: isBye ? 0 : 4,
          status: plan.status,
          validatedAt: plan.status === FixtureStatus.VALIDATED ? scheduledAt : null,
        },
        update: { status: plan.status, scheduledAt },
      });
      fixtureCount += 1;

      if (isBye) continue;

      const homeTeam = teamByClub.get(plan.home) ?? [];
      const awayTeam = teamByClub.get(plan.away!) ?? [];

      for (let b = 1; b <= 4; b += 1) {
        const homeColor = colorForBoard(b);
        const outcome = plan.boards[b - 1];
        await prisma.fixtureBoard.upsert({
          where: { id: `sample-fb-${fixtureId}-${b}` },
          create: {
            id: `sample-fb-${fixtureId}-${b}`,
            fixtureId,
            boardNumber: b,
            homeUserId: homeTeam.find((t) => t.boardOrder === b)?.userId ?? null,
            awayUserId: awayTeam.find((t) => t.boardOrder === b)?.userId ?? null,
            homeColor,
            // Boards 3 and 4 are played online, 1 and 2 over the board, so the
            // public page has both SourceTag states to render.
            source: b >= 3 ? GameSource.ONLINE : GameSource.OTB,
            result: outcome ? resultFor(outcome, homeColor) : null,
            recordedAt: outcome ? scheduledAt : null,
          },
          update: { result: outcome ? resultFor(outcome, homeColor) : null },
        });
      }

      const events: { kind: EventKind; board: number | null; message: string }[] = [
        { kind: EventKind.MATCH_START, board: null, message: `${LABEL}Clocks started on all four boards.` },
      ];
      plan.boards.forEach((outcome, idx) => {
        events.push({
          kind: EventKind.BOARD_RESULT,
          board: idx + 1,
          message: `${LABEL}Board ${idx + 1} finished (${outcome === "D" ? "drawn" : outcome === "H" ? "home win" : "away win"}).`,
        });
      });
      if (plan.status === FixtureStatus.VALIDATED) {
        events.push({ kind: EventKind.VALIDATED, board: null, message: `${LABEL}Result validated by the arbiter.` });
      }

      for (const [e, event] of events.entries()) {
        await prisma.fixtureEvent.upsert({
          where: { id: `sample-ev-${fixtureId}-${e}` },
          create: {
            id: `sample-ev-${fixtureId}-${e}`,
            fixtureId,
            kind: event.kind,
            board: event.board,
            message: event.message,
            occurredAt: new Date(scheduledAt.getTime() + e * 20 * 60 * 1000),
          },
          update: { message: event.message },
        });
      }
    }
  }
  console.log(`  ${fixtureCount} sample fixtures with boards and timeline events`);

  // ── Honours (SAMPLE) ───────────────────────────────────────────────────────
  const honours = [
    { key: "limbe-a", title: "Limbe Inter-Schools Rapid - Champions", kind: HonourKind.TROPHY },
    { key: "douala-a", title: "Wouri Cup - Runners-up", kind: HonourKind.TROPHY },
    { key: "bamenda-a", title: "Promoted to Mezam", kind: HonourKind.PROMOTION },
  ];
  for (const h of honours) {
    await prisma.clubHonour.upsert({
      where: { id: `sample-hon-${h.key}` },
      create: {
        id: `sample-hon-${h.key}`,
        clubId: `sample-club-${h.key}`,
        seasonId: season.id,
        title: `${LABEL}${h.title}`,
        kind: h.kind,
        awardedOn: new Date("2026-07-11T00:00:00Z"),
      },
      update: { title: `${LABEL}${h.title}` },
    });
  }

  // ── Recompute the tables ───────────────────────────────────────────────────
  // Public reads derive their table anyway; this writes the same numbers onto
  // DivisionEntry so the persisted rows are not stale nonsense, using the same
  // pure module (domains/fixture/scoring.ts) and never incrementing in place.
  const seasons = new SeasonService(prisma);
  for (const div of DIVISIONS) {
    const table = await seasons.persistDivisionTable(divisionIds.get(div.key)!);
    const leader = table[0];
    console.log(
      `  ${div.name}: ${table.length} clubs, leader ${leader?.club.name ?? "-"} ` +
        `(${leader?.matchPoints ?? 0} pts, ${leader?.boardPoints ?? 0} board pts)`
    );
  }

  console.log(`Done in ${Math.round((Date.now() - startedAt) / 100) / 10}s.`);
  console.log("REMINDER: every sample row's primary key starts with 'sample-'. Purge before launch.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
