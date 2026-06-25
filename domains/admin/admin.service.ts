import bcrypt from "bcryptjs";
import type { PrismaClient, AdminUser } from "@prisma/client";
import { AdminRole, GameStatus } from "@prisma/client";
import { AdminRepository } from "./admin.repository";
import { PlacementService } from "../placement/placement.service";
import { generateAdminToken } from "@/utils/jwt";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  NotFoundError,
} from "@/utils/types";

const SALT_ROUNDS = 12;

/** The seed root admin. Un-removable and un-demotable by anyone (including itself). */
export const ROOT_ADMIN_EMAIL = "mrsinsj48@gmail.com";

export interface SafeAdmin {
  id: string;
  email: string;
  role: AdminRole;
  addedById: string | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  /** True until the admin has set a password (invite pending). */
  pending: boolean;
}

function sanitize(a: AdminUser): SafeAdmin {
  return {
    id: a.id,
    email: a.email,
    role: a.role,
    addedById: a.addedById,
    lastLoginAt: a.lastLoginAt,
    createdAt: a.createdAt,
    pending: a.passwordHash === "",
  };
}

const isRootEmail = (email: string) => email.toLowerCase() === ROOT_ADMIN_EMAIL;

export class AdminService {
  private repo: AdminRepository;
  private placement: PlacementService;

  constructor(private prisma: PrismaClient) {
    this.repo = new AdminRepository(prisma);
    this.placement = new PlacementService(prisma);
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  /**
   * Login. A row with an empty passwordHash is "pending bootstrap": the first
   * successful login SETS the password (this is both the ROOT bootstrap and the
   * invite flow for admins ROOT adds). Returns a separate admin JWT.
   */
  async login(email: string, password: string) {
    if (!email || !password) throw new ValidationError("Email and password are required");
    // Self-heal: make sure the un-removable ROOT row always exists.
    await this.repo.ensureRoot(ROOT_ADMIN_EMAIL);

    const admin = await this.repo.findByEmail(email);
    if (!admin) throw new AuthenticationError("Invalid credentials");

    let current = admin;
    if (admin.passwordHash === "") {
      if (password.length < 8) {
        throw new ValidationError("Choose a password of at least 8 characters");
      }
      const hash = bcrypt.hashSync(password, SALT_ROUNDS);
      current = await this.repo.setPassword(admin.id, hash);
    } else {
      if (!bcrypt.compareSync(password, admin.passwordHash)) {
        throw new AuthenticationError("Invalid credentials");
      }
      current = await this.repo.touchLogin(admin.id);
    }

    const token = generateAdminToken(current.id, current.role);
    return { token, admin: sanitize(current) };
  }

  /**
   * Step 1 of the two-step login: given an email, tell the UI whether to show a
   * "set your password" first-time screen or a normal password prompt.
   *
   * To avoid leaking which emails are admins, we ONLY return SET_PASSWORD for a
   * provisioned admin whose password isn't set yet. An existing admin WITH a
   * password and an unknown email both return PASSWORD (so unknown emails just
   * fail at the password step like a wrong password would). The SET_PASSWORD
   * signal is no weaker than the existing first-login-sets-password behaviour.
   */
  async authStage(email: string): Promise<{ email: string; mode: "SET_PASSWORD" | "PASSWORD" }> {
    const normalized = (email ?? "").trim().toLowerCase();
    await this.repo.ensureRoot(ROOT_ADMIN_EMAIL);
    const admin = normalized ? await this.repo.findByEmail(normalized) : null;
    const mode = admin && admin.passwordHash === "" ? "SET_PASSWORD" : "PASSWORD";
    return { email: normalized, mode };
  }

  /** Resolve + assert the acting admin still exists (token role may be stale). */
  async requireAdmin(adminId: string): Promise<AdminUser> {
    const admin = await this.repo.findById(adminId);
    if (!admin) throw new AuthenticationError("Admin account not found");
    return admin;
  }

  private async requireRoot(adminId: string): Promise<AdminUser> {
    const admin = await this.requireAdmin(adminId);
    if (admin.role !== AdminRole.ROOT) {
      throw new AuthorizationError("Only the root admin can manage admins");
    }
    return admin;
  }

  async me(adminId: string): Promise<SafeAdmin> {
    return sanitize(await this.requireAdmin(adminId));
  }

  // ── Admin management ────────────────────────────────────────────────────────

  async listAdmins(adminId: string): Promise<SafeAdmin[]> {
    await this.requireAdmin(adminId);
    const all = await this.repo.listAll();
    return all.map(sanitize);
  }

  async addAdmin(adminId: string, email: string): Promise<SafeAdmin> {
    await this.requireRoot(adminId);
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new ValidationError("Enter a valid email address");
    }
    const existing = await this.repo.findByEmail(normalized);
    if (existing) throw new ValidationError("That admin already exists");
    const created = await this.repo.create(normalized, AdminRole.ADMIN, adminId);
    return sanitize(created);
  }

  async removeAdmin(adminId: string, targetId: string): Promise<{ removedId: string }> {
    await this.requireRoot(adminId);
    const target = await this.repo.findById(targetId);
    if (!target) throw new NotFoundError("Admin not found");
    // The root admin can never be removed — by anyone, including itself.
    if (target.role === AdminRole.ROOT || isRootEmail(target.email)) {
      throw new AuthorizationError("The root admin cannot be removed");
    }
    await this.repo.delete(targetId);
    return { removedId: targetId };
  }

  // ── Analytics ────────────────────────────────────────────────────────────────

  async getOverview(adminId: string) {
    await this.requireAdmin(adminId);
    const now = Date.now();
    const d7 = new Date(now - 7 * 864e5);
    const d30 = new Date(now - 30 * 864e5);

    const ratingBands: { label: string; min: number; max: number }[] = [
      { label: "<600", min: -1, max: 599 },
      { label: "600–999", min: 600, max: 999 },
      { label: "1000–1399", min: 1000, max: 1399 },
      { label: "1400–1799", min: 1400, max: 1799 },
      { label: "1800–2199", min: 1800, max: 2199 },
      { label: "2200+", min: 2200, max: 100000 },
    ];

    const [
      totalUsers,
      newUsers7,
      newUsers30,
      placementRequired,
      placementCompleted,
      placementInProgress,
      gamesByStatus,
      totalGames,
      topPlayers,
      recentUsers,
      bandCounts,
      signups,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.user.count({ where: { placementRequired: true } }),
      this.prisma.user.count({ where: { placementCompletedAt: { not: null } } }),
      this.prisma.placementRun.count({ where: { status: "IN_PROGRESS" } }),
      this.prisma.game.groupBy({ by: ["status"], _count: { _all: true } }),
      this.prisma.game.count(),
      this.prisma.user.findMany({
        orderBy: { rating: "desc" },
        take: 10,
        select: { id: true, username: true, rating: true, placementRequired: true },
      }),
      this.prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, username: true, email: true, rating: true, createdAt: true, placementRequired: true },
      }),
      Promise.all(
        ratingBands.map((b) =>
          this.prisma.user.count({ where: { rating: { gte: b.min < 0 ? 0 : b.min, lte: b.max } } })
        )
      ),
      this.prisma.$queryRaw<{ day: string; count: number }[]>`
        SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
               count(*)::int AS count
        FROM "users"
        WHERE "createdAt" >= now() - interval '30 days'
        GROUP BY 1 ORDER BY 1
      `,
    ]);

    const statusMap: Record<string, number> = {};
    for (const row of gamesByStatus) statusMap[row.status] = row._count._all;

    return {
      users: {
        total: totalUsers,
        newLast7: newUsers7,
        newLast30: newUsers30,
      },
      placement: {
        required: placementRequired,
        completed: placementCompleted,
        inProgress: placementInProgress,
      },
      games: {
        total: totalGames,
        pending: statusMap[GameStatus.PENDING] ?? 0,
        active: statusMap[GameStatus.ACTIVE] ?? 0,
        completed: statusMap[GameStatus.COMPLETED] ?? 0,
        abandoned: statusMap[GameStatus.ABANDONED] ?? 0,
      },
      ratingDistribution: ratingBands.map((b, i) => ({ label: b.label, count: bandCounts[i] })),
      signupsByDay: signups.map((s) => ({ day: s.day, count: Number(s.count) })),
      topPlayers,
      recentUsers,
    };
  }

  // ── User management ──────────────────────────────────────────────────────────

  async listUsers(adminId: string, opts: { search?: string; limit?: number; offset?: number }) {
    await this.requireAdmin(adminId);
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const where = opts.search
      ? {
          OR: [
            { username: { contains: opts.search, mode: "insensitive" as const } },
            { email: { contains: opts.search, mode: "insensitive" as const } },
          ],
        }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true,
          username: true,
          email: true,
          role: true,
          rating: true,
          placementRequired: true,
          placementCompletedAt: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, limit, offset };
  }

  async getUserDetail(adminId: string, userId: string) {
    await this.requireAdmin(adminId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        rating: true,
        placementRequired: true,
        placementCompletedAt: true,
        createdAt: true,
        playerRating: true,
        profile: { select: { firstName: true, lastName: true, country: true } },
      },
    });
    if (!user) throw new NotFoundError("User not found");
    const placementRuns = await this.placement.listRunsForUser(userId);
    const recentGames = await this.prisma.game.findMany({
      where: { OR: [{ whiteId: userId }, { blackId: userId }] },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        result: true,
        rated: true,
        timeControl: true,
        createdAt: true,
        white: { select: { id: true, username: true } },
        black: { select: { id: true, username: true } },
      },
    });
    return { user, placementRuns, recentGames };
  }

  /** Admin re-trigger of placement; next completed placement overwrites the rating. */
  async triggerPlacement(adminId: string, userId: string) {
    await this.requireAdmin(adminId);
    const run = await this.placement.triggerForUser(userId, adminId);
    return { ok: true, runId: run.id };
  }

  /** Manual rating override (also resets the Glicko state to match). */
  async overrideRating(adminId: string, userId: string, rating: number) {
    await this.requireAdmin(adminId);
    if (rating < 0 || rating > 3000) {
      throw new ValidationError("Rating must be between 0 and 3000");
    }
    const r = Math.round(rating);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { rating: r } }),
      this.prisma.playerRating.upsert({
        where: { userId },
        create: { userId, rating: r, deviation: 150, volatility: 0.06 },
        update: { rating: r, deviation: 150 },
      }),
    ]);
    return { ok: true, rating: r };
  }
}
