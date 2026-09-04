import type { PrismaClient } from "@prisma/client";
import { publicPlayerSelect } from "./publicPlayer.select";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Finding a person you already know.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The three ways somebody arrives holding a way to reach a friend: a username
 * they were told, an email address they have, or a phone number in their
 * contacts. This turns any of the three into an id a challenge or a friend
 * request can be addressed to.
 *
 * ── Username is a search; email and phone are not ────────────────────────
 *
 * A username is public. It is on every roster and every fixture board, and
 * searching it by prefix is how somebody finds "ateba" from "ate".
 *
 * An email address and a phone number are neither. A prefix search over them
 * would be an oracle: type `a@`, read back every address on the platform that
 * starts with it, and you have enumerated a school's worth of children's
 * contact details from a public query. So they match on the WHOLE normalised
 * value or not at all — you can confirm an address you already have, which is
 * the thing a person adding a friend is actually doing, and you cannot
 * discover one you do not.
 *
 * Even the whole-value match confirms existence, which is why [MAX_RESULTS] is
 * small and the resolver rate-limits by caller. It is a real if narrow
 * disclosure and it was a deliberate trade — see the plan.
 *
 * ── Nothing here returns an address ──────────────────────────────────────
 *
 * The result is a `PublicPlayer` and nothing else. Matching on an email tells
 * you an account exists; it does not hand back the address, the phone number,
 * or anything §4.3 would have withheld. A non-consented minor found by their
 * own phone number is still "Brenda A." with no avatar.
 */

const MAX_RESULTS = 10;

/**
 * Digits only, and the country code made explicit.
 *
 * Cameroon numbers are written every way a person can think of — `677 12 34 56`,
 * `+237 677123456`, `00237677123456`. Storing and matching a normalised form
 * means the number in somebody's contacts finds the account whichever way
 * either of them typed it. A nine-digit local number is assumed Cameroonian,
 * which is the only country this platform operates in; anything longer is
 * taken as already carrying its code.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D+/g, "").replace(/^0+/, "");
  if (digits.length < 8) return null;
  if (digits.length === 9) return `237${digits}`;
  return digits;
}

/** Cheap enough to run before touching the database. */
function looksLikeEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
}

export class PlayerLookupService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Players matching [query], for a signed-in caller.
   *
   * [viewerId] is excluded from the results: finding yourself in a list of
   * people to add is noise, and every action offered against the row would
   * have to refuse.
   */
  async find(query: string, viewerId: string) {
    const term = query.trim();
    if (term.length < 3) return [];

    if (looksLikeEmail(term)) {
      return this.exact({ email: term.toLowerCase() }, viewerId);
    }

    const phone = normalizePhone(term);
    // A term that is all digits is a phone number attempt, not a username —
    // usernames on this platform are not numeric, and searching digits as a
    // prefix would be the enumeration this file exists to prevent.
    if (phone && /^[\d\s+()-]+$/.test(term)) {
      return this.exact({ profile: { is: { phone } } }, viewerId);
    }

    return this.prisma.user.findMany({
      where: {
        id: { not: viewerId },
        username: { startsWith: term, mode: "insensitive" },
      },
      select: publicPlayerSelect,
      orderBy: { username: "asc" },
      take: MAX_RESULTS,
    });
  }

  /** One whole-value match, or nothing. Never a list. */
  private async exact(
    where: Record<string, unknown>,
    viewerId: string,
  ) {
    const row = await this.prisma.user.findFirst({
      where: { ...where, id: { not: viewerId } } as never,
      select: publicPlayerSelect,
    });
    return row ? [row] : [];
  }

  /**
   * Players in the open pool at a given cadence, for somebody who would
   * rather pick a face than take whatever the seek queue offers.
   *
   * The same two filters `openChallenges` applies to the creator of an
   * invite, applied to people instead: the switch they set themselves, and
   * the one their patron set for the whole club.
   */
  async openPool(viewerId: string, limit = 30) {
    return this.prisma.user.findMany({
      where: {
        id: { not: viewerId },
        profile: { is: { openToChallenges: true } },
        memberships: { none: { status: "ACTIVE", club: { poolOptOut: true } } },
      },
      select: publicPlayerSelect,
      // By rating, so the list a person scrolls is ordered by the only thing
      // on it that helps them choose. `createdAt` would put the platform's
      // oldest accounts in front of everybody for ever.
      orderBy: { rating: "desc" },
      take: limit,
    });
  }
}
