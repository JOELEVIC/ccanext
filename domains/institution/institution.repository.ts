import type { PrismaClient } from "@prisma/client";

export class InstitutionRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.school.findUnique({
      where: { id },
      include: {
        students: {
          include: { profile: true },
          orderBy: { rating: "desc" as const },
        },
        tournaments: { orderBy: { startDate: "desc" as const } },
      },
    });
  }

  async findAll() {
    return this.prisma.school.findMany({
      include: {
        _count: { select: { students: true, tournaments: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async findByRegion(region: string) {
    return this.prisma.school.findMany({
      where: { region },
      include: {
        _count: { select: { students: true, tournaments: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async create(data: { name: string; region: string }) {
    return this.prisma.school.create({ data });
  }

  async update(
    id: string,
    data: { name?: string; region?: string }
  ) {
    return this.prisma.school.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    return this.prisma.school.delete({ where: { id } });
  }

  async getSchoolStudents(schoolId: string) {
    return this.prisma.user.findMany({
      where: { schoolId },
      include: { profile: true },
      orderBy: { rating: "desc" },
    });
  }
}
