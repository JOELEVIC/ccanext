import type { PrismaClient, Prisma } from "@prisma/client";
import { EnquiryStatus, ClubKind, ClubLevel } from "@prisma/client";

export type ThrottleScope = "IP" | "PHONE";

export interface ThrottleDecision {
  allowed: boolean;
  /** Milliseconds until the current window rolls over. 0 when allowed. */
  retryAfterMs: number;
}

export class EnquiryRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Count one attempt against a rolling window and say whether it is allowed.
   *
   * Serverless has no shared memory, so this counter must live in Postgres
   * (BUILD_PLAN §6). It runs inside a transaction so the read-modify-write is
   * not lost under concurrency, and it opens with an UPSERT so two simultaneous
   * first attempts cannot race on the unique (scope, key).
   *
   * A blocked attempt still touches `lastSeenAt` — a flood keeps its own row
   * warm, which is what makes the window a real cool-down rather than a
   * best-of-N retry loop.
   */
  consume(
    scope: ThrottleScope,
    key: string,
    limit: number,
    windowMs: number,
    now: Date
  ): Promise<ThrottleDecision> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.enquiryThrottle.upsert({
        where: { scope_key: { scope, key } },
        create: { scope, key, count: 0, windowStartedAt: now, lastSeenAt: now },
        update: {},
      });

      const expired = now.getTime() - row.windowStartedAt.getTime() >= windowMs;
      const currentCount = expired ? 0 : row.count;

      if (currentCount >= limit) {
        await tx.enquiryThrottle.update({
          where: { id: row.id },
          data: { lastSeenAt: now },
        });
        return {
          allowed: false,
          retryAfterMs: Math.max(row.windowStartedAt.getTime() + windowMs - now.getTime(), 0),
        };
      }

      await tx.enquiryThrottle.update({
        where: { id: row.id },
        data: expired
          ? { count: 1, windowStartedAt: now, lastSeenAt: now }
          : { count: { increment: 1 }, lastSeenAt: now },
      });
      return { allowed: true, retryAfterMs: 0 };
    });
  }

  create(data: {
    schoolName: string;
    town?: string | null;
    region: string;
    kind: ClubKind;
    /** Null for an independent enquiry: no school, no education stage. */
    level: ClubLevel | null;
    sizeBand?: string | null;
    contactName: string;
    contactRole?: string | null;
    contactPhone: string;
    contactEmail?: string | null;
    note?: string | null;
    wantsFrench: boolean;
  }) {
    return this.prisma.schoolEnquiry.create({ data });
  }

  list(opts: { status?: EnquiryStatus | null; limit: number; offset: number }) {
    const where: Prisma.SchoolEnquiryWhereInput = opts.status ? { status: opts.status } : {};
    return Promise.all([
      this.prisma.schoolEnquiry.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: opts.limit,
        skip: opts.offset,
      }),
      this.prisma.schoolEnquiry.count({ where }),
    ]);
  }

  updateStatus(id: string, status: EnquiryStatus) {
    return this.prisma.schoolEnquiry.update({ where: { id }, data: { status } });
  }
}
