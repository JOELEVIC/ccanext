import type { ClubLevel, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/utils/types";
import { normalizeRegion } from "@/domains/region/regions";
import type { PlatformSettingService } from "@/domains/platform/platformSetting.service";
import {
  activeMembershipBlocker,
  installPatron,
  uniqueJoinCode,
  uniqueSlug,
} from "./provisioning";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A club, made by the person who is going to run it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `admin.service.ts` used to say creation belonged to staff, and gave a good
 * reason: a club is an institution whose members are children, its name sits
 * in a public directory beside real schools, and it plays in a league whose
 * table has to mean something.
 *
 * All of that is still true. What was wrong was treating it as a reason to
 * lock the door rather than a reason to look at what came through it. A
 * teacher who filled in the enquiry form waited on a person, and waiting was
 * the failure mode nobody measured.
 *
 * ── So the moderation moved, rather than going away ──────────────────────
 *
 * A club created here lands in `PENDING_REVIEW` while
 * `club.creation.requiresApproval` is on. That status is absent from
 * `PUBLIC_CLUB_STATUSES`, which means the club is not in the directory, is
 * not reachable by slug, and its join code finds nothing. It is a proposal,
 * not a club. Staff approve it into ONBOARDING and everything downstream —
 * roster, sessions, fixtures, the app — works exactly as it does for a club
 * staff made themselves.
 *
 * The switch is OFF by default now, so creation lands straight in ONBOARDING
 * and the club is live the moment it is made. `PENDING_REVIEW` and everything
 * that reads it stay exactly as they are — turning approval back on is one
 * setting, and it is worth turning on the day somebody is actually reading the
 * queue. See the note on the key in `platformSetting.service.ts` for what that
 * trade gives up.
 *
 * ── The creator becomes the patron, and that is the point ────────────────
 *
 * A join request can only be admitted by a patron of that club, so a club
 * with none is inert. `adminCreateClub` solves that with `patronUsername`;
 * here the answer is obvious — the person creating it is the person who will
 * run it. See `installPatron`.
 *
 * ── What this deliberately cannot do ─────────────────────────────────────
 *
 * Attach a school. A `schoolId` here would let anybody claim to be the chess
 * club of a named institution, which is exactly the claim the enquiry funnel
 * exists to verify. A self-serve club is INDEPENDENT — `Club.kind` derives
 * that from a null `schoolId` — and staff attach the school at review, which
 * is a thing they can see a reason for.
 */

export interface CreateClubInput {
  name: string;
  shortName: string;
  region: string;
  level?: ClubLevel | null;
}

export class ClubSelfServeService {
  constructor(
    private prisma: PrismaClient,
    private settings: PlatformSettingService,
  ) {}

  async create(userId: string, input: CreateClubInput) {
    const name = input.name.trim();
    const shortName = input.shortName.trim().toUpperCase();
    if (name.length < 3) throw new ValidationError("A club needs a name.");
    if (shortName.length < 2 || shortName.length > 4) {
      throw new ValidationError("The short name is 2 to 4 characters.");
    }

    const region = normalizeRegion(input.region);
    if (!region) throw new ValidationError("That is not one of Cameroon's regions.");

    // Asked before anything is written, so the answer names the club they are
    // already in rather than being a unique-constraint error with no name in
    // it. See `activeMembershipBlocker`.
    const blocker = await activeMembershipBlocker(this.prisma, userId);
    if (blocker) {
      throw new ValidationError(
        `You are already an active member of ${blocker}. Leave it before starting a club.`,
      );
    }

    // A name somebody else is already using is a real collision — two "GBHS
    // Limbe Chess Club" rows in a directory help nobody. The slug would
    // silently become `gbhs-limbe-chess-club-2`, which is worse than saying so.
    const clash = await this.prisma.club.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    });
    if (clash) throw new ValidationError("A club already has that name.");

    const requiresApproval = await this.settings.get("club.creation.requiresApproval");

    const club = await this.prisma.club.create({
      data: {
        slug: await uniqueSlug(this.prisma, name),
        name,
        shortName,
        region,
        // Independent, always. See the header: claiming a school is the claim
        // the enquiry funnel exists to check.
        schoolId: null,
        level: input.level ?? "SECONDARY",
        joinCode: await uniqueJoinCode(this.prisma),
        status: requiresApproval ? "PENDING_REVIEW" : "ONBOARDING",
      },
      select: { id: true },
    });

    await installPatron(this.prisma, club.id, userId);
    return { clubId: club.id, requiresApproval };
  }

  /**
   * Clubs waiting on somebody to look at them. Staff only, at the resolver.
   *
   * Oldest first, which is the order a queue should be worked and the
   * opposite of the order a list usually arrives in. A school that has been
   * waiting three weeks is the one that needs answering.
   */
  async pending(limit = 100) {
    return this.prisma.club.findMany({
      where: { status: "PENDING_REVIEW" },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        slug: true,
        name: true,
        shortName: true,
        region: true,
        level: true,
        createdAt: true,
        memberships: {
          where: { role: "PATRON", status: "ACTIVE" },
          select: { user: { select: { username: true, email: true } } },
        },
      },
    });
  }

  /** Approve into ONBOARDING — the state a staff-made club starts in. */
  async approve(clubId: string) {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { status: true },
    });
    if (!club) throw new NotFoundError("That club does not exist.");
    if (club.status !== "PENDING_REVIEW") {
      throw new ValidationError("That club is not waiting for review.");
    }
    await this.prisma.club.update({
      where: { id: clubId },
      data: { status: "ONBOARDING" },
    });
    return clubId;
  }

  /**
   * Refuse it.
   *
   * ARCHIVED rather than deleted. The club is already invisible either way,
   * and a row that is kept can be looked at when the teacher writes in asking
   * why — a deleted one leaves staff with nothing to answer from. It also
   * keeps the name and slug reserved, so a refused club cannot be recreated
   * five minutes later by the same person under the same name.
   */
  async reject(clubId: string) {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { status: true },
    });
    if (!club) throw new NotFoundError("That club does not exist.");
    if (club.status !== "PENDING_REVIEW") {
      throw new ValidationError("That club is not waiting for review.");
    }
    await this.prisma.club.update({
      where: { id: clubId },
      data: { status: "ARCHIVED" },
    });
    return clubId;
  }
}
