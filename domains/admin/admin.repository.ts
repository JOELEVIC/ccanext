import type { PrismaClient } from "@prisma/client";
import { AdminRole } from "@prisma/client";

export class AdminRepository {
  constructor(private prisma: PrismaClient) {}

  findByEmail(email: string) {
    return this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  }

  findById(id: string) {
    return this.prisma.adminUser.findUnique({ where: { id } });
  }

  listAll() {
    return this.prisma.adminUser.findMany({ orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
  }

  create(email: string, role: AdminRole, addedById: string | null) {
    return this.prisma.adminUser.create({
      data: { email: email.toLowerCase(), role, addedById, passwordHash: "" },
    });
  }

  setPassword(id: string, passwordHash: string) {
    return this.prisma.adminUser.update({
      where: { id },
      data: { passwordHash, lastLoginAt: new Date() },
    });
  }

  touchLogin(id: string) {
    return this.prisma.adminUser.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  delete(id: string) {
    return this.prisma.adminUser.delete({ where: { id } });
  }

  /** Ensure the ROOT seed exists (idempotent backstop alongside the SQL seed). */
  ensureRoot(email: string) {
    return this.prisma.adminUser.upsert({
      where: { email: email.toLowerCase() },
      create: { email: email.toLowerCase(), role: AdminRole.ROOT, passwordHash: "" },
      update: { role: AdminRole.ROOT },
    });
  }
}
