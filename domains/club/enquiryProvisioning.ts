import type { ClubStatus, PrismaClient } from "@prisma/client";

import type { PlatformSettingService } from "@/domains/platform/platformSetting.service";

import { uniqueJoinCode, uniqueSlug } from "./provisioning";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A club, made from an enquiry, by somebody who has no account yet.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `selfServe.service.ts` creates a club for a signed-in person and installs
 * them as its patron. The enquiry funnel has no such person: it is a public
 * form, and the whole point of it is that somebody can reach the academy
 * before they have anything. Everything awkward here follows from that.
 *
 * ── The club has no patron, and that is handled at the door ──────────────
 *
 * A club nobody can admit a join request to is inert, so a patron-less club is
 * not a club. The answer is not a claim token or an email round-trip: it is
 * that a club with no patron admits its FIRST code-holder as patron —
 * `decideJoin` in `joinByCode.ts` owns that rule. The join code goes to the
 * enquirer and nowhere else, so the first person through the door is the
 * person who filled in the form. It fires once, because after it the club has
 * a patron and every later joiner is an ordinary PLAYER.
 *
 * ── The school is NOT attached, whatever the form said ───────────────────
 *
 * An enquiry carries a typed-in organisation name, not a School row, and
 * anybody can type "GBHS Limbe". Attaching a school here would let a stranger
 * publish a page claiming to be a named institution's chess club, which is
 * precisely the claim this funnel exists to verify. So `schoolId` is null and
 * `Club.kind` therefore derives INDEPENDENT — true, for now — and staff attach
 * the school at review, which is a thing they can see a reason for. The
 * enquiry keeps `kind` and `schoolName` so the reviewer has the claim in front
 * of them.
 *
 * ── The enquiry is the record; the club is a bonus ───────────────────────
 *
 * Every failure here is swallowed by the caller. A duplicate club name, a
 * slug collision, a database hiccup — none of them may cost somebody the
 * enquiry they just filled in on a phone. Provisioning returns null and the
 * enquiry stands, exactly as it did before any of this existed.
 */

export interface EnquiryClubSeed {
  /** The organisation's name as typed. Becomes the club's name. */
  name: string;
  /** Canonical region key, already normalised by the enquiry service. */
  region: string;
}

export interface ProvisionedClub {
  id: string;
  slug: string;
  name: string;
  /**
   * Returned ONCE, to the person who just submitted the form, and never on the
   * public `Club` type. It is what makes them the patron — see the header.
   */
  joinCode: string;
  awaitingApproval: boolean;
}

/**
 * A 2–4 character mark for the crest, from the club's own name.
 *
 * Initials of the first words, skipping the ones that carry no identity —
 * "GBHS Limbe Chess Club" is GL, not GLCC. Falls back to the first letters of
 * the name when a single word is all there is.
 */
export function deriveShortName(name: string): string {
  const skip = new Set([
    "chess", "club", "the", "of", "and", "de", "du", "des", "la", "le", "les",
    "echecs", "échecs", "d", "l",
  ]);
  const words = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0 && !skip.has(w.toLowerCase()));

  const initials = words.map((w) => w[0]).join("").toUpperCase();
  if (initials.length >= 2) return initials.slice(0, 4);

  // One word carries the identity — "Club d'échecs de Bafoussam" is Bafoussam,
  // and BA is right where B is thin and CLU is actively wrong. Only when even
  // that is missing ("Chess Club", all skip-words) does the raw name answer.
  const source = words[0] ?? name;
  const letters = source.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return letters.slice(0, 3).padEnd(2, "X");
}

/**
 * Create the club an enquiry describes.
 *
 * Returns null — never throws — when the club cannot be made. The caller has
 * an enquiry to save either way.
 */
export async function provisionClubFromEnquiry(
  prisma: PrismaClient,
  settings: PlatformSettingService,
  seed: EnquiryClubSeed,
): Promise<ProvisionedClub | null> {
  const name = seed.name.trim();
  if (name.length < 3) return null;

  // A second "GBHS Limbe Chess Club" in the directory helps nobody, and the
  // enquiry itself is still recorded — a reviewer sees the collision and
  // decides, which is a better outcome than two identical public pages.
  const clash = await prisma.club.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true },
  });
  if (clash) return null;

  const requiresApproval = await settings.get("club.creation.requiresApproval");
  const status: ClubStatus = requiresApproval ? "PENDING_REVIEW" : "ONBOARDING";

  const club = await prisma.club.create({
    data: {
      slug: await uniqueSlug(prisma, name),
      name,
      shortName: deriveShortName(name),
      region: seed.region,
      // Never attached from a form. See the header.
      schoolId: null,
      level: "SECONDARY",
      joinCode: await uniqueJoinCode(prisma),
      status,
    },
    select: { id: true, slug: true, name: true, joinCode: true },
  });

  return { ...club, awaitingApproval: requiresApproval };
}
