import { describe, expect, it } from "vitest";
import { resolvers } from "@/graphql/resolvers";

/**
 * `Challenge.creatorPlayer` is `PublicPlayer!`. The resolver exists in
 * challenge.resolvers.ts, but a type resolver is only wired when index.ts
 * lists it — the first deploy forgot, every `myChallenges` query carrying the
 * field answered "Unexpected error.", and the app's invite looked broken while
 * the challenge had in fact been created. This pins both halves: the field is
 * registered, and it resolves through the consent reducer by the creator's id.
 */
describe("Challenge.creatorPlayer / opponentPlayer", () => {
  const seen: string[] = [];
  const context = {
    services: {
      userService: {
        getPublicPlayer: async (id: string) => {
          seen.push(id);
          return { id, displayName: "Brenda A.", rating: 1204 };
        },
      },
    },
  } as never;

  it("is registered on the schema's resolver map", () => {
    const type = (resolvers as Record<string, unknown>).Challenge as Record<string, unknown>;
    expect(typeof type.creatorPlayer).toBe("function");
    expect(typeof type.opponentPlayer).toBe("function");
  });

  it("looks the creator up by id, and the opponent only when there is one", async () => {
    const type = (resolvers as { Challenge: Record<string, (...a: unknown[]) => Promise<unknown>> }).Challenge;
    await expect(type.creatorPlayer({ creatorId: "u-creator" }, {}, context)).resolves.toMatchObject({
      id: "u-creator",
      displayName: "Brenda A.",
    });
    await expect(type.opponentPlayer({ opponentId: null }, {}, context)).resolves.toBeNull();
    await expect(type.opponentPlayer({ opponentId: "u-opp" }, {}, context)).resolves.toMatchObject({
      id: "u-opp",
    });
    expect(seen).toEqual(["u-creator", "u-opp"]);
  });
});
