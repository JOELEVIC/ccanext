import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { UserService } from "./user.service";
import { PUBLIC_USER_LIST_LIMIT } from "./user.repository";
import type { Viewer } from "./identityVisibility";

/**
 * THE SECOND PATH TO THE SAME EMAIL ADDRESS.
 *
 * `identityVisibility.ts` stops `User.email` being SELECTED by anyone but self
 * and staff. It does not stop `Query.users(filters: {search})` — which needs no
 * token — from MATCHING on the column. An OR arm over `email` turns the result
 * set into a one-bit oracle:
 *
 *     search "a"            -> does any address contain "a"?
 *     search "ab"           -> …"ab"?      and so on, character by character
 *
 * which reconstructs the addresses the field guard hides without ever naming the
 * field. These tests ask the service exactly as the resolver does — as nobody,
 * as an ordinary player, and as staff — and assert the oracle is gone.
 *
 * The prisma stand-in EVALUATES the `where` clause the repository builds rather
 * than inspecting its shape, so a test passing means the rows really do not come
 * back, not merely that the query looks different.
 */

// ── Fixtures ──────────────────────────────────────────────────────────────────

type Row = { id: string; username: string; email: string; rating: number; schoolId: string | null };

const BRENDA: Row = { id: "u1", username: "brenda", email: "brenda.ateba@example.cm", rating: 1500, schoolId: "s1" };
const ALAIN: Row = { id: "u2", username: "alain", email: "alain.mbeki@example.cm", rating: 1400, schoolId: "s1" };
const MALLORY: Row = { id: "u3", username: "mallory", email: "mallory@evil.example", rating: 900, schoolId: null };

const ROSTER = [BRENDA, ALAIN, MALLORY];

const ANON: Viewer = { userId: null, isStaff: false };
const MALLORY_VIEWER: Viewer = { userId: MALLORY.id, isStaff: false };
const STAFF: Viewer = { userId: null, isStaff: true };
/** A forged player token asserting an admin role. `isStaff` still comes from `admin`. */
const FORGED_ADMIN = { userId: MALLORY.id, isStaff: false, role: "NATIONAL_ADMIN" } as Viewer;

// ── A prisma stand-in that actually applies the where clause ──────────────────

function contains(haystack: string, cond: Record<string, unknown>): boolean {
  const needle = String(cond.contains ?? "");
  return cond.mode === "insensitive"
    ? haystack.toLowerCase().includes(needle.toLowerCase())
    : haystack.includes(needle);
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Record<string, unknown>[]).some((arm) => matches(row, arm));
    const value = (row as unknown as Record<string, unknown>)[key];
    if (cond && typeof cond === "object" && "contains" in (cond as object)) {
      return contains(String(value ?? ""), cond as Record<string, unknown>);
    }
    return value === cond;
  });
}

function harness(rows: Row[] = ROSTER) {
  const calls: Record<string, unknown>[] = [];
  const prisma = {
    user: {
      findMany: async (args: Record<string, unknown>) => {
        calls.push(args);
        const hits = rows
          .filter((r) => matches(r, (args.where as Record<string, unknown>) ?? {}))
          .sort((a, b) => b.rating - a.rating);
        const take = args.take as number | undefined;
        return typeof take === "number" ? hits.slice(0, take) : hits;
      },
    },
  } as unknown as PrismaClient;
  return { service: new UserService(prisma), calls };
}

async function search(term: string, viewer?: Viewer | null): Promise<string[]> {
  const { service } = harness();
  const rows = (await service.getUsers({ search: term }, viewer)) as unknown as Row[];
  return rows.map((r) => r.id);
}

// ── The probe, closed ─────────────────────────────────────────────────────────

describe("anonymous search cannot read User.email", () => {
  it("a full email address matches nobody", async () => {
    expect(await search(BRENDA.email, ANON)).toEqual([]);
  });

  it("the email local part and domain match nobody", async () => {
    expect(await search("brenda.ateba", ANON)).toEqual([]);
    expect(await search("@example.cm", ANON)).toEqual([]);
    expect(await search(".cm", ANON)).toEqual([]);
  });

  it("character-by-character probing yields no signal about the column", async () => {
    // The attack: grow a prefix and watch the result set. Every probe below is a
    // substring of Brenda's address and of NO username, so a single non-empty
    // answer would be the oracle. (`.ateba` etc. — "brenda" alone is her
    // username and is covered by the next test.)
    const probes = ["a.a", "a.at", "a.ate", "a.ateb", "a.ateba", "a.ateba@", "ateba@example"];
    for (const probe of probes) {
      expect(await search(probe, ANON), `"${probe}" leaked a row`).toEqual([]);
    }
  });

  it("a player token claiming an admin role gains nothing", async () => {
    expect(await search(BRENDA.email, MALLORY_VIEWER)).toEqual([]);
    expect(await search(BRENDA.email, FORGED_ADMIN)).toEqual([]);
  });
});

// ── What must keep working ────────────────────────────────────────────────────

describe("username search is untouched", () => {
  it("anonymous search by username still matches", async () => {
    expect(await search("brenda", ANON)).toEqual([BRENDA.id]);
    expect(await search("BREN", ANON)).toEqual([BRENDA.id]); // still case-insensitive
    expect(await search("a", ANON).then((ids) => ids.sort())).toEqual(["u1", "u2", "u3"]);
  });
});

describe("privileged search by email still works", () => {
  it("staff match on a full address", async () => {
    expect(await search(BRENDA.email, STAFF)).toEqual([BRENDA.id]);
    expect(await search("@example.cm", STAFF).then((ids) => ids.sort())).toEqual(["u1", "u2"]);
  });

  it("a player may still find themselves by their own address", async () => {
    expect(await search(MALLORY.email, MALLORY_VIEWER)).toEqual([MALLORY.id]);
  });
});

// ── The unbounded scrape, capped ──────────────────────────────────────────────

describe("Query.users is bounded for the public", () => {
  it("an unprivileged list is capped, and staff are not", async () => {
    const anon = harness();
    await anon.service.getUsers({}, ANON);
    expect(anon.calls[0].take).toBe(PUBLIC_USER_LIST_LIMIT);

    const player = harness();
    await player.service.getUsers({}, MALLORY_VIEWER);
    expect(player.calls[0].take).toBe(PUBLIC_USER_LIST_LIMIT);

    const staff = harness();
    await staff.service.getUsers({}, STAFF);
    expect(staff.calls[0].take).toBeUndefined();
  });

  it("the cap still returns a full leaderboard for the two ccaui pages", async () => {
    // `LandingRankingsPreview` asks `users(filters: {})` and slices 5;
    // `dashboard/rankings` renders every row it gets. Production holds 28.
    const roster: Row[] = Array.from({ length: 28 }, (_, i) => ({
      id: `p${i}`,
      username: `player${i}`,
      email: `player${i}@example.cm`,
      rating: 2000 - i,
      schoolId: "s1",
    }));
    const { service } = harness(roster);
    const rows = (await service.getUsers({}, ANON)) as unknown as Row[];
    expect(rows).toHaveLength(28);
    expect(rows.slice(0, 5).map((r) => r.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("the cap keeps the highest-rated rows when the roster exceeds it", async () => {
    const roster: Row[] = Array.from({ length: PUBLIC_USER_LIST_LIMIT + 50 }, (_, i) => ({
      id: `p${i}`,
      username: `player${i}`,
      email: `player${i}@example.cm`,
      rating: 3000 - i,
      schoolId: "s1",
    }));
    const { service } = harness(roster);
    const rows = (await service.getUsers({}, ANON)) as unknown as Row[];
    expect(rows).toHaveLength(PUBLIC_USER_LIST_LIMIT);
    expect(rows[0].id).toBe("p0");
  });
});

// ── Existing filters unchanged ────────────────────────────────────────────────

describe("the other filters are untouched", () => {
  it("schoolId still narrows, with and without a search term", async () => {
    const { service } = harness();
    const bySchool = (await service.getUsers({ schoolId: "s1" }, ANON)) as unknown as Row[];
    expect(bySchool.map((r) => r.id)).toEqual(["u1", "u2"]);

    const both = (await service.getUsers({ schoolId: "s1", search: "alain" }, ANON)) as unknown as Row[];
    expect(both.map((r) => r.id)).toEqual(["u2"]);
  });

  it("omitting the viewer entirely defaults to the anonymous treatment", async () => {
    const { service, calls } = harness();
    const rows = (await service.getUsers({ search: BRENDA.email })) as unknown as Row[];
    expect(rows).toEqual([]);
    expect(calls[0].take).toBe(PUBLIC_USER_LIST_LIMIT);
  });
});
