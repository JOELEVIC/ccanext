import { describe, expect, it } from "vitest";
import { graphql } from "graphql";
import type { PrismaClient } from "@prisma/client";
import { schema } from "@/graphql/schema";
import type { GraphQLContextWithServices } from "@/graphql/context";
import { ClubService } from "@/domains/club/club.service";

/**
 * Spending a join code on an account that already exists — the real schema,
 * the real resolver and the real `ClubService`, over an in-memory Postgres.
 *
 * `domains/club/joinByCode.test.ts` proves the decision. This proves the parts
 * around it that a correct decision cannot save you from: the code lookup and
 * its refusal, the row actually being written, the legacy `schoolId` column
 * staying in sync, and — the one that matters most to a patron — a second tap
 * not becoming a second request.
 */

const NOW = new Date("2026-09-03T00:00:00Z");

interface ClubRow {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  region: string;
  level: string;
  status: string;
  joinCode: string;
  schoolId: string | null;
  crestJson: unknown;
  /** A club made from an enquiry: it exists, and nobody runs it yet. */
  patronless?: boolean;
}
interface MemberRow {
  id: string;
  clubId: string;
  userId: string;
  role: string;
  status: string;
  schoolYear: string | null;
  boardOrder: number | null;
  joinedAt: Date;
  leftAt: Date | null;
}

const club = (over: Partial<ClubRow> & { id: string; joinCode: string }): ClubRow => ({
  slug: over.id,
  name: over.id.toUpperCase(),
  shortName: over.id.slice(0, 3).toUpperCase(),
  region: "SOUTH_WEST",
  level: "SCHOOL",
  status: "ACTIVE",
  schoolId: null,
  crestJson: null,
  ...over,
});

/**
 * Every club here starts with a patron, because every club in production has
 * one: `installPatron` runs inside club creation. The exception is a club made
 * from the public enquiry form, which has nobody until its first code-holder
 * arrives — mark those `patronless` and the join becomes a claim.
 *
 * Patron rows belong to their own user, so `mine()` — the joiner's rows, which
 * is what every length assertion below is about — does not see them.
 */
function store(clubs: ClubRow[], members: MemberRow[] = []) {
  const users = [{ id: "u1", schoolId: null as string | null }];
  let seq = 0;

  for (const c of clubs) {
    if (c.patronless) continue;
    members.push({
      id: `patron-${c.id}`,
      clubId: c.id,
      userId: `patron-user-${c.id}`,
      role: "PATRON",
      status: "ACTIVE",
      schoolYear: null,
      boardOrder: null,
      joinedAt: NOW,
      leftAt: null,
    });
  }

  const prisma = {
    club: {
      findFirst: async ({ where }: any) =>
        clubs.find(
          (c) => c.joinCode === where.joinCode && c.status !== where.status.not,
        ) ?? null,
    },
    user: {
      updateMany: async ({ where, data }: any) => {
        const hit = users.filter(
          (u) => u.id === where.id && (where.schoolId !== null || u.schoolId === null),
        );
        hit.forEach((u) => Object.assign(u, data));
        return { count: hit.length };
      },
    },
    clubMembership: {
      findMany: async (args: any) => {
        const rows = members.filter(
          (m) =>
            m.userId === args.where.userId &&
            (!args.where.status?.in || args.where.status.in.includes(m.status)),
        );
        // Two callers, two shapes. `myMemberships` asks for the nested club;
        // the join decision asks only for its name.
        return rows.map((m) => {
          const c = clubs.find((x) => x.id === m.clubId)!;
          if (args.select?.club?.select?.slug) {
            return {
              ...m,
              club: {
                ...c,
                school: c.schoolId ? { name: "Sacred Heart College" } : null,
                _count: { memberships: 4 },
              },
            };
          }
          return { id: m.id, clubId: m.clubId, status: m.status, club: { name: c.name } };
        });
      },
      create: async ({ data }: any) => {
        const row: MemberRow = {
          id: `m${++seq}`,
          schoolYear: null,
          boardOrder: null,
          joinedAt: NOW,
          leftAt: null,
          ...data,
        };
        members.push(row);
        return row;
      },
      count: async ({ where }: any) =>
        members.filter(
          (m) =>
            m.clubId === where.clubId &&
            m.role === where.role &&
            m.status === where.status,
        ).length,
      update: async ({ where, data }: any) => {
        const row = members.find(
          (m) =>
            m.clubId === where.clubId_userId.clubId &&
            m.userId === where.clubId_userId.userId,
        )!;
        Object.assign(row, data);
        return row;
      },
    },
  } as unknown as PrismaClient;

  const mine = () => members.filter((m) => m.userId === "u1");
  return { prisma, members, mine, users, clubs };
}

const JOIN = /* GraphQL */ `
  mutation ($joinCode: String!) {
    joinClubByCode(joinCode: $joinCode) {
      status
      role
      club { id name }
    }
  }
`;

async function join(
  prisma: PrismaClient,
  joinCode: string,
  as: { userId?: string } = { userId: "u1" },
) {
  return graphql({
    schema,
    source: JOIN,
    variableValues: { joinCode },
    contextValue: {
      user: as.userId ? { userId: as.userId, role: "STUDENT" } : undefined,
      prisma,
      services: { clubService: new ClubService(prisma) },
    } as unknown as GraphQLContextWithServices,
  });
}

const LIMBE = club({ id: "limbe", joinCode: "LIMBE-A7K2", name: "GBHS Limbe" });
const BUEA = club({ id: "buea", joinCode: "BUEA-3XQ9", name: "GBHS Buea" });

const member = (over: Partial<MemberRow> & { clubId: string; status: string }): MemberRow => ({
  id: `held-${over.clubId}`,
  userId: "u1",
  role: "PLAYER",
  schoolYear: null,
  boardOrder: null,
  joinedAt: NOW,
  leftAt: null,
  ...over,
});

describe("spending a code", () => {
  it("creates a PENDING request and hands back the club", async () => {
    const { prisma, mine } = store([LIMBE, BUEA]);
    const result = await join(prisma, "LIMBE-A7K2");
    expect(result.errors).toBeUndefined();
    expect((result.data as any).joinClubByCode).toMatchObject({
      status: "PENDING",
      role: "PLAYER",
      club: { id: "limbe", name: "GBHS Limbe" },
    });
    expect(mine()).toHaveLength(1);
  });

  it("accepts a code typed in lower case with spaces around it", async () => {
    // It is read off a whiteboard and typed with one thumb.
    const { prisma, mine } = store([LIMBE]);
    const result = await join(prisma, "  limbe-a7k2 ");
    expect(result.errors).toBeUndefined();
    expect(mine()).toHaveLength(1);
  });

  it("refuses a code that resolves to nothing, and writes no row", async () => {
    const { prisma, mine } = store([LIMBE]);
    const result = await join(prisma, "LIMBE-A7KZ");
    expect(result.errors?.[0]?.message).toMatch(/not recognised/i);
    expect(mine()).toEqual([]);
  });

  it("refuses an archived club's code", async () => {
    const { prisma } = store([club({ id: "old", joinCode: "OLD-1111", status: "ARCHIVED" })]);
    const result = await join(prisma, "OLD-1111");
    expect(result.errors?.[0]?.message).toMatch(/not recognised/i);
  });

  it("refuses a reader with no token", async () => {
    const { prisma, mine } = store([LIMBE]);
    const result = await join(prisma, "LIMBE-A7K2", {});
    // Not the console's "Sign in to manage a club": a student spending the
    // code their teacher gave them is not managing anything.
    expect(result.errors?.[0]?.message).toBe("Sign in to join a club");
    expect(mine()).toEqual([]);
  });
});

describe("the second tap", () => {
  it("does not become a second request", async () => {
    // The whole reason this is an update on one row. A patron seeing the same
    // student ask twice is how they decide they are being pestered.
    const { prisma, mine } = store([LIMBE]);
    await join(prisma, "LIMBE-A7K2");
    const again = await join(prisma, "LIMBE-A7K2");
    expect(again.errors).toBeUndefined();
    expect((again.data as any).joinClubByCode.status).toBe("PENDING");
    expect(mine()).toHaveLength(1);
  });

  it("is harmless once they are already in", async () => {
    const { prisma, mine } = store([LIMBE], [member({ clubId: "limbe", status: "ACTIVE" })]);
    const result = await join(prisma, "LIMBE-A7K2");
    expect((result.data as any).joinClubByCode.status).toBe("ACTIVE");
    expect(mine()).toHaveLength(1);
  });

  it("puts a declined student back in the queue rather than adding a row", async () => {
    const { prisma, mine } = store(
      [LIMBE],
      [member({ clubId: "limbe", status: "REMOVED", leftAt: NOW })],
    );
    const result = await join(prisma, "LIMBE-A7K2");
    expect(result.errors).toBeUndefined();
    expect(mine()).toHaveLength(1);
    expect(mine()[0].status).toBe("PENDING");
    // It dates a departure, and this person has not departed anything.
    expect(mine()[0].leftAt).toBeNull();
  });
});

describe("a club nobody runs yet", () => {
  const ORPHAN = club({ id: "kumba", joinCode: "KUMBA-9X4B", patronless: true });

  it("admits its first code-holder as patron, active immediately", async () => {
    // The enquiry form makes clubs anonymously, so this one has no patron and
    // nobody to approve a PENDING request. The code went to the person who
    // asked for the club; entering it is what makes them its patron.
    const { prisma, mine } = store([ORPHAN]);
    const result = await join(prisma, "KUMBA-9X4B");
    expect(result.errors).toBeUndefined();
    expect((result.data as any).joinClubByCode).toMatchObject({
      status: "ACTIVE",
      role: "PATRON",
    });
    expect(mine()).toHaveLength(1);
  });

  it("fires once — the second person through is an ordinary player", async () => {
    const { prisma, members, mine } = store([ORPHAN]);
    await join(prisma, "KUMBA-9X4B");
    // Somebody else now holds the club; our joiner starts over as themselves.
    members.forEach((m) => {
      if (m.userId === "u1") m.userId = "u2";
    });
    const second = await join(prisma, "KUMBA-9X4B");
    expect(second.errors).toBeUndefined();
    expect((second.data as any).joinClubByCode).toMatchObject({
      status: "PENDING",
      role: "PLAYER",
    });
    expect(mine()).toHaveLength(1);
  });

  it("does not let somebody active elsewhere claim it", async () => {
    // Claiming replaces `create`, never a refusal: one active membership is
    // still one active membership.
    const { prisma } = store([ORPHAN, BUEA], [member({ clubId: "buea", status: "ACTIVE" })]);
    const result = await join(prisma, "KUMBA-9X4B");
    expect(result.errors?.[0]?.message).toMatch(/already a member of GBHS Buea/);
  });
});

describe("what another club blocks", () => {
  it("names the club they are already in", async () => {
    const { prisma, mine } = store([LIMBE, BUEA], [member({ clubId: "buea", status: "ACTIVE" })]);
    const result = await join(prisma, "LIMBE-A7K2");
    expect(result.errors?.[0]?.message).toMatch(/already a member of GBHS Buea/);
    expect(mine()).toHaveLength(1);
  });

  it("names the club they are waiting on", async () => {
    const { prisma } = store([LIMBE, BUEA], [member({ clubId: "buea", status: "PENDING" })]);
    const result = await join(prisma, "LIMBE-A7K2");
    expect(result.errors?.[0]?.message).toMatch(/already asked to join GBHS Buea/);
  });
});

describe("the legacy school column", () => {
  it("is filled from the club when the account carries none", async () => {
    const { prisma, users } = store([club({ id: "limbe", joinCode: "LIMBE-A7K2", schoolId: "s1" })]);
    await join(prisma, "LIMBE-A7K2");
    expect(users[0].schoolId).toBe("s1");
  });

  it("is left alone for an independent club, which has no school to copy", async () => {
    const { prisma, users } = store([LIMBE]);
    await join(prisma, "LIMBE-A7K2");
    expect(users[0].schoolId).toBeNull();
  });
});
