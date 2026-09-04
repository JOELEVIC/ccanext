import { randomInt } from "node:crypto";
import type { ClubLevel, ClubStatus, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/utils/types";
import { normalizeRegion } from "@/domains/region/regions";
import {
  activeMembershipBlocker,
  installPatron,
  uniqueJoinCode,
  uniqueSlug,
} from "./provisioning";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Creating and running clubs from the staff console.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Until now a club could only be created by running `scripts/onboard-clubs.ts`
 * from a developer's machine. Everything downstream of a club existing was
 * built and shipped — the console, the roster, sessions, fixtures, the join
 * code, the app — and the first step was a script. A school that filled in the
 * enquiry form waited for somebody to open a terminal.
 *
 * This is that step, as an operation.
 *
 * ── It used to be the only door, and is not any more ─────────────────────
 *
 * This file argued that creation should stay in the STAFF console: a club is
 * an institution whose members are children, its name appears in a public
 * directory, and it plays in a league whose table has to mean something.
 * Anyone-can-create was called a moderation problem the enquiry funnel
 * already existed to avoid.
 *
 * The moderation problem was real and the conclusion was too strong. A school
 * that filled in the form still waited on a person, and the wait was the
 * failure mode nobody saw. So creation is self-serve now
 * (`club/selfServe.service.ts`) and the moderation is a REVIEW rather than a
 * gate on the door: a club made by somebody who is not staff lands in
 * PENDING_REVIEW, which is invisible and inert, until staff approve it — or
 * lands ready to go, if staff have turned that requirement off.
 *
 * This service is still the staff door, and it still creates ONBOARDING
 * directly. Staff making a club IS the approval.
 *
 * ── The deadlock this had to solve ───────────────────────────────────────
 *
 * A new club has no members, and a join request can only be admitted by a
 * patron of that club. So a club created empty is a club whose first request
 * can never be admitted by anybody — the code works, the request lands, and
 * nobody on earth has permission to answer it.
 *
 * Hence `patronUsername` on creation and `setPatron` after it. Installing the
 * first patron is the one membership in this system that no patron approves,
 * because there is nobody to do the approving; every membership after it goes
 * through the ordinary door.
 *
 * ── Auth ─────────────────────────────────────────────────────────────────
 *
 * None here. The resolver gates on the admin token, which is the pattern
 * `adminCreateSchool` already set — the service is domain-plain and testable
 * without a token.
 */

export interface AdminCreateClubInput {
  name: string;
  shortName: string;
  region: string;
  schoolId?: string | null;
  level?: ClubLevel | null;
  /** The teacher who will run it. Optional, but a club without one is inert. */
  patronUsername?: string | null;
}

const MAX_PAGE = 100;

export class ClubAdminService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Every club, with the two numbers staff actually ring up about — how many
   * members, and how many are waiting — plus the join code.
   *
   * This is the only list in the product that carries `joinCode`. It is
   * reachable through the admin token alone, which is separately signed and
   * never issued to a player.
   */
  async list(opts: { search?: string; limit?: number; offset?: number } = {}) {
    const take = Math.min(Math.max(opts.limit ?? 50, 1), MAX_PAGE);
    const search = opts.search?.trim();

    const rows = await this.prisma.club.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } },
              { joinCode: { contains: search.toUpperCase() } },
            ],
          }
        : undefined,
      orderBy: [{ createdAt: "desc" }],
      take,
      skip: Math.max(opts.offset ?? 0, 0),
      include: {
        school: { select: { name: true } },
        memberships: {
          where: { status: { in: ["ACTIVE", "PENDING"] } },
          select: {
            status: true,
            role: true,
            user: { select: { username: true } },
          },
        },
      },
    });

    return rows.map((club) => ({
      id: club.id,
      slug: club.slug,
      name: club.name,
      shortName: club.shortName,
      region: club.region,
      level: club.level,
      status: club.status,
      schoolName: club.school?.name ?? null,
      joinCode: club.joinCode,
      memberCount: club.memberships.filter((m) => m.status === "ACTIVE").length,
      pendingCount: club.memberships.filter((m) => m.status === "PENDING").length,
      // Named rather than counted: "no patron" is the state that makes a club
      // inert, and a zero in a column is easy to read past.
      patronNames: club.memberships
        .filter((m) => m.status === "ACTIVE" && m.role === "PATRON")
        .map((m) => m.user.username),
      createdAt: club.createdAt,
    }));
  }

  async create(input: AdminCreateClubInput) {
    const name = input.name.trim();
    const shortName = input.shortName.trim().toUpperCase();
    if (name.length < 3) throw new ValidationError("A club needs a name.");
    if (shortName.length < 2 || shortName.length > 4) {
      throw new ValidationError("The short name is 2 to 4 characters.");
    }

    const region = normalizeRegion(input.region);
    if (!region) throw new ValidationError("That is not one of Cameroon's regions.");

    // A school is optional — an independent club is a town's rather than a
    // school's — but a school id that names nothing is a typo, not a choice.
    if (input.schoolId) {
      const school = await this.prisma.school.findUnique({
        where: { id: input.schoolId },
        select: { id: true },
      });
      if (!school) throw new NotFoundError("That school does not exist.");
    }

    const patron = input.patronUsername?.trim()
      ? await this.findPatron(input.patronUsername.trim())
      : null;

    const slug = await uniqueSlug(this.prisma, name);
    const joinCode = await uniqueJoinCode(this.prisma);

    const club = await this.prisma.club.create({
      data: {
        slug,
        name,
        shortName,
        region,
        schoolId: input.schoolId ?? null,
        level: input.level ?? "SECONDARY",
        joinCode,
        // ONBOARDING, not ACTIVE. A club appears in the public directory when
        // staff say it is ready, and "created" is not the same claim.
        status: "ONBOARDING",
      },
      select: { id: true },
    });

    if (patron) await installPatron(this.prisma, club.id, patron.id);

    return this.one(club.id);
  }

  /**
   * Install or replace the club's patron.
   *
   * The escape from the deadlock for a club created without one. It does not
   * demote whoever is already a patron — a club may have several, and a
   * handover is two operations so that neither half is implicit.
   */
  async setPatron(clubId: string, username: string) {
    await this.requireClub(clubId);
    const patron = await this.findPatron(username.trim());
    await installPatron(this.prisma, clubId, patron.id);
    return this.one(clubId);
  }

  /**
   * Mint a new code, retiring the old one.
   *
   * For the day a code reaches a WhatsApp group it should not have. Existing
   * members are unaffected — the code is how you ask to join, not what proves
   * you are in.
   */
  async regenerateJoinCode(clubId: string) {
    await this.requireClub(clubId);
    await this.prisma.club.update({
      where: { id: clubId },
      data: { joinCode: await uniqueJoinCode(this.prisma) },
    });
    return this.one(clubId);
  }

  /** ONBOARDING → ACTIVE when staff are satisfied, and back if need be. */
  async setStatus(clubId: string, status: ClubStatus) {
    await this.requireClub(clubId);
    await this.prisma.club.update({ where: { id: clubId }, data: { status } });
    return this.one(clubId);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async one(clubId: string) {
    const rows = await this.list({ limit: MAX_PAGE });
    const club = rows.find((c) => c.id === clubId);
    if (club) return club;
    // A club created a moment ago that is not in the first page of a
    // newest-first list is not a state this can reach; thrown rather than
    // returned as null so a future edit that breaks it fails loudly.
    throw new NotFoundError("The club could not be read back.");
  }

  private async requireClub(clubId: string) {
    const club = await this.prisma.club.findUnique({
      where: { id: clubId },
      select: { id: true },
    });
    if (!club) throw new NotFoundError("That club does not exist.");
    return club;
  }

  /**
   * The account that will run the club, refused early if it cannot.
   *
   * One ACTIVE membership per user is a partial unique index, so a teacher who
   * already runs another club cannot be installed here — and being told that
   * now is better than a constraint error with no name in it. The same rule,
   * asked of the caller rather than of a named account, is
   * `activeMembershipBlocker` in `provisioning.ts`.
   */
  private async findPatron(username: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ username }, { email: username.toLowerCase() }] },
      select: {
        id: true,
        memberships: {
          where: { status: "ACTIVE" },
          select: { club: { select: { name: true } } },
        },
      },
    });
    if (!user) throw new NotFoundError(`No account called "${username}".`);
    const held = user.memberships[0];
    if (held) {
      throw new ValidationError(
        `That account is already an active member of ${held.club.name}.`,
      );
    }
    return user;
  }

}
