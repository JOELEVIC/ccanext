import type { PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/utils/types";
import { normalizePhone } from "./playerLookup.service";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The switches a player owns over their own visibility.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Separate from `updateProfile`, which is about who somebody IS — their name,
 * their date of birth, their country. This is about what the platform may do
 * with that. Two different questions, and mixing them would put a privacy
 * switch behind a form somebody opens to fix a spelling.
 *
 * Every field is optional and undefined means "leave it": a settings screen
 * saving one toggle must not send the others back as it last read them.
 */

export interface MySettingsInput {
  openToChallenges?: boolean | null;
  gamesPublic?: boolean | null;
  phone?: string | null;
}

export class PlayerSettingsService {
  constructor(private prisma: PrismaClient) {}

  async update(userId: string, input: MySettingsInput) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundError("User profile not found");

    const data: Record<string, unknown> = {};
    if (input.openToChallenges != null) data.openToChallenges = input.openToChallenges;
    if (input.gamesPublic != null) data.gamesPublic = input.gamesPublic;

    if (input.phone !== undefined) {
      if (input.phone === null || input.phone.trim() === "") {
        // Explicitly clearable. A number somebody no longer uses is worse than
        // none: it points a friend request at an account they cannot reach.
        data.phone = null;
      } else {
        const phone = normalizePhone(input.phone);
        if (!phone) throw new ValidationError("That does not look like a phone number.");

        // Taken by somebody else is a real collision and the message must not
        // say by whom — that would turn this form into the enumeration oracle
        // `playerLookup.service.ts` refuses to be.
        const held = await this.prisma.profile.findFirst({
          where: { phone, userId: { not: userId } },
          select: { id: true },
        });
        if (held) throw new ValidationError("That number is already in use.");
        data.phone = phone;
      }
    }

    return this.prisma.profile.update({
      where: { userId },
      data: data as never,
    });
  }
}
