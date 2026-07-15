import type { PrismaClient, Prisma } from "@prisma/client";
import { ActivityStatus } from "@prisma/client";

export class ActivityRepository {
  constructor(private prisma: PrismaClient) {}

  /** Public feed: published only, featured first, newest first. */
  publishedFeed(opts: { type?: string; region?: string; limit: number; offset: number }) {
    const where: Prisma.ActivityWhereInput = {
      status: ActivityStatus.PUBLISHED,
      ...(opts.type ? { type: opts.type as Prisma.ActivityWhereInput["type"] } : {}),
      ...(opts.region ? { region: opts.region } : {}),
    };
    return this.prisma.activity.findMany({
      where,
      include: { images: { orderBy: { sortOrder: "asc" } } },
      orderBy: [{ featured: "desc" }, { publishedAt: "desc" }],
      take: opts.limit,
      skip: opts.offset,
    });
  }

  countPublished(opts: { type?: string; region?: string }) {
    return this.prisma.activity.count({
      where: {
        status: ActivityStatus.PUBLISHED,
        ...(opts.type ? { type: opts.type as Prisma.ActivityWhereInput["type"] } : {}),
        ...(opts.region ? { region: opts.region } : {}),
      },
    });
  }

  publishedBySlug(slug: string) {
    return this.prisma.activity.findFirst({
      where: { slug, status: ActivityStatus.PUBLISHED },
      include: { images: { orderBy: { sortOrder: "asc" } } },
    });
  }

  findById(id: string) {
    return this.prisma.activity.findUnique({
      where: { id },
      include: { images: { orderBy: { sortOrder: "asc" } } },
    });
  }

  findBySlug(slug: string) {
    return this.prisma.activity.findUnique({ where: { slug } });
  }

  adminList(opts: { status?: string; search?: string; limit: number; offset: number }) {
    const where: Prisma.ActivityWhereInput = {
      ...(opts.status ? { status: opts.status as ActivityStatus } : {}),
      ...(opts.search
        ? { title: { contains: opts.search, mode: "insensitive" as const } }
        : {}),
    };
    return Promise.all([
      this.prisma.activity.findMany({
        where,
        include: { images: { orderBy: { sortOrder: "asc" } } },
        orderBy: { updatedAt: "desc" },
        take: opts.limit,
        skip: opts.offset,
      }),
      this.prisma.activity.count({ where }),
    ]);
  }

  create(data: Prisma.ActivityCreateInput) {
    return this.prisma.activity.create({
      data,
      include: { images: { orderBy: { sortOrder: "asc" } } },
    });
  }

  update(id: string, data: Prisma.ActivityUpdateInput) {
    return this.prisma.activity.update({
      where: { id },
      data,
      include: { images: { orderBy: { sortOrder: "asc" } } },
    });
  }

  delete(id: string) {
    return this.prisma.activity.delete({ where: { id } });
  }

  /**
   * Replace the whole gallery for an activity (transactionally, so a failed
   * write can never leave a published post with zero images).
   *
   * Clients that only round-trip {url, caption} — the current ccaadmin editor
   * — must not wipe rendition metadata written by the ingest pipeline, so any
   * field the caller OMITS (undefined) is coalesced from the existing row
   * with the same url. Explicit nulls still clear a field on purpose.
   */
  async replaceImages(
    activityId: string,
    images: {
      url: string;
      thumbUrl?: string | null;
      width?: number | null;
      height?: number | null;
      highlight?: boolean | null;
      caption?: string | null;
    }[]
  ) {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.activityImage.findMany({ where: { activityId } });
      const byUrl = new Map(existing.map((img) => [img.url, img]));

      await tx.activityImage.deleteMany({ where: { activityId } });
      if (images.length) {
        await tx.activityImage.createMany({
          data: images.map((img, i) => {
            const prev = byUrl.get(img.url);
            return {
              activityId,
              url: img.url,
              thumbUrl: img.thumbUrl === undefined ? prev?.thumbUrl ?? null : img.thumbUrl,
              width: img.width === undefined ? prev?.width ?? null : img.width,
              height: img.height === undefined ? prev?.height ?? null : img.height,
              highlight: img.highlight === undefined ? prev?.highlight ?? false : img.highlight ?? false,
              caption: img.caption === undefined ? prev?.caption ?? null : img.caption,
              sortOrder: i,
            };
          }),
        });
      }
    });
    return this.findById(activityId);
  }
}
