import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";

import type { ChallengeService } from "@/domains/challenge/challenge.service";
import { AuthenticationError, AuthorizationError } from "@/utils/types";
import { HouseBotService } from "./houseBot.service";

/**
 * `session` is the only place a token is minted for an account nobody signs
 * into. The secret gates the door; the flag decides who may walk through it.
 */
const SECRET = "a-secret-that-is-at-least-thirty-two-characters";

function service(users: Record<string, { role: string; isHouseBot: boolean }>) {
  const prisma = {
    user: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        users[where.id] ? { id: where.id, ...users[where.id] } : null,
    },
  } as unknown as PrismaClient;
  return new HouseBotService(prisma, {} as ChallengeService, {
    secret: SECRET,
    mint: (userId, role) => `minted:${userId}:${role}`,
  });
}

describe("houseBotSession", () => {
  it("mints an ordinary token for a house player", async () => {
    const s = service({ "house-bot-01": { role: "STUDENT", isHouseBot: true } });
    const { token, user } = await s.session("house-bot-01");
    expect(token).toBe("minted:house-bot-01:STUDENT");
    expect(user.id).toBe("house-bot-01");
  });

  it("refuses an account that is not a house player, whatever the secret", async () => {
    const s = service({ "a-student": { role: "STUDENT", isHouseBot: false } });
    await expect(s.session("a-student")).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses an unknown account", async () => {
    const s = service({});
    await expect(s.session("nobody")).rejects.toBeInstanceOf(AuthenticationError);
  });

  it("refuses everything when the secret is unset or wrong", () => {
    const unset = new HouseBotService({} as PrismaClient, {} as ChallengeService, {});
    expect(() => unset.assertSecret(SECRET)).toThrow(AuthenticationError);
    const set = service({});
    expect(() => set.assertSecret("wrong")).toThrow(AuthenticationError);
    expect(() => set.assertSecret(SECRET)).not.toThrow();
  });
});
