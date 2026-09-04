import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ClubService } from "./club.service";

/**
 * A private club keeps its list of children to itself.
 *
 * The gate is one `if` and it is the kind that gets refactored away by
 * somebody who does not know why it is there, so it is pinned here.
 *
 * What is NOT being tested: consent reduction. That is §4.3, it happens in
 * `toPublicPlayer` regardless of this flag, and the two answer different
 * questions — this one is "may you see the list at all", that one is "whose
 * name may be on it". A club that is not private still returns "Brenda A."
 * for a non-consented minor.
 */

function store(opts: { isPrivate: boolean; membership?: { status: string } | null }) {
  const prisma = {
    club: {
      findFirst: async () => ({ id: "club-1", isPrivate: opts.isPrivate }),
    },
    clubMembership: {
      findUnique: async () => opts.membership ?? null,
      findMany: async () => [
        {
          schoolYear: "Form 4",
          boardOrder: 1,
          club: { slug: "bota", name: "Bota", shortName: "BC", crestJson: null },
          user: {
            id: "u1",
            username: "ateba",
            rating: 1200,
            publicNameMode: "INITIAL",
            profile: { firstName: "Brenda", lastName: "Ateba", dateOfBirth: null },
          },
        },
      ],
    },
  } as unknown as PrismaClient;
  return new ClubService(prisma);
}

describe("a club that is not private", () => {
  it("shows its roster to a stranger", async () => {
    const service = store({ isPrivate: false });
    const roster = await service.getRoster("bota", false, null);
    expect(roster).toHaveLength(1);
  });
});

describe("a private club", () => {
  it("shows nothing to somebody signed out", async () => {
    const service = store({ isPrivate: true });
    expect(await service.getRoster("bota", false, null)).toEqual([]);
  });

  it("shows nothing to a signed-in stranger", async () => {
    const service = store({ isPrivate: true, membership: null });
    expect(await service.getRoster("bota", false, "outsider")).toEqual([]);
  });

  it("shows its roster to its own members", async () => {
    const service = store({ isPrivate: true, membership: { status: "ACTIVE" } });
    expect(await service.getRoster("bota", false, "u1")).toHaveLength(1);
  });

  it("shows its roster to somebody still waiting to be admitted", async () => {
    // PENDING counts on purpose. Somebody who has spent the join code was
    // told by a human which club to join; making them wait for admission
    // before they may see who is in it leaves them looking at an empty club
    // with no way to tell it from a broken one.
    const service = store({ isPrivate: true, membership: { status: "PENDING" } });
    expect(await service.getRoster("bota", false, "u2")).toHaveLength(1);
  });
});

describe("an unknown club", () => {
  it("is an empty roster rather than an error", async () => {
    // A club page issues club / clubRoster / clubStanding together; throwing
    // here would turn a 404 into a 500.
    const prisma = {
      club: { findFirst: async () => null },
    } as unknown as PrismaClient;
    expect(await new ClubService(prisma).getRoster("nope", false, "u1")).toEqual([]);
  });
});
