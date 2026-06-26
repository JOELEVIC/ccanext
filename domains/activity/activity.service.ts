import type { PrismaClient, Prisma } from "@prisma/client";
import { ActivityStatus } from "@prisma/client";
import { ActivityRepository } from "./activity.repository";
import { NotFoundError, ValidationError } from "@/utils/types";

const VALID_TYPES = ["ANNOUNCEMENT", "EVENT_RECAP", "ARTICLE", "GALLERY", "RESULT"];

export interface ActivityInput {
  type?: string;
  title: string;
  excerpt?: string | null;
  bodyJson?: unknown; // Tiptap document
  bodyText?: string | null;
  coverImageUrl?: string | null;
  videoEmbedUrl?: string | null;
  region?: string | null;
  tags?: string[];
  eventDate?: Date | string | null;
  featured?: boolean;
  images?: { url: string; caption?: string | null }[];
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export class ActivityService {
  private repo: ActivityRepository;

  constructor(private prisma: PrismaClient) {
    this.repo = new ActivityRepository(prisma);
  }

  // ── public ────────────────────────────────────────────────────────────────
  async getFeed(opts: { type?: string; region?: string; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 12, 1), 50);
    const offset = Math.max(opts.offset ?? 0, 0);
    const [items, total] = await Promise.all([
      this.repo.publishedFeed({ type: opts.type, region: opts.region, limit, offset }),
      this.repo.countPublished({ type: opts.type, region: opts.region }),
    ]);
    return { items, total, limit, offset };
  }

  async getPublishedBySlug(slug: string) {
    const a = await this.repo.publishedBySlug(slug);
    if (!a) throw new NotFoundError("Activity not found");
    return a;
  }

  // ── admin ─────────────────────────────────────────────────────────────────
  async adminList(opts: { status?: string; search?: string; limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    const offset = Math.max(opts.offset ?? 0, 0);
    const [items, total] = await this.repo.adminList({ status: opts.status, search: opts.search, limit, offset });
    return { items, total, limit, offset };
  }

  async adminGet(id: string) {
    const a = await this.repo.findById(id);
    if (!a) throw new NotFoundError("Activity not found");
    return a;
  }

  private async uniqueSlug(title: string): Promise<string> {
    const base = slugify(title) || "post";
    let slug = base;
    let n = 2;
    while (await this.repo.findBySlug(slug)) slug = `${base}-${n++}`;
    return slug;
  }

  private validateInput(input: ActivityInput) {
    if (!input.title || input.title.trim().length < 2) {
      throw new ValidationError("A title is required");
    }
    if (input.type && !VALID_TYPES.includes(input.type)) {
      throw new ValidationError(`Invalid activity type: ${input.type}`);
    }
  }

  async create(input: ActivityInput, authorAdminId: string) {
    this.validateInput(input);
    const slug = await this.uniqueSlug(input.title);
    const created = await this.repo.create({
      slug,
      type: (input.type as Prisma.ActivityCreateInput["type"]) ?? "ARTICLE",
      title: input.title.trim(),
      excerpt: input.excerpt ?? null,
      bodyJson: (input.bodyJson as Prisma.InputJsonValue) ?? undefined,
      bodyText: input.bodyText ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
      videoEmbedUrl: input.videoEmbedUrl ?? null,
      region: input.region ?? null,
      tags: input.tags ?? [],
      featured: input.featured ?? false,
      eventDate: input.eventDate ? new Date(input.eventDate) : null,
      authorAdminId,
      status: ActivityStatus.DRAFT,
    });
    if (input.images?.length) {
      return this.repo.replaceImages(created.id, input.images);
    }
    return created;
  }

  async update(id: string, input: ActivityInput) {
    await this.adminGet(id);
    this.validateInput(input);
    const updated = await this.repo.update(id, {
      type: input.type ? (input.type as Prisma.ActivityUpdateInput["type"]) : undefined,
      title: input.title.trim(),
      excerpt: input.excerpt ?? null,
      bodyJson: (input.bodyJson as Prisma.InputJsonValue) ?? undefined,
      bodyText: input.bodyText ?? null,
      coverImageUrl: input.coverImageUrl ?? null,
      videoEmbedUrl: input.videoEmbedUrl ?? null,
      region: input.region ?? null,
      tags: input.tags ?? undefined,
      featured: input.featured ?? undefined,
      eventDate: input.eventDate ? new Date(input.eventDate) : null,
    });
    if (input.images) {
      return this.repo.replaceImages(id, input.images);
    }
    return updated;
  }

  async publish(id: string) {
    const a = await this.adminGet(id);
    return this.repo.update(id, {
      status: ActivityStatus.PUBLISHED,
      publishedAt: a.publishedAt ?? new Date(),
    });
  }

  async archive(id: string) {
    await this.adminGet(id);
    return this.repo.update(id, { status: ActivityStatus.ARCHIVED });
  }

  async unpublish(id: string) {
    await this.adminGet(id);
    return this.repo.update(id, { status: ActivityStatus.DRAFT });
  }

  async remove(id: string) {
    await this.adminGet(id);
    await this.repo.delete(id);
    return { removedId: id };
  }
}
