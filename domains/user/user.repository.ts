import type { PrismaClient, User, Profile, UserRole } from "@prisma/client";
import type { UserFilters } from "./user.types";

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

  async findMany(filters?: UserFilters) {
    const where: Record<string, unknown> = {};
    if (filters?.role) where.role = filters.role;
    if (filters?.schoolId) where.schoolId = filters.schoolId;
    if (filters?.search) {
      (where as { OR?: unknown[] }).OR = [
        { username: { contains: filters.search, mode: "insensitive" as const } },
        { email: { contains: filters.search, mode: "insensitive" as const } },
      ];
    }

    return this.prisma.user.findMany({
      where,
      include: { profile: true, school: true },
      orderBy: { rating: "desc" },
    });
  }

  async create(data: {
    email: string;
    username: string;
    passwordHash: string;
    role: UserRole;
    schoolId?: string;
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
