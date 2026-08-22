import { describe, it, expect } from "vitest";
import { graphql } from "graphql";
import type { PrismaClient } from "@prisma/client";
import { schema } from "@/graphql/schema";
import type { GraphQLContextWithServices } from "@/graphql/context";
import { IdentityGate, prismaConsentReader } from "@/domains/user/identityGate";

/**
 * The leak, reproduced and then closed — against the REAL schema and the REAL
 * resolvers, not a model of them.
 *
 * Production returned, to a request carrying no token at all:
 *   { users { id } }                     -> all 28 accounts
 *   { playersLeaderboard { user { email profile { firstName lastName } } } }
 *                                        -> 10 full names and 10 email addresses
 * and 0 of those accounts have a `dateOfBirth`, so under §4.3 every one of them
 * is a minor by the protective default.
 *
 * These tests ask the five reachable queries — `user`, `users`,
 * `school { students }`, `schoolLeaderboard`, `playersLeaderboard` — as nobody,
 * as the person themselves, and as staff.
 */

const NOW = new Date("2026-08-22T00:00:00Z");

// ── Fixtures ──────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  email: string;
  username: string;
  role: string;
  rating: number;
  publicNameMode: string;
  guardianConsent: { status: string } | null;
  profile: {
    id: string;
    userId: string;
    firstName: string;
    lastName: string;
    dateOfBirth: Date | null;
    country: string;
    avatarUrl: string | null;
    xp: number;
    ratingTrendJson: unknown;
  } | null;
  school: { id: string; name: string; region: string } | null;
  createdAt: Date;
  updatedAt: Date;
};

function row(over: Partial<Row> & { id: string }): Row {
  const base = {
    email: `${over.id}@example.cm`,
    username: over.id,
    role: "STUDENT",
    rating: 1400,
    publicNameMode: "INITIAL",
    guardianConsent: null,
    school: { id: "s1", name: "Sacred Heart College", region: "SOUTH_WEST" },
    createdAt: NOW,
    updatedAt: NOW,
  };
  const profile = {
    id: `p_${over.id}`,
    userId: over.id,
    firstName: "Brenda",
    lastName: "Ateba",
    dateOfBirth: null as Date | null,
    country: "CM",
    avatarUrl: `https://cdn.example/${over.id}.jpg`,
    xp: 0,
    ratingTrendJson: null,
    ...(over.profile ?? {}),
  };
  return { ...base, ...over, profile: over.profile === null ? null : profile };
}

/** The production case: a real name, no date of birth, no consent row. */
const NO_DOB = row({ id: "nodob" });

/** A minor whose guardian has granted consent and chosen FULL display. */
const GRANTED = row({
  id: "granted",
  publicNameMode: "FULL",
  guardianConsent: { status: "GRANTED" },
  profile: { dateOfBirth: new Date("2014-01-01T00:00:00Z") } as Row["profile"],
});

/** An adult. §4.3 row 1: full name and avatar, whatever the mode says. */
const ADULT = row({
  id: "adult",
  profile: { firstName: "Alain", dateOfBirth: new Date("1990-01-01T00:00:00Z") } as Row["profile"],
});

const ALL = [NO_DOB, GRANTED, ADULT];
const byId = (id: string) => ALL.find((u) => u.id === id) ?? null;

// ── A prisma stand-in ─────────────────────────────────────────────────────────

const fakePrisma = {
  user: {
    findMany: async (args: Record<string, any>) => {
      // The consent reader asks with a `select` and an explicit id list.
      if (args?.select) {
        const ids: string[] = args.where.id.in;
        return ALL.filter((u) => ids.includes(u.id)).map((u) => ({
          id: u.id,
          publicNameMode: u.publicNameMode,
          profile: u.profile ? { dateOfBirth: u.profile.dateOfBirth } : null,
          guardianConsent: u.guardianConsent,
        }));
      }
      // `playersLeaderboard` asks with an `include`.
      return ALL.slice(0, args?.take ?? ALL.length);
    },
  },
  game: { count: async () => 3 },
} as unknown as PrismaClient;

// ── Context ───────────────────────────────────────────────────────────────────

function context(as: { selfId?: string; staff?: boolean } = {}): GraphQLContextWithServices {
  return {
    user: as.selfId ? { userId: as.selfId, role: "STUDENT" } : undefined,
    admin: as.staff ? { adminId: "a1", role: "ROOT" } : undefined,
    identity: new IdentityGate(
      { userId: as.selfId ?? null, isStaff: Boolean(as.staff) },
      prismaConsentReader(fakePrisma),
      { now: NOW },
    ),
    prisma: fakePrisma,
    services: {
      userService: {
        getUsers: async () => ALL,
        getUserById: async (id: string) => byId(id),
      },
      institutionService: {
        getSchoolById: async () => ({
          id: "s1",
          name: "Sacred Heart College",
          region: "SOUTH_WEST",
          kind: "SECONDARY",
          students: ALL,
          tournaments: [],
          createdAt: NOW,
          updatedAt: NOW,
        }),
        getSchoolLeaderboard: async () => ALL.map((u) => ({ user: u, gamesPlayed: 3 })),
      },
    },
  } as unknown as GraphQLContextWithServices;
}

async function run(source: string, as: { selfId?: string; staff?: boolean } = {}) {
  const result = await graphql({ schema, source, contextValue: context(as) });
  expect(result.errors, JSON.stringify(result.errors)).toBeUndefined();
  return result.data as Record<string, any>;
}

const PERSON = "id email profile { firstName lastName dateOfBirth avatarUrl }";

// ── The SDL still validates every existing client query ───────────────────────

describe("the SDL shape is unchanged", () => {
  it("still accepts a query that selects email, names and dateOfBirth", async () => {
    // The whole point of guarding at the FIELD level: `ccaui` keeps validating.
    const data = await run(`{ users { ${PERSON} } }`);
    expect(data.users).toHaveLength(3);
  });

  it("still accepts the two ccaui pages' selection sets verbatim", async () => {
    const data = await run(`{
      users(filters: {}) { id username rating profile { firstName lastName } school { name region } }
    }`);
    expect(data.users[0].username).toBe("nodob");
  });
});

// ── The five leaky queries, asked by nobody ───────────────────────────────────

describe("unauthenticated caller", () => {
  const cases: Array<[string, string, (d: Record<string, any>) => any[]]> = [
    ["users", `{ users { ${PERSON} } }`, (d) => d.users],
    ["user", `{ user(id: "nodob") { ${PERSON} } }`, (d) => [d.user]],
    ["school.students", `{ school(id: "s1") { students { ${PERSON} } } }`, (d) => d.school.students],
    ["schoolLeaderboard", `{ schoolLeaderboard(schoolId: "s1") { user { ${PERSON} } } }`, (d) => d.schoolLeaderboard.map((r: any) => r.user)],
    ["playersLeaderboard", `{ playersLeaderboard(limit: 10) { user { ${PERSON} } } }`, (d) => d.playersLeaderboard.map((r: any) => r.user)],
  ];

  for (const [name, source, pick] of cases) {
    it(`${name}: no email, no dateOfBirth`, async () => {
      const people = pick(await run(source));
      expect(people.length).toBeGreaterThan(0);
      for (const p of people) {
        expect(p.email, `${name} leaked an email for ${p.id}`).toBeNull();
        expect(p.profile.dateOfBirth, `${name} leaked a DOB for ${p.id}`).toBeNull();
      }
    });

    it(`${name}: no full surname for a non-consented minor`, async () => {
      const people = pick(await run(source));
      const reduced = people.filter((p) => p.id === "nodob");
      expect(reduced.length).toBeGreaterThan(0);
      for (const p of reduced) {
        expect(p.profile.lastName).toBe("A.");
        expect(p.profile.firstName).toBe("Brenda");
        expect(`${p.profile.firstName} ${p.profile.lastName}`).toBe("Brenda A.");
        expect(p.profile.avatarUrl).toBeNull();
      }
    });
  }

  it("still shows an adult in full — consent gates minors, not everyone", async () => {
    const people = (await run(`{ users { ${PERSON} } }`)) as Record<string, any>;
    const adult = people.users.find((u: any) => u.id === "adult");
    expect(adult.profile.firstName).toBe("Alain");
    expect(adult.profile.lastName).toBe("Ateba");
    expect(adult.profile.avatarUrl).toBe("https://cdn.example/adult.jpg");
    expect(adult.email).toBeNull(); // …but never the email.
  });

  it("shows a GRANTED + FULL minor in full, and still hides the email", async () => {
    const data = await run(`{ user(id: "granted") { ${PERSON} } }`);
    expect(data.user.profile.lastName).toBe("Ateba");
    expect(data.user.profile.avatarUrl).toBe("https://cdn.example/granted.jpg");
    expect(data.user.email).toBeNull();
    expect(data.user.profile.dateOfBirth).toBeNull();
  });

  it("does not let a DIFFERENT logged-in player read anyone else's PII", async () => {
    const data = await run(`{ user(id: "nodob") { ${PERSON} } }`, { selfId: "adult" });
    expect(data.user.email).toBeNull();
    expect(data.user.profile.lastName).toBe("A.");
    expect(data.user.profile.dateOfBirth).toBeNull();
  });
});

// ── Self and staff are untouched ──────────────────────────────────────────────

describe("self", () => {
  it("me returns the caller's own email, surname, DOB and avatar", async () => {
    const data = await run(`{ me { ${PERSON} } }`, { selfId: "nodob" });
    expect(data.me.email).toBe("nodob@example.cm");
    expect(data.me.profile.firstName).toBe("Brenda");
    expect(data.me.profile.lastName).toBe("Ateba");
    expect(data.me.profile.dateOfBirth).toBeNull(); // this fixture genuinely has none
    expect(data.me.profile.avatarUrl).toBe("https://cdn.example/nodob.jpg");
  });

  it("me returns a real DOB when the account has one", async () => {
    const data = await run(`{ me { ${PERSON} } }`, { selfId: "granted" });
    expect(data.me.email).toBe("granted@example.cm");
    expect(data.me.profile.dateOfBirth).toBe("2014-01-01T00:00:00.000Z");
  });

  it("user(id: me) is the same as me — self is self by whatever route", async () => {
    const data = await run(`{ user(id: "nodob") { ${PERSON} } }`, { selfId: "nodob" });
    expect(data.user.email).toBe("nodob@example.cm");
    expect(data.user.profile.lastName).toBe("Ateba");
  });
});

describe("staff (context.admin)", () => {
  it("sees every email, surname, DOB and avatar on every one of the five queries", async () => {
    const sources = [
      `{ users { ${PERSON} } }`,
      `{ user(id: "nodob") { ${PERSON} } }`,
      `{ school(id: "s1") { students { ${PERSON} } } }`,
      `{ schoolLeaderboard(schoolId: "s1") { user { ${PERSON} } } }`,
      `{ playersLeaderboard(limit: 10) { user { ${PERSON} } } }`,
    ];
    for (const source of sources) {
      const data = await run(source, { staff: true });
      const people = JSON.stringify(data);
      expect(people).toContain("nodob@example.cm");
      expect(people).toContain('"lastName":"Ateba"');
      expect(people).not.toContain('"lastName":"A."');
    }
  });

  it("sees a minor's date of birth and photograph", async () => {
    const data = await run(`{ user(id: "granted") { ${PERSON} } }`, { staff: true });
    expect(data.user.profile.dateOfBirth).toBe("2014-01-01T00:00:00.000Z");
    expect(data.user.profile.avatarUrl).toBe("https://cdn.example/granted.jpg");
  });
});
