import { afterEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import type { PrismaClient } from "@prisma/client";
import { UserRole } from "@prisma/client";
import { UserService, normaliseEmail } from "./user.service";
import { GOOGLE_AUDIENCE_ALLOW_LIST } from "@/domains/auth/googleVerify";

/**
 * Who an account belongs to, and what it is called — the three rules the
 * two-field signup depends on, none of which had a test.
 *
 *   · **A username is derived, not demanded.** Signup asks for an email and a
 *     password. If the server still required a handle, the app would have to
 *     invent one client-side and could be told "username taken" about a field
 *     the person never saw.
 *   · **One mailbox is one account.** `users.email` is @unique and Postgres
 *     compares case-sensitively, while the Google path has always lowercased.
 *     So `Brenda@x.cm` registered with a password, then "Continue with Google",
 *     silently produced a SECOND account — its own rating, its own membership,
 *     and on a shared school handset its own Drift wipe of the first one.
 *   · **A name can be added later.** `updateProfile` threw NotFoundError
 *     forever for an account with no Profile row, which is every account the
 *     new signup creates. The app is about to ask for a name on the club-join
 *     screen; without the upsert that request could never succeed.
 */

type Row = {
  id: string;
  email: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  schoolId: string | null;
  rating: number;
  placementRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type ProfileRow = {
  userId: string;
  firstName: string;
  lastName: string;
  country: string;
  dateOfBirth?: Date | null;
};

const CHEAP = 4; // bcrypt cost for FIXTURES only; the service still hashes at 12.

function user(over: Partial<Row> & { id: string; email: string; username: string }): Row {
  return {
    passwordHash: bcrypt.hashSync("correct horse", CHEAP),
    role: UserRole.STUDENT,
    schoolId: null,
    rating: 100,
    placementRequired: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

/**
 * A Prisma stand-in with one deliberately nasty detail.
 *
 * `findMany` models Postgres `ILIKE` rather than a tidy case-fold, because
 * that is what Prisma's `mode: "insensitive"` compiles to and `ILIKE` reads an
 * underscore IN THE VALUE as "any single character". Underscores are ordinary
 * in an email address, so a naive insensitive lookup for `john_doe@x.cm` also
 * matches `johnXdoe@x.cm` — a different person's account. Modelling the hazard
 * here is the only way the JavaScript re-check in `findUserByEmail` is actually
 * being tested rather than merely present.
 */
function store(seed: Row[] = [], profiles: ProfileRow[] = []) {
  const users = [...seed];
  const profileRows = [...profiles];
  const calls = { byUsername: 0, byEmailExact: 0, insensitiveScan: 0 };
  let seq = users.length;

  const withProfile = (row: Row) => ({
    ...row,
    profile: profileRows.find((p) => p.userId === row.id) ?? null,
    school: null,
  });

  const prisma = {
    user: {
      findUnique: async ({ where }: { where: Record<string, string> }) => {
        if (where.id !== undefined) {
          const hit = users.find((u) => u.id === where.id);
          return hit ? withProfile(hit) : null;
        }
        if (where.email !== undefined) {
          calls.byEmailExact += 1;
          return users.find((u) => u.email === where.email) ?? null;
        }
        if (where.username !== undefined) {
          calls.byUsername += 1;
          return users.find((u) => u.username === where.username) ?? null;
        }
        return null;
      },
      findMany: async ({ where }: { where?: Record<string, any> } = {}) => {
        const clause = where?.email;
        if (!clause || typeof clause !== "object") return [];
        calls.insensitiveScan += 1;
        const target = String(clause.equals ?? "");
        const pattern = new RegExp(
          `^${target
            .split("")
            .map((c) => (c === "_" ? "." : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
            .join("")}$`,
          clause.mode === "insensitive" ? "i" : "",
        );
        return users
          .filter((u) => pattern.test(u.email))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      },
      create: async ({ data }: { data: Record<string, any> }) => {
        const row = user({
          id: `u${(seq += 1)}`,
          email: data.email,
          username: data.username,
          passwordHash: data.passwordHash,
          role: data.role,
          schoolId: data.schoolId ?? null,
          ...(data.rating !== undefined ? { rating: data.rating } : {}),
        });
        users.push(row);
        if (data.profile?.create) {
          profileRows.push({ country: "CM", ...data.profile.create, userId: row.id });
        }
        return withProfile(row);
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const row = users.find((u) => u.id === where.id)!;
        Object.assign(row, data);
        return withProfile(row);
      },
    },
    profile: {
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { userId: string };
        update: Record<string, any>;
        create: Record<string, any>;
      }) => {
        const existing = profileRows.find((p) => p.userId === where.userId);
        if (existing) {
          for (const [k, v] of Object.entries(update)) {
            if (v !== undefined) (existing as Record<string, any>)[k] = v;
          }
          return existing;
        }
        const row = { country: "CM", ...create } as ProfileRow;
        profileRows.push(row);
        return row;
      },
    },
    club: { findFirst: async () => null },
    clubMembership: { create: async ({ data }: { data: unknown }) => data },
  } as unknown as PrismaClient;

  return { prisma, users, profiles: profileRows, calls };
}

const SIGNUP = {
  email: "brenda.ateba@school.cm",
  password: "a good long password",
  role: UserRole.STUDENT,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── M1 · the username the person never types ────────────────────────────────

describe("a signup with no username", () => {
  it("derives a free handle from the email address", async () => {
    const s = store();
    const result = await new UserService(s.prisma).createUser(SIGNUP);

    // The same derivation `loginWithGoogle` has always used, so a password
    // signup and a Google signup now produce handles of the same shape.
    expect(result.user.username).toBe("brenda_ateba");
    expect(result.token).toBeTruthy();
  });

  it("walks past a taken handle instead of refusing the signup", async () => {
    // The whole point. There is no username field on the screen, so "that name
    // is taken" is not a sentence this flow is allowed to produce — there is
    // nothing the person could do about it.
    const s = store([user({ id: "u1", email: "someone@else.cm", username: "brenda_ateba" })]);
    const result = await new UserService(s.prisma).createUser(SIGNUP);

    expect(result.user.username).toBe("brenda_ateba2");
  });

  it("does not go looking for a free handle when the email is already taken", async () => {
    // Registering an address you already hold is the commonest failure on this
    // endpoint, and each collision inside `uniqueUsername` costs a SELECT.
    // Deriving before the email check would burn those probes on an account
    // that is about to be refused.
    const s = store([user({ id: "u1", email: "brenda.ateba@school.cm", username: "brenda_ateba" })]);
    await expect(new UserService(s.prisma).createUser(SIGNUP)).rejects.toThrow(
      "Email already in use",
    );
    expect(s.calls.byUsername).toBe(0);
  });
});

describe("a signup that still sends a username", () => {
  // ccaweb, ccaui and every APK already installed send one. Relaxing the field
  // to nullable must not relax the rule for the clients that still fill it.
  it("keeps the 3-20 [A-Za-z0-9_] rule", async () => {
    const s = store();
    const service = new UserService(s.prisma);
    for (const username of ["ab", "has space", "hyphen-ated", "a".repeat(21), "acc€nt"]) {
      await expect(service.createUser({ ...SIGNUP, username })).rejects.toThrow(
        /Username must be 3–20 characters/,
      );
    }
    expect(s.users).toHaveLength(0);
  });

  it("still says so when the handle is taken", async () => {
    // A person who CHOSE a name gets told; a person who never saw the field
    // never can be. That asymmetry is the whole design of this change.
    const s = store([user({ id: "u1", email: "someone@else.cm", username: "brenda" })]);
    await expect(
      new UserService(s.prisma).createUser({ ...SIGNUP, username: "brenda" }),
    ).rejects.toThrow("Username already in use");
  });

  it("uses it verbatim rather than deriving over it", async () => {
    const s = store();
    const result = await new UserService(s.prisma).createUser({ ...SIGNUP, username: "Brenda_A" });
    expect(result.user.username).toBe("Brenda_A");
  });
});

// ── M2 · one mailbox, one account ───────────────────────────────────────────

describe("email is matched and stored case-insensitively", () => {
  it("normalises what it writes", async () => {
    const s = store();
    const result = await new UserService(s.prisma).createUser({
      ...SIGNUP,
      email: "  Brenda.Ateba@School.CM  ",
    });

    // Trim as well as lowercase: a trailing space survives a paste out of a
    // teacher's spreadsheet and is invisible in every UI that would show it.
    expect(result.user.email).toBe("brenda.ateba@school.cm");
    expect(s.users[0].email).toBe("brenda.ateba@school.cm");
  });

  it("refuses a second registration of the same address in different capitals", async () => {
    // This is the production bug, stated as a test: before the fix this call
    // succeeded and produced a second account on one mailbox.
    const s = store([user({ id: "u1", email: "brenda@school.cm", username: "brenda" })]);
    await expect(
      new UserService(s.prisma).createUser({ ...SIGNUP, email: "BRENDA@School.cm" }),
    ).rejects.toThrow("Email already in use");
  });

  it("signs in a legacy mixed-case row, which no migration has touched yet", async () => {
    // The rows already in production still carry whatever was typed. They must
    // keep working without a data change — nobody may be locked out by a fix.
    const s = store([
      user({
        id: "u1",
        email: "Brenda@School.CM",
        username: "brenda",
        passwordHash: bcrypt.hashSync("correct horse", CHEAP),
      }),
    ]);
    const result = await new UserService(s.prisma).authenticateUser({
      email: "brenda@school.cm",
      password: "correct horse",
    });

    expect(result.user.id).toBe("u1");
    expect(s.calls.insensitiveScan).toBe(1); // the exact index missed; the fallback answered
  });

  it("costs no scan at all for an account written after normalisation", async () => {
    // The fallback is for legacy rows only. Every account created from here on
    // is answered by the unique index, exactly, on the first query.
    const s = store([user({ id: "u1", email: "brenda@school.cm", username: "brenda" })]);
    await new UserService(s.prisma).authenticateUser({
      email: "Brenda@School.cm",
      password: "correct horse",
    });
    expect(s.calls.insensitiveScan).toBe(0);
  });

  it("does not hand back the wrong account when an address contains an underscore", async () => {
    // Prisma compiles `mode: "insensitive"` to ILIKE, and ILIKE reads `_` in
    // the value as a single-character wildcard — so the scan for
    // `john_doe@x.cm` also returns `johnXdoe@x.cm`. Signing the first person
    // into the second person's account would be a far worse bug than the one
    // being fixed, which is why the scan is treated as a superset and filtered.
    const s = store([
      user({
        id: "wrong",
        email: "johnXdoe@x.cm",
        username: "johnx",
        createdAt: new Date("2025-01-01T00:00:00Z"),
      }),
    ]);
    await expect(
      new UserService(s.prisma).authenticateUser({
        email: "john_doe@x.cm",
        password: "correct horse",
      }),
    ).rejects.toThrow("Invalid email or password");
  });

  it("signs Google into the account the password path created", async () => {
    // The trace this whole change exists for: register with a capital letter,
    // then tap Continue with Google. It used to create a second, empty account
    // on the same mailbox. It must now resolve to the first one.
    const s = store([
      user({ id: "u1", email: "Brenda@School.CM", username: "brenda" }),
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          iss: "https://accounts.google.com",
          aud: [...GOOGLE_AUDIENCE_ALLOW_LIST][0],
          email: "brenda@school.cm",
          email_verified: true,
          name: "Brenda Ateba",
        }),
      })),
    );

    const result = await new UserService(s.prisma).loginWithGoogle("an-id-token");

    expect(result.user.id).toBe("u1");
    expect(s.users).toHaveLength(1); // no second account was created
  });
});

describe("normaliseEmail", () => {
  it("is total, so a missing address never becomes a lookup for everything", () => {
    expect(normaliseEmail("  Brenda@School.CM ")).toBe("brenda@school.cm");
    expect(normaliseEmail("")).toBe("");
    expect(normaliseEmail("   ")).toBe("");
    expect(normaliseEmail(null)).toBe("");
    expect(normaliseEmail(undefined)).toBe("");
  });
});

// ── M3 · a name can arrive later ────────────────────────────────────────────

describe("updateProfile on an account that has no profile row", () => {
  it("creates the row instead of throwing forever", async () => {
    // Every account the two-field signup makes is in this state, as is every
    // Google account whose Google name is one word. Before the upsert, being
    // asked for a name on the club-join screen was a request that could never
    // be satisfied.
    const s = store([user({ id: "u1", email: "brenda@school.cm", username: "brenda" })]);
    const saved = await new UserService(s.prisma).updateProfile("u1", {
      firstName: "Brenda",
      lastName: "Ateba",
    });

    expect(saved).toMatchObject({ userId: "u1", firstName: "Brenda", lastName: "Ateba" });
    expect(s.profiles).toHaveLength(1);
  });

  it("stores an empty string for the half that was not sent", async () => {
    // `profiles.firstName` and `.lastName` are NOT NULL with no default, so the
    // create branch has to supply something. "" is the honest value — it says
    // "not known yet" — and it is what the roster/team-sheet fallbacks read.
    const s = store([user({ id: "u1", email: "brenda@school.cm", username: "brenda" })]);
    const saved = await new UserService(s.prisma).updateProfile("u1", { firstName: "Brenda" });

    expect(saved).toMatchObject({ firstName: "Brenda", lastName: "" });
    // Not overwritten with undefined — the column default has to apply.
    expect((saved as { country: string }).country).toBe("CM");
  });

  it("still updates an existing profile without disturbing what it did not mention", async () => {
    const s = store(
      [user({ id: "u1", email: "brenda@school.cm", username: "brenda" })],
      [{ userId: "u1", firstName: "B", lastName: "A", country: "FR" }],
    );
    const saved = await new UserService(s.prisma).updateProfile("u1", { lastName: "Ateba" });

    expect(saved).toMatchObject({ firstName: "B", lastName: "Ateba", country: "FR" });
    expect(s.profiles).toHaveLength(1);
  });

  it("still refuses an account that does not exist", async () => {
    // The upsert removes one NotFoundError and must not remove the other: a
    // profile for a userId with no user is a dangling row the FK would reject
    // anyway, and the sentence is more useful than a constraint violation.
    const s = store();
    await expect(
      new UserService(s.prisma).updateProfile("nobody", { firstName: "Brenda" }),
    ).rejects.toThrow("User not found");
  });
});
