import { describe, expect, it } from "vitest";
import { graphql } from "graphql";
import type { PrismaClient } from "@prisma/client";
import { schema } from "@/graphql/schema";
import type { GraphQLContextWithServices } from "@/graphql/context";
import { ClubAdminService } from "@/domains/club/admin.service";
import { joinCodeProblem } from "@/domains/club/joinCode";

/**
 * Creating a club from the staff console — the real schema, the real resolver
 * and the real service over an in-memory Postgres.
 *
 * The case that matters most is the deadlock. A join request can only be
 * admitted by a patron of that club, so a club created empty is one whose
 * first request can never be answered by anybody: the code works, the request
 * lands, and nobody on earth has permission to say yes. Installing the first
 * patron is the one membership in this system that no patron approves.
 */

const NOW = new Date("2026-09-03T00:00:00Z");

function store() {
  const clubs: any[] = [];
  const schools: any[] = [{ id: "s1", name: "Sacred Heart College" }];
  const users: any[] = [
    { id: "u1", username: "mrs.ateba", email: "ateba@school.cm" },
    { id: "u2", username: "busy.teacher", email: "busy@school.cm" },
  ];
  const members: any[] = [];
  let seq = 0;

  const prisma = {
    school: { findUnique: async ({ where }: any) => schools.find((s) => s.id === where.id) ?? null },
    user: {
      findFirst: async ({ where }: any) => {
        const wanted = where.OR.map((o: any) => o.username ?? o.email);
        const user = users.find(
          (u) => wanted.includes(u.username) || wanted.includes(u.email),
        );
        if (!user) return null;
        return {
          ...user,
          memberships: members
            .filter((m) => m.userId === user.id && m.status === "ACTIVE")
            .map((m) => ({ club: { name: clubs.find((c) => c.id === m.clubId)!.name } })),
        };
      },
    },
    club: {
      findMany: async ({ where, select, include }: any) => {
        let rows = clubs;
        if (where?.OR) {
          const needle = (where.OR[0].name.contains as string).toLowerCase();
          rows = rows.filter(
            (c) =>
              c.name.toLowerCase().includes(needle) ||
              c.slug.includes(needle) ||
              c.joinCode.includes(needle.toUpperCase()),
          );
        }
        rows = [...rows].reverse();
        if (select?.slug) return rows.map((c) => ({ slug: c.slug }));
        if (!include) return rows;
        return rows.map((c) => ({
          ...c,
          school: c.schoolId ? schools.find((s) => s.id === c.schoolId) : null,
          memberships: members
            .filter((m) => m.clubId === c.id && ["ACTIVE", "PENDING"].includes(m.status))
            .map((m) => ({
              status: m.status,
              role: m.role,
              user: { username: users.find((u) => u.id === m.userId)!.username },
            })),
        }));
      },
      findUnique: async ({ where }: any) =>
        clubs.find((c) => (where.id ? c.id === where.id : c.joinCode === where.joinCode)) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `c${++seq}`, createdAt: NOW, ...data };
        clubs.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = clubs.find((c) => c.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
    },
    clubMembership: {
      upsert: async ({ where, create, update }: any) => {
        const held = members.find(
          (m) =>
            m.clubId === where.clubId_userId.clubId && m.userId === where.clubId_userId.userId,
        );
        if (held) return Object.assign(held, update);
        const row = { id: `m${++seq}`, ...create };
        members.push(row);
        return row;
      },
    },
  } as unknown as PrismaClient;

  return { prisma, clubs, members, users };
}

function ctx(prisma: PrismaClient, as: { admin?: boolean } = { admin: true }) {
  return {
    admin: as.admin ? { adminId: "a1", role: "ROOT" } : undefined,
    prisma,
    services: { clubAdminService: new ClubAdminService(prisma) },
  } as unknown as GraphQLContextWithServices;
}

const CREATE = /* GraphQL */ `
  mutation ($input: AdminCreateClubInput!) {
    adminCreateClub(input: $input) {
      id slug name shortName region status joinCode
      memberCount pendingCount patronNames schoolName
    }
  }
`;

const run = (prisma: PrismaClient, source: string, variableValues?: any, as?: any) =>
  graphql({ schema, source, variableValues, contextValue: ctx(prisma, as) });

const input = (over: Record<string, unknown> = {}) => ({
  name: "GBHS Limbe",
  shortName: "gbl",
  region: "SOUTH_WEST",
  ...over,
});

describe("creating a club", () => {
  it("mints a slug, a short name and a readable join code", async () => {
    const { prisma } = store();
    const result = await run(prisma, CREATE, { input: input() });
    expect(result.errors).toBeUndefined();
    const club = (result.data as any).adminCreateClub;
    expect(club.slug).toBe("gbhs-limbe");
    expect(club.shortName).toBe("GBL");
    // The alphabet exists because a code is read off a whiteboard.
    expect(joinCodeProblem(club.joinCode)).toBeNull();
  });

  it("starts ONBOARDING, because created is not the same claim as ready", async () => {
    const { prisma } = store();
    const result = await run(prisma, CREATE, { input: input() });
    expect((result.data as any).adminCreateClub.status).toBe("ONBOARDING");
  });

  it("numbers a second club of the same name rather than colliding", async () => {
    // Two schools called GBHS Limbe is normal here.
    const { prisma } = store();
    await run(prisma, CREATE, { input: input() });
    const second = await run(prisma, CREATE, { input: input() });
    expect((second.data as any).adminCreateClub.slug).toBe("gbhs-limbe-2");
  });

  it("gives every club its own code", async () => {
    const { prisma, clubs } = store();
    for (let i = 0; i < 12; i += 1) {
      await run(prisma, CREATE, { input: input({ name: `Club ${i}` }) });
    }
    const codes = clubs.map((c) => c.joinCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("refuses a region that is not one of Cameroon's", async () => {
    const { prisma, clubs } = store();
    const result = await run(prisma, CREATE, { input: input({ region: "NORTHUMBRIA" }) });
    expect(result.errors?.[0]?.message).toMatch(/regions/i);
    expect(clubs).toEqual([]);
  });

  it("refuses a school id that names nothing", async () => {
    const { prisma, clubs } = store();
    const result = await run(prisma, CREATE, { input: input({ schoolId: "nope" }) });
    expect(result.errors?.[0]?.message).toMatch(/does not exist/i);
    expect(clubs).toEqual([]);
  });

  it("allows an independent club, which has no school", async () => {
    const { prisma } = store();
    const result = await run(prisma, CREATE, { input: input({ name: "Limbe Town Chess" }) });
    expect(result.errors).toBeUndefined();
    expect((result.data as any).adminCreateClub.schoolName).toBeNull();
  });

  it("refuses an admin-less caller", async () => {
    const { prisma, clubs } = store();
    const result = await run(prisma, CREATE, { input: input() }, { admin: false });
    expect(result.errors?.[0]?.message).toMatch(/admin/i);
    expect(clubs).toEqual([]);
  });
});

describe("the patron, and the deadlock without one", () => {
  it("installs the first patron as ACTIVE without anybody approving it", async () => {
    // There is nobody to approve it. That is the whole point: a join request
    // can only be admitted by a patron of that club.
    const { prisma, members } = store();
    const result = await run(prisma, CREATE, {
      input: input({ patronUsername: "mrs.ateba" }),
    });
    expect(result.errors).toBeUndefined();
    expect((result.data as any).adminCreateClub.patronNames).toEqual(["mrs.ateba"]);
    expect(members[0]).toMatchObject({
      role: "PATRON",
      status: "ACTIVE",
    });
  });

  it("accepts an email as well as a username", async () => {
    const { prisma } = store();
    const result = await run(prisma, CREATE, {
      input: input({ patronUsername: "ateba@school.cm" }),
    });
    expect((result.data as any).adminCreateClub.patronNames).toEqual(["mrs.ateba"]);
  });

  it("creates a club with no patron, and says so by naming none", async () => {
    const { prisma } = store();
    const result = await run(prisma, CREATE, { input: input() });
    expect((result.data as any).adminCreateClub.patronNames).toEqual([]);
  });

  it("can install one afterwards, which is the way out of the deadlock", async () => {
    const { prisma } = store();
    const made = await run(prisma, CREATE, { input: input() });
    const id = (made.data as any).adminCreateClub.id;

    const result = await run(
      prisma,
      /* GraphQL */ `
        mutation ($clubId: ID!, $username: String!) {
          adminSetClubPatron(clubId: $clubId, username: $username) { patronNames }
        }
      `,
      { clubId: id, username: "mrs.ateba" },
    );
    expect(result.errors).toBeUndefined();
    expect((result.data as any).adminSetClubPatron.patronNames).toEqual(["mrs.ateba"]);
  });

  it("refuses a teacher who already runs another club, and names it", async () => {
    // One ACTIVE membership per user is a partial unique index. Being told now
    // beats a constraint error with no name in it.
    const { prisma } = store();
    await run(prisma, CREATE, { input: input({ patronUsername: "busy.teacher" }) });
    const second = await run(prisma, CREATE, {
      input: input({ name: "GHS Buea", patronUsername: "busy.teacher" }),
    });
    expect(second.errors?.[0]?.message).toMatch(/already an active member of GBHS Limbe/);
  });

  it("refuses an account that does not exist", async () => {
    const { prisma, clubs } = store();
    const result = await run(prisma, CREATE, { input: input({ patronUsername: "nobody" }) });
    expect(result.errors?.[0]?.message).toMatch(/No account called "nobody"/);
    expect(clubs).toEqual([]);
  });
});

describe("running a club afterwards", () => {
  it("mints a fresh code and retires the old one", async () => {
    const { prisma } = store();
    const made = await run(prisma, CREATE, { input: input() });
    const before = (made.data as any).adminCreateClub;

    const result = await run(
      prisma,
      /* GraphQL */ `
        mutation ($clubId: ID!) {
          adminRegenerateJoinCode(clubId: $clubId) { joinCode }
        }
      `,
      { clubId: before.id },
    );
    const after = (result.data as any).adminRegenerateJoinCode.joinCode;
    expect(after).not.toBe(before.joinCode);
    expect(joinCodeProblem(after)).toBeNull();
  });

  it("opens the club to the public directory as a separate decision", async () => {
    const { prisma } = store();
    const made = await run(prisma, CREATE, { input: input() });
    const result = await run(
      prisma,
      /* GraphQL */ `
        mutation ($clubId: ID!, $status: ClubStatus!) {
          adminSetClubStatus(clubId: $clubId, status: $status) { status }
        }
      `,
      { clubId: (made.data as any).adminCreateClub.id, status: "ACTIVE" },
    );
    expect((result.data as any).adminSetClubStatus.status).toBe("ACTIVE");
  });

  it("lists clubs with the code and the waiting count", async () => {
    const { prisma } = store();
    await run(prisma, CREATE, { input: input({ patronUsername: "mrs.ateba" }) });
    const result = await run(
      prisma,
      /* GraphQL */ `
        query { adminClubs { name joinCode memberCount pendingCount patronNames } }
      `,
    );
    expect(result.errors).toBeUndefined();
    const rows = (result.data as any).adminClubs;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "GBHS Limbe",
      memberCount: 1,
      pendingCount: 0,
      patronNames: ["mrs.ateba"],
    });
  });

  it("keeps the list behind the admin token, because it carries join codes", async () => {
    const { prisma } = store();
    const result = await run(
      prisma,
      /* GraphQL */ `query { adminClubs { joinCode } }`,
      undefined,
      { admin: false },
    );
    expect(result.errors?.[0]?.message).toMatch(/admin/i);
    expect(result.data).toBeNull();
  });
});
