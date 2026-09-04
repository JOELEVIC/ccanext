import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ClubSelfServeService } from "./selfServe.service";
import { PlatformSettingService } from "@/domains/platform/platformSetting.service";

/**
 * A club made by the person who will run it.
 *
 * The three things that decide whether this is safe, and each fails silently:
 *
 *   · **The approval switch is honoured.** A club that lands ACTIVE while
 *     staff believe they are reviewing every one is the whole risk of opening
 *     the door, and nothing in the UI would show it.
 *   · **The creator becomes the patron.** A club without one is inert — a
 *     join request lands and no human being has permission to answer it.
 *   · **Somebody already in a club is refused with a sentence.** The database
 *     refuses them anyway, via a partial unique index Prisma cannot express,
 *     and its error has no club name in it.
 */

function store(opts: { requiresApproval?: boolean; activeClubName?: string } = {}) {
  const clubs: Record<string, unknown>[] = [];
  const memberships: Record<string, unknown>[] = [];
  let seq = 0;

  const prisma = {
    platformSetting: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        opts.requiresApproval === undefined
          ? null
          : { key: where.key, value: opts.requiresApproval },
    },
    clubMembership: {
      findFirst: async () =>
        opts.activeClubName ? { club: { name: opts.activeClubName } } : null,
      upsert: async ({ create }: { create: Record<string, unknown> }) => {
        memberships.push(create);
        return create;
      },
    },
    club: {
      findMany: async () => clubs.map((c) => ({ slug: c.slug })),
      findFirst: async () => null,
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `c${(seq += 1)}`, ...data };
        clubs.push(row);
        return row;
      },
    },
  } as unknown as PrismaClient;

  return { prisma, clubs, memberships };
}

const INPUT = {
  name: "Bota Community Chess Club",
  shortName: "BC",
  region: "SOUTH_WEST",
};

describe("the approval switch", () => {
  it("lands ONBOARDING when nobody has configured anything", async () => {
    // The DEFAULT is the assertion. An unwritten key must read as "create it",
    // because a review queue nobody is reading is not moderation — it is a
    // teacher waiting on a person who is not coming.
    const s = store();
    const service = new ClubSelfServeService(
      s.prisma,
      new PlatformSettingService(s.prisma),
    );
    const { requiresApproval } = await service.create("u1", INPUT);

    expect(requiresApproval).toBe(false);
    // ONBOARDING is in PUBLIC_CLUB_STATUSES, so the club is in the directory,
    // reachable by slug and its join code works — which is what makes "here is
    // your club" a link the creator can actually follow.
    expect(s.clubs[0].status).toBe("ONBOARDING");
  });

  it("lands PENDING_REVIEW once staff turn approval back on", async () => {
    const s = store({ requiresApproval: true });
    const service = new ClubSelfServeService(
      s.prisma,
      new PlatformSettingService(s.prisma),
    );
    const { requiresApproval } = await service.create("u1", INPUT);

    expect(requiresApproval).toBe(true);
    // Absent from PUBLIC_CLUB_STATUSES: not in the directory, not reachable by
    // slug, join code finds nothing. A proposal, not a club.
    expect(s.clubs[0].status).toBe("PENDING_REVIEW");
  });
});

describe("what a self-serve club is", () => {
  it("makes its creator the patron, ACTIVE, at once", async () => {
    // Otherwise the club is inert: a join request can only be admitted by a
    // patron of that club, and a club with none has nobody who may answer.
    const s = store({ requiresApproval: false });
    const service = new ClubSelfServeService(
      s.prisma,
      new PlatformSettingService(s.prisma),
    );
    await service.create("u1", INPUT);

    expect(s.memberships[0]).toMatchObject({
      userId: "u1",
      role: "PATRON",
      status: "ACTIVE",
    });
  });

  it("is independent, never attached to a school", async () => {
    // Attaching one is a claim to be a named institution's chess club, which
    // is the claim the enquiry funnel exists to verify.
    const s = store({ requiresApproval: false });
    const service = new ClubSelfServeService(
      s.prisma,
      new PlatformSettingService(s.prisma),
    );
    await service.create("u1", INPUT);
    expect(s.clubs[0].schoolId).toBeNull();
  });
});

describe("what it refuses", () => {
  const service = (s: ReturnType<typeof store>) =>
    new ClubSelfServeService(s.prisma, new PlatformSettingService(s.prisma));

  it("somebody who is already active in a club, by name", async () => {
    // The partial unique index refuses them anyway; its error has no club
    // name in it, and a person cannot act on that.
    const s = store({ activeClubName: "GBHS Limbe Chess Club" });
    await expect(service(s).create("u1", INPUT)).rejects.toThrow(
      /GBHS Limbe Chess Club/,
    );
  });

  it("a name too short to be a name", async () => {
    const s = store();
    await expect(service(s).create("u1", { ...INPUT, name: "GB" })).rejects.toThrow(
      /needs a name/i,
    );
  });

  it("a short name outside 2-4 characters", async () => {
    const s = store();
    await expect(
      service(s).create("u1", { ...INPUT, shortName: "B" }),
    ).rejects.toThrow(/2 to 4/);
    await expect(
      service(s).create("u1", { ...INPUT, shortName: "BOTAX" }),
    ).rejects.toThrow(/2 to 4/);
  });

  it("a region that is not one of Cameroon's", async () => {
    const s = store();
    await expect(
      service(s).create("u1", { ...INPUT, region: "ATLANTIS" }),
    ).rejects.toThrow(/regions/i);
  });
});

describe("the platform setting itself", () => {
  it("refuses a key nothing reads", async () => {
    const s = store();
    const settings = new PlatformSettingService(s.prisma);
    await expect(settings.set("club.creation.pineapple", true)).rejects.toThrow(
      /Unknown platform setting/,
    );
  });

  it("refuses a value of the wrong type", async () => {
    const s = store();
    const settings = new PlatformSettingService(s.prisma);
    await expect(
      settings.set("club.creation.requiresApproval", "yes"),
    ).rejects.toThrow(/takes a boolean/);
  });

  it("treats a stored value of the wrong shape as absent", async () => {
    // Somebody hand-editing this table in the Supabase console must not be
    // able to make club creation crash by typing a string where a boolean
    // belongs.
    const prisma = {
      platformSetting: {
        findUnique: async () => ({ key: "x", value: "nonsense" }),
      },
    } as unknown as PrismaClient;
    const settings = new PlatformSettingService(prisma);
    expect(await settings.get("club.creation.requiresApproval")).toBe(false);
  });
});
