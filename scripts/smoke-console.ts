/**
 * End-to-end smoke test for the patron console — Milestone 4.3.
 *
 *   npx tsx scripts/smoke-console.ts [--api https://api.dchessacademy.com]
 *
 * Walks the whole match day against the DEPLOYED GraphQL API, with real HTTP
 * and real auth, then deletes everything it made. Nothing here is mocked: the
 * point is to prove the deployment works, not that the code compiles.
 *
 * ── Why it builds its own world ───────────────────────────────────────────
 *
 * The seeded sample accounts cannot sign in — their password hash is random
 * and thrown away — so there is no existing patron to act as. And validating a
 * seeded fixture would write Glicko ratings to sample players that nothing can
 * cleanly reverse.
 *
 * So the script creates a throwaway school, club, three users and one fixture,
 * all prefixed `smoke-`, exercises them, and removes them in a finally block.
 * A run that crashes half way still cleans up. Ratings vanish with the users
 * that own them.
 *
 * ── What it proves ────────────────────────────────────────────────────────
 *
 *   · a patron sees their club, its join code and its pending requests
 *   · admitting, promoting and removing a member
 *   · scheduling a session and taking a register
 *   · a team sheet, and that it locks once a result exists
 *   · both clubs recording board results, and the derived score
 *   · the status walking SCHEDULED to AWAITING_VALIDATION on its own
 *   · a patron being REFUSED validation of their own fixture
 *   · the appointed arbiter validating it, and every board rating exactly once
 */

import { randomBytes } from "node:crypto";

import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const API = (process.argv.includes("--api")
  ? process.argv[process.argv.indexOf("--api") + 1]
  : "https://api.dchessacademy.com"
).replace(/\/$/, "");
const ENDPOINT = `${API}/api/graphql`;

const TAG = `smoke-${randomBytes(4).toString("hex")}`;
/** Usernames cap at 20 characters; e-mails do not. */
const SHORT = TAG.replace("smoke-", "sm").slice(0, 10);
const prisma = new PrismaClient();

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail === undefined ? "" : ` — ${JSON.stringify(detail)}`}`);
  }
}

async function gql<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown>,
  token?: string
): Promise<{ data?: T; error?: string }> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (json.errors?.length) return { error: json.errors[0].message };
  return { data: json.data };
}

async function register(handle: string): Promise<{ id: string; token: string }> {
  const password = `Smoke!${randomBytes(6).toString("hex")}`;
  const { data, error } = await gql<{ register: { token: string; user: { id: string } } }>(
    `mutation ($input: RegisterInput!) {
       register(input: $input) { token user { id } }
     }`,
    {
      input: {
        email: `${TAG}-${handle}@smoke.invalid`,
        username: `${SHORT}_${handle}`.slice(0, 20).replace(/-/g, "_"),
        password,
        role: "STUDENT",
        firstName: "Smoke",
        lastName: handle,
      },
    }
  );
  if (!data?.register?.token) throw new Error(`register(${handle}) failed: ${error}`);
  return { id: data.register.user.id, token: data.register.token };
}

async function main() {
  console.log(`Patron console smoke test — ${TAG} against ${API}\n`);

  const patron = await register("patron");
  const rival = await register("rival");
  const arbiter = await register("arbiter");
  const player = await register("player");
  const guest = await register("guest");

  // ── the world ───────────────────────────────────────────────────────────
  // Written directly: onboarding a school and a club is Milestone 5's job and
  // has no public mutation. Everything the console itself does goes over HTTP.
  const season = await prisma.season.findFirst({ orderBy: { startsOn: "desc" } });
  if (!season) throw new Error("No season in the database");

  await prisma.school.create({
    data: { id: `${TAG}-school`, name: `SMOKE ${TAG}`, region: "SOUTH_WEST" },
  });

  for (const [key, name] of [
    ["home", "SMOKE Home"],
    ["away", "SMOKE Away"],
  ] as const) {
    await prisma.club.create({
      data: {
        id: `${TAG}-club-${key}`,
        slug: `${TAG}-${key}`,
        name: `${name} Chess Club`,
        shortName: key === "home" ? "SH" : "SA",
        schoolId: `${TAG}-school`,
        region: "SOUTH_WEST",
        joinCode: `${TAG.slice(-6).toUpperCase()}${key === "home" ? "H" : "A"}`,
      },
    });
  }

  await prisma.clubMembership.createMany({
    data: [
      { clubId: `${TAG}-club-home`, userId: patron.id, role: "PATRON", status: "ACTIVE" },
      { clubId: `${TAG}-club-away`, userId: rival.id, role: "PATRON", status: "ACTIVE" },
      { clubId: `${TAG}-club-away`, userId: guest.id, role: "PLAYER", status: "ACTIVE" },
      // The join-code case: entered a code, waiting on a decision.
      { clubId: `${TAG}-club-home`, userId: player.id, role: "PLAYER", status: "PENDING" },
    ],
  });

  const fixture = await prisma.fixture.create({
    data: {
      seasonId: season.id,
      homeClubId: `${TAG}-club-home`,
      awayClubId: `${TAG}-club-away`,
      scheduledAt: new Date(),
      boardCount: 2,
      arbiterId: arbiter.id,
      venue: "Smoke Hall",
    },
  });

  // ── the console ─────────────────────────────────────────────────────────
  console.log("\nConsole");
  const mine = await gql<{ myManagedClubs: { id: string; myRole: string }[] }>(
    `{ myManagedClubs { id slug myRole } }`,
    {},
    patron.token
  );
  check(
    "a patron sees their own club",
    mine.data?.myManagedClubs.some((c) => c.id === `${TAG}-club-home`) === true,
    mine.error
  );

  const consoleView = await gql<{
    clubConsole: { pendingCount: number; club: { joinCode: string } };
  }>(
    `query ($clubId: ID!) { clubConsole(clubId: $clubId) { pendingCount club { joinCode } } }`,
    { clubId: `${TAG}-club-home` },
    patron.token
  );
  check("the console counts the pending request", consoleView.data?.clubConsole.pendingCount === 1);
  check("the join code is on the authenticated type", Boolean(consoleView.data?.clubConsole.club.joinCode));

  const trespass = await gql(
    `query ($clubId: ID!) { clubConsole(clubId: $clubId) { activeCount } }`,
    { clubId: `${TAG}-club-home` },
    rival.token
  );
  check("a rival patron cannot open this club's console", Boolean(trespass.error), trespass.error);

  const anonymous = await gql(
    `query ($clubId: ID!) { clubConsole(clubId: $clubId) { activeCount } }`,
    { clubId: `${TAG}-club-home` }
  );
  check("an anonymous caller cannot open a console", Boolean(anonymous.error));

  // ── members ─────────────────────────────────────────────────────────────
  console.log("\nMembers");
  const members = await gql<{ clubMembers: { id: string; userId: string; status: string }[] }>(
    `query ($clubId: ID!) { clubMembers(clubId: $clubId) { id userId status role fullName } }`,
    { clubId: `${TAG}-club-home` },
    patron.token
  );
  const pendingRow = members.data?.clubMembers.find((m) => m.userId === player.id);
  check("the pending member is listed", pendingRow?.status === "PENDING", members.error);

  const admitted = await gql<{ decideMembership: { status: string } }>(
    `mutation ($id: ID!) { decideMembership(membershipId: $id, admit: true) { status } }`,
    { id: pendingRow!.id },
    patron.token
  );
  check("admitting makes them active", admitted.data?.decideMembership.status === "ACTIVE", admitted.error);

  const promoted = await gql<{ setMembershipRole: { role: string } }>(
    `mutation ($id: ID!) { setMembershipRole(membershipId: $id, role: CAPTAIN) { role } }`,
    { id: pendingRow!.id },
    patron.token
  );
  check("a role can be set", promoted.data?.setMembershipRole.role === "CAPTAIN", promoted.error);

  const patronRow = members.data?.clubMembers.find((m) => m.userId === patron.id);
  const orphan = await gql(
    `mutation ($id: ID!) { setMembershipRole(membershipId: $id, role: PLAYER) { role } }`,
    { id: patronRow!.id },
    patron.token
  );
  check("the last patron cannot demote themselves", Boolean(orphan.error), orphan.error);

  // ── sessions ────────────────────────────────────────────────────────────
  console.log("\nTraining");
  const session = await gql<{ createClubSession: { id: string } }>(
    `mutation ($clubId: ID!, $input: ClubSessionInput!) {
       createClubSession(clubId: $clubId, input: $input) { id title }
     }`,
    {
      clubId: `${TAG}-club-home`,
      input: { title: "Smoke session", startsAt: new Date().toISOString(), location: "Hall" },
    },
    patron.token
  );
  check("a session can be scheduled", Boolean(session.data?.createClubSession.id), session.error);

  const register_ = await gql<{ sessionRegister: { rows: { member: { userId: string } }[] } }>(
    `query ($id: ID!) { sessionRegister(sessionId: $id) { rows { state member { userId } } } }`,
    { id: session.data!.createClubSession.id },
    patron.token
  );
  check(
    "every active member is on the register",
    register_.data?.sessionRegister.rows.length === 2,
    register_.data?.sessionRegister.rows.length
  );

  const marked = await gql<{ markAttendance: { presentCount: number; status: string } }>(
    `mutation ($id: ID!, $entries: [AttendanceInput!]!) {
       markAttendance(sessionId: $id, entries: $entries) { presentCount status }
     }`,
    {
      id: session.data!.createClubSession.id,
      entries: [
        { userId: patron.id, state: "PRESENT" },
        { userId: player.id, state: "ABSENT" },
      ],
    },
    patron.token
  );
  check("the register saves and holds the session", marked.data?.markAttendance.presentCount === 1, marked.error);
  check("marking attendance marks the session held", marked.data?.markAttendance.status === "HELD");

  // ── team sheets ─────────────────────────────────────────────────────────
  console.log("\nTeam sheet");
  const homeSheet = await gql<{ submitTeamSheet: { status: string } }>(
    `mutation ($id: ID!, $boards: [TeamSheetBoardInput!]!) {
       submitTeamSheet(fixtureId: $id, boards: $boards) { status }
     }`,
    {
      id: fixture.id,
      boards: [
        { boardNumber: 1, userId: patron.id },
        { boardNumber: 2, userId: player.id },
      ],
    },
    patron.token
  );
  check("a team sheet advances the fixture", homeSheet.data?.submitTeamSheet.status === "TEAM_SHEETS", homeSheet.error);

  const dupe = await gql(
    `mutation ($id: ID!, $boards: [TeamSheetBoardInput!]!) {
       submitTeamSheet(fixtureId: $id, boards: $boards) { status }
     }`,
    {
      id: fixture.id,
      boards: [
        { boardNumber: 1, userId: patron.id },
        { boardNumber: 2, userId: patron.id },
      ],
    },
    patron.token
  );
  check("one player cannot hold two boards", Boolean(dupe.error), dupe.error);

  const outsider = await gql(
    `mutation ($id: ID!, $boards: [TeamSheetBoardInput!]!) {
       submitTeamSheet(fixtureId: $id, boards: $boards) { status }
     }`,
    { id: fixture.id, boards: [{ boardNumber: 1, userId: rival.id }] },
    patron.token
  );
  check("a non-member cannot be named", Boolean(outsider.error), outsider.error);

  const awaySheet = await gql(
    `mutation ($id: ID!, $boards: [TeamSheetBoardInput!]!) {
       submitTeamSheet(fixtureId: $id, boards: $boards) { status }
     }`,
    {
      id: fixture.id,
      boards: [
        { boardNumber: 1, userId: rival.id },
        { boardNumber: 2, userId: guest.id },
      ],
    },
    rival.token
  );
  check("the away club files its own sheet", !awaySheet.error, awaySheet.error);

  // ── results ─────────────────────────────────────────────────────────────
  console.log("\nResults");
  const board1 = await gql<{ recordBoardResult: { status: string; homeScore: number; awayScore: number } }>(
    `mutation ($input: RecordBoardResultInput!) {
       recordBoardResult(input: $input) { status homeScore awayScore }
     }`,
    { input: { fixtureId: fixture.id, boardNumber: 1, result: "WHITE_WIN" } },
    patron.token
  );
  // Board 1: home is White, so a White win is a home point.
  check("the first result makes the fixture live", board1.data?.recordBoardResult.status === "LIVE", board1.error);
  check("the score is derived home-first", board1.data?.recordBoardResult.homeScore === 1, board1.data);

  const early = await gql(
    `mutation ($id: ID!) { validateFixture(fixtureId: $id) { status } }`,
    { id: fixture.id },
    arbiter.token
  );
  check("an incomplete fixture cannot be validated", Boolean(early.error), early.error);

  // Board 2: home is Black, so a White win is an AWAY point. This is the
  // notation rule the whole system turns on.
  const board2 = await gql<{ recordBoardResult: { status: string; homeScore: number; awayScore: number } }>(
    `mutation ($input: RecordBoardResultInput!) {
       recordBoardResult(input: $input) { status homeScore awayScore }
     }`,
    { input: { fixtureId: fixture.id, boardNumber: 2, result: "WHITE_WIN" } },
    rival.token
  );
  check("either club may record a board", !board2.error, board2.error);
  check(
    "White-first converts to home-first via homeColor",
    board2.data?.recordBoardResult.homeScore === 1 && board2.data?.recordBoardResult.awayScore === 1,
    board2.data
  );
  check(
    "the last result asks for an arbiter",
    board2.data?.recordBoardResult.status === "AWAITING_VALIDATION"
  );

  const lockedSheet = await gql(
    `mutation ($id: ID!, $boards: [TeamSheetBoardInput!]!) {
       submitTeamSheet(fixtureId: $id, boards: $boards) { status }
     }`,
    { id: fixture.id, boards: [{ boardNumber: 1, userId: player.id }] },
    patron.token
  );
  check("the board order locks once a result exists", Boolean(lockedSheet.error), lockedSheet.error);

  // ── validation ──────────────────────────────────────────────────────────
  console.log("\nValidation");
  const selfSign = await gql(
    `mutation ($id: ID!) { validateFixture(fixtureId: $id) { status } }`,
    { id: fixture.id },
    patron.token
  );
  check("a patron cannot validate their own fixture", Boolean(selfSign.error), selfSign.error);

  const validated = await gql<{ validateFixture: { status: string; boards: { ratedAt: string | null }[] } }>(
    `mutation ($id: ID!) { validateFixture(fixtureId: $id) { status boards { ratedAt } } }`,
    { id: fixture.id },
    arbiter.token
  );
  check("the appointed arbiter can validate", validated.data?.validateFixture.status === "VALIDATED", validated.error);
  check(
    "every board is stamped rated",
    validated.data?.validateFixture.boards.every((b) => b.ratedAt !== null) === true,
    validated.data?.validateFixture.boards
  );

  const ratings = await prisma.playerRating.findMany({
    where: { userId: { in: [patron.id, player.id, rival.id, guest.id] } },
  });
  check("both boards rated all four players", ratings.length === 4, ratings.length);

  const again = await gql(
    `mutation ($id: ID!) { validateFixture(fixtureId: $id) { status } }`,
    { id: fixture.id },
    arbiter.token
  );
  check("a validated fixture cannot be validated twice", Boolean(again.error), again.error);

  const afterFreeze = await gql(
    `mutation ($input: RecordBoardResultInput!) {
       recordBoardResult(input: $input) { status }
     }`,
    { input: { fixtureId: fixture.id, boardNumber: 1, result: "BLACK_WIN" } },
    patron.token
  );
  check("a validated fixture is closed to changes", Boolean(afterFreeze.error), afterFreeze.error);
}

async function cleanup() {
  console.log("\nCleaning up");
  await prisma.fixture.deleteMany({ where: { homeClubId: `${TAG}-club-home` } });
  await prisma.clubMembership.deleteMany({
    where: { clubId: { in: [`${TAG}-club-home`, `${TAG}-club-away`] } },
  });
  await prisma.clubSession.deleteMany({ where: { clubId: `${TAG}-club-home` } });
  await prisma.club.deleteMany({ where: { id: { in: [`${TAG}-club-home`, `${TAG}-club-away`] } } });
  await prisma.school.deleteMany({ where: { id: `${TAG}-school` } });
  // Ratings, profiles and games cascade from the user.
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
  console.log(`  removed everything tagged ${TAG}`);
}

main()
  .catch((error) => {
    failures.push(`crashed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e));
    await prisma.$disconnect();
    console.log(`\n${passed} passed, ${failures.length} failed`);
    if (failures.length) {
      for (const f of failures) console.log(`  · ${f}`);
      process.exit(1);
    }
  });
