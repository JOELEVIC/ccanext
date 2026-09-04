import { randomInt } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { makeJoinCode, nextFreeSlug, slugify } from "./joinCode";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The three things that have to happen for a club to exist.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A free slug, an unused join code, and a first patron. They were private
 * methods on `ClubAdminService` while staff were the only people who could
 * create a club. There are now two doors — the staff console and self-serve —
 * and two copies of "mint a code that nobody else holds" is two places for
 * the retry count to disagree.
 *
 * Plain functions over a `PrismaClient` rather than a class: none of them
 * holds state, and all three are called from inside a transaction in one
 * caller and outside one in the other.
 */

/**
 * A code no club currently holds.
 *
 * Fifty attempts against a 31-symbol six-character alphabet — about 730
 * million codes — so a collision is a database problem rather than a
 * probability one, and the throw says so.
 */
export async function uniqueJoinCode(prisma: PrismaClient): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const code = makeJoinCode(randomInt);
    const clash = await prisma.club.findUnique({
      where: { joinCode: code },
      select: { id: true },
    });
    if (!clash) return code;
  }
  throw new Error("Could not find an unused join code in 50 attempts");
}

/** A slug derived from the name, with a numeric tail if it is taken. */
export async function uniqueSlug(prisma: PrismaClient, name: string): Promise<string> {
  const taken = new Set(
    (await prisma.club.findMany({ select: { slug: true } })).map((c) => c.slug),
  );
  return nextFreeSlug(slugify(name), taken);
}

/**
 * Make somebody the club's patron, ACTIVE, in one step.
 *
 * **The one membership in this system that no patron approves.** A join
 * request can only be admitted by a patron of that club, so a club created
 * empty is one whose first request can never be answered by anybody — the
 * code works, the request lands, and no human being has permission to say
 * yes. Every membership after this one goes through the ordinary door.
 */
export async function installPatron(
  prisma: PrismaClient,
  clubId: string,
  userId: string,
): Promise<void> {
  await prisma.clubMembership.upsert({
    where: { clubId_userId: { clubId, userId } },
    create: { clubId, userId, role: "PATRON", status: "ACTIVE" },
    update: { role: "PATRON", status: "ACTIVE", leftAt: null },
  });
}

/**
 * Whether this account can take on a club, and the reason if not.
 *
 * "Exactly one ACTIVE membership per user" is a partial unique index that
 * Prisma cannot express (`club_memberships_userId_active_key`, applied by
 * hand). Hitting it produces a constraint error with no name in it; asking
 * first produces a sentence naming the club they are already in.
 *
 * Returns null when they are free.
 */
export async function activeMembershipBlocker(
  prisma: PrismaClient,
  userId: string,
): Promise<string | null> {
  const held = await prisma.clubMembership.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { club: { select: { name: true } } },
  });
  return held ? held.club.name : null;
}
