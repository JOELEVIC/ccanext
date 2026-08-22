import type { PrismaClient, User, Profile, UserRole } from "@prisma/client";
import type { UserFilters } from "./user.types";
import { isPrivilegedViewer, type Viewer } from "./identityVisibility";

/**
 * How many accounts one UNPRIVILEGED `Query.users` call may pull.
 *
 * `Query.users` takes no pagination arguments in the SDL and is reachable with
 * no token, so without a cap it is a one-request dump of the whole users table.
 * 200 is chosen to be invisible to the two real consumers and useless as a
 * scrape:
 *
 *   • `LandingRankingsPreview` asks `users(filters: {})` and renders
 *     `.slice(0, 5)`;
 *   • `dashboard/rankings` renders the rows as a single unpaginated table of a
 *     national ranking that today holds 28 accounts.
 *
 * Both read the list `orderBy: { rating: "desc" }`, so the cap keeps the HIGHEST
 * rated players — precisely the rows a leaderboard wants — and 200 leaves ~7x
 * headroom over the current roster. It is also deliberately in the same band as
 * the hard `Math.min(…, 100)` `playersLeaderboard` already applies to the same
 * table.
 *
 * Staff are not capped: the admin console legitimately lists everyone.
 */
export const PUBLIC_USER_LIST_LIMIT = 200;

export class UserRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(
    id: string
  ): Promise<(User & { profile: Profile | null }) | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: { profile: true, school: true },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { username } });
  }

  /**
   * `Query.users` — unauthenticated, so `viewer` decides two things.
   *
   * 1. WHICH COLUMNS `search` MATCHES. Matching `email` for an anonymous caller
   *    is a read of `User.email` by another name: the field guard in
   *    `identityVisibility.ts` stops the address being SELECTED, but an OR arm
   *    over `email` still answers "does an account whose address contains this
   *    exist?" for any probe string. Character by character that reconstructs
   *    the very addresses the guard hides, without ever asking for the field.
   *    So the `email` arm is applied only to a viewer who is already allowed to
   *    read the column, and to the rows they may read it on.
   *
   * 2. HOW MANY ROWS COME BACK. See `PUBLIC_USER_LIST_LIMIT`.
   *
   * Privilege is decided by `isPrivilegedViewer()` — the same helper the field
   * guards use, so there is exactly one definition of "staff or self" in the
   * codebase. `isPrivilegedViewer(viewer, null)` is true for a staff token and
   * false for every player token: with no subject id the "self" arm cannot be
   * reached, and `isStaff` comes from the separate admin token, never from a
   * (forgeable) player token's `role`.
   */
  async findMany(filters?: UserFilters, viewer?: Viewer | null) {
    // Staff-only. A signed-in player is NOT privileged over the table at large.
    const isStaff = isPrivilegedViewer(viewer, null);

    const where: Record<string, unknown> = {};
    if (filters?.role) where.role = filters.role;
    if (filters?.schoolId) where.schoolId = filters.schoolId;
    if (filters?.search) {
      const contains = { contains: filters.search, mode: "insensitive" as const };
      // Public arm: usernames are a display handle, shown on every leaderboard.
      const or: unknown[] = [{ username: contains }];
      if (isStaff) {
        or.push({ email: contains });
      } else if (viewer?.userId) {
        // A player is privileged over exactly ONE row — their own — so they
        // keep "find me by my email" and gain nothing about anybody else.
        // (`isPrivilegedViewer(viewer, viewer.userId)` is true by definition;
        // the `id` equality is that same restriction expressed to Prisma.)
        or.push({ id: viewer.userId, email: contains });
      }
      (where as { OR?: unknown[] }).OR = or;
    }

    return this.prisma.user.findMany({
      where,
      include: { profile: true, school: true },
      orderBy: { rating: "desc" },
      ...(isStaff ? {} : { take: PUBLIC_USER_LIST_LIMIT }),
    });
  }

  async create(data: {
    email: string;
    username: string;
    passwordHash: string;
    role: UserRole;
    schoolId?: string;
    rating?: number;
    placementRequired?: boolean;
    profile?: {
      firstName: string;
      lastName: string;
      dateOfBirth?: Date;
      country?: string;
    };
  }) {
    return this.prisma.user.create({
      data: {
        email: data.email,
        username: data.username,
        passwordHash: data.passwordHash,
        role: data.role,
        schoolId: data.schoolId,
        // Only override the schema defaults when explicitly provided (signup passes
        // rating: 100 + placementRequired: true; other callers keep the defaults).
        ...(data.rating !== undefined ? { rating: data.rating } : {}),
        ...(data.placementRequired !== undefined
          ? { placementRequired: data.placementRequired }
          : {}),
        profile: data.profile
          ? { create: data.profile }
          : undefined,
      },
      include: { profile: true },
    });
  }

  async update(
    id: string,
    data: {
      email?: string;
      username?: string;
      schoolId?: string;
      rating?: number;
    }
  ) {
    return this.prisma.user.update({
      where: { id },
      data,
      include: { profile: true },
    });
  }

  async updateProfile(
    userId: string,
    data: {
      firstName?: string;
      lastName?: string;
      dateOfBirth?: Date;
      country?: string;
    }
  ) {
    return this.prisma.profile.update({
      where: { userId },
      data,
    });
  }

  async updateRating(id: string, rating: number) {
    return this.prisma.user.update({
      where: { id },
      data: { rating },
    });
  }

  async delete(id: string) {
    return this.prisma.user.delete({ where: { id } });
  }
}
