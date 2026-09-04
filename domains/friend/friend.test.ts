import { describe, expect, it, beforeEach } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { FriendService } from "./friend.service";

/**
 * The rules that decide whether one person may reach another.
 *
 * Worth testing away from the database because every one of them is a
 * statement about consent rather than about storage, and each fails in a way
 * nobody reports: a request that quietly does nothing, a block somebody can
 * walk around, a decline that silently bars two people from ever being
 * friends.
 *
 * The store is deliberately dumb — an array and filters — so a failure here
 * means the service is wrong rather than the harness.
 */

interface Row {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: "PENDING" | "ACCEPTED" | "BLOCKED";
  createdAt: Date;
  respondedAt: Date | null;
}

function store() {
  const rows: Row[] = [];
  const users = new Set(["a", "b", "c"]);
  let seq = 0;

  const matches = (row: Row, where: Record<string, unknown>): boolean => {
    if (where.OR) {
      return (where.OR as Record<string, unknown>[]).some((clause) =>
        matches(row, clause),
      );
    }
    return Object.entries(where).every(([key, value]) => {
      if (key === "status") return row.status === value;
      return (row as unknown as Record<string, unknown>)[key] === value;
    });
  };

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        users.has(where.id) ? { id: where.id } : null,
    },
    friendship: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows.find((r) => matches(r, where)) ?? null,
      findUnique: async ({ where }: { where: { id: string } }) =>
        rows.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) => matches(r, where)),
      create: async ({ data }: { data: Partial<Row> }) => {
        const row: Row = {
          id: `f${(seq += 1)}`,
          requesterId: data.requesterId!,
          addresseeId: data.addresseeId!,
          status: data.status ?? "PENDING",
          createdAt: new Date(),
          respondedAt: data.respondedAt ?? null,
        };
        rows.push(row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<Row>;
      }) => {
        const row = rows.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const at = rows.findIndex((r) => r.id === where.id);
        return rows.splice(at, 1)[0];
      },
    },
  } as unknown as PrismaClient;

  return { prisma, rows };
}

describe("asking", () => {
  let service: FriendService;
  let rows: Row[];

  beforeEach(() => {
    const s = store();
    service = new FriendService(s.prisma);
    rows = s.rows;
  });

  it("refuses to let somebody add themselves", async () => {
    await expect(service.request("a", "a")).rejects.toThrow(/yourself/i);
  });

  it("refuses somebody who does not exist", async () => {
    await expect(service.request("a", "nobody")).rejects.toThrow(/does not exist/i);
  });

  it("asking twice does not make two requests", async () => {
    // A person who taps a button they are not sure registered should not be
    // told off, and must not produce a second row the addressee has to answer
    // twice.
    await service.request("a", "b");
    await service.request("a", "b");
    expect(rows).toHaveLength(1);
  });

  it("asking somebody who already asked you accepts instead", async () => {
    // Two people reaching for each other at the same moment both wanted the
    // same outcome. A mirrored PENDING row would leave each waiting on the
    // other for ever.
    await service.request("b", "a");
    const answered = await service.request("a", "b");
    expect(answered.status).toBe("ACCEPTED");
    expect(rows).toHaveLength(1);
  });
});

describe("answering", () => {
  let service: FriendService;
  let rows: Row[];

  beforeEach(() => {
    const s = store();
    service = new FriendService(s.prisma);
    rows = s.rows;
  });

  it("only the addressee may answer", async () => {
    const req = await service.request("a", "b");
    await expect(service.respond("a", req.id, true)).rejects.toThrow(/not addressed/i);
    await expect(service.respond("c", req.id, true)).rejects.toThrow(/not addressed/i);
  });

  it("declining deletes the row rather than remembering the refusal", async () => {
    // Keeping it would tell the person who asked that they were refused, and
    // would bar the two from ever being friends after they met properly.
    // Blocking is the durable no, and it is a separate act.
    const req = await service.request("a", "b");
    await service.respond("b", req.id, false);
    expect(rows).toHaveLength(0);

    // …and asking again is allowed.
    await service.request("a", "b");
    expect(rows).toHaveLength(1);
  });

  it("accepting is what makes two people friends, in both directions",
    async () => {
      const req = await service.request("a", "b");
      await service.respond("b", req.id, true);
      expect(await service.areFriends("a", "b")).toBe(true);
      expect(await service.areFriends("b", "a")).toBe(true);
    });
});

describe("blocking", () => {
  let service: FriendService;

  beforeEach(() => {
    service = new FriendService(store().prisma);
  });

  it("a blocked person cannot ask again, and is not told why", async () => {
    await service.block("b", "a");
    // The same sentence somebody would get for a player who simply has not
    // answered. Telling A that B blocked them is telling A something B did not
    // choose to say.
    await expect(service.request("a", "b")).rejects.toThrow(/could not be sent/i);
  });

  it("a block survives a request that came first", async () => {
    await service.request("a", "b");
    await service.block("b", "a");
    await expect(service.request("a", "b")).rejects.toThrow(/could not be sent/i);
    expect(await service.areFriends("a", "b")).toBe(false);
  });

  it("the blocked party cannot lift the block against them", async () => {
    await service.block("b", "a");
    await expect(service.remove("a", "b")).rejects.toThrow(/could not be undone/i);
    // …and the person who set it can.
    expect(await service.remove("b", "a")).toBe(true);
  });
});

describe("the relation, from one side", () => {
  it("tells who is waiting on whom", async () => {
    const service = new FriendService(store().prisma);
    expect(await service.statusBetween("a", "b")).toBe("NONE");

    await service.request("a", "b");
    // A screen cannot draw a button for "waiting" without knowing which way.
    expect(await service.statusBetween("a", "b")).toBe("PENDING");
    expect(await service.statusBetween("b", "a")).toBe("PENDING_THEM");
  });
});
