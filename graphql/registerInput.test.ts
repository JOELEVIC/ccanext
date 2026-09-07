import { describe, expect, it } from "vitest";
import { userResolvers } from "@/graphql/resolvers/user.resolvers";
import type { GraphQLContextWithServices } from "@/graphql/context";

/**
 * What `register` hands the service, which is where two silent losses lived.
 *
 * The mutation is the seam between an SDL that has always been permissive
 * about names and a service that writes exactly what it is given. Nothing here
 * throws when it goes wrong: a dropped name is not a GraphQL error, it is a
 * blank cell on a patron's roster weeks later, and by then nobody can say
 * which of a hundred signups lost it.
 */

const CREDENTIALS = {
  email: "brenda@school.cm",
  password: "a good long password",
  role: "STUDENT",
};

/**
 * Run the real resolver against a service that records its argument and does
 * nothing else. The assertion is on the DTO, because the DTO is the contract:
 * everything downstream of it is tested in `domains/user/accountIdentity.test.ts`.
 */
async function register(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const seen: Record<string, unknown>[] = [];
  const context = {
    services: {
      userService: {
        createUser: async (dto: Record<string, unknown>) => {
          seen.push(dto);
          return {
            token: "signed",
            user: {
              id: "u1",
              email: "brenda@school.cm",
              username: "brenda_ateba",
              role: "STUDENT",
              rating: 100,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          };
        },
      },
    },
  } as unknown as GraphQLContextWithServices;

  // `register` is unauthenticated, so there is no parent object to pass.
  await userResolvers.Mutation.register(undefined, { input }, context);
  return seen[0] as Record<string, unknown>;
}

describe("the name on a registration", () => {
  it("survives when only one half of it was sent", async () => {
    // This was `input.firstName && input.lastName`. A person who filled the
    // first box and skipped the second — or who has one legal name — had the
    // name they typed thrown away, and the account was created with NO Profile
    // row at all. Before `updateProfile` became an upsert that was permanent:
    // there was no route in the product to ever supply it again.
    const dto = await register({ ...CREDENTIALS, firstName: "Brenda" });
    expect(dto).toMatchObject({ profile: { firstName: "Brenda", lastName: "" } });
  });

  it("survives when only the surname was sent", async () => {
    const dto = await register({ ...CREDENTIALS, lastName: "Ateba" });
    expect(dto).toMatchObject({ profile: { firstName: "", lastName: "Ateba" } });
  });

  it("creates no profile at all when neither half is real", async () => {
    // A row of two empty strings is worse than no row: it looks like an answer.
    // Whitespace counts as absent — a form that sends " " has sent nothing.
    for (const names of [
      {},
      { firstName: "" },
      { firstName: "   ", lastName: "\t" },
      { firstName: null, lastName: undefined },
    ]) {
      const dto = await register({ ...CREDENTIALS, ...names });
      expect(dto.profile).toBeUndefined();
    }
  });

  it("trims what it stores", async () => {
    const dto = await register({ ...CREDENTIALS, firstName: "  Brenda ", lastName: " Ateba  " });
    expect(dto).toMatchObject({ profile: { firstName: "Brenda", lastName: "Ateba" } });
  });
});

describe("the username on a registration", () => {
  it("reaches the service as undefined when the app does not send one", async () => {
    // Not the string "undefined", and not "". The service branches on whether
    // this is empty to decide between validating a chosen handle and deriving
    // a free one, so the shape of "absent" matters.
    const dto = await register({ ...CREDENTIALS });
    expect(dto.username).toBeUndefined();
  });

  it("is passed straight through when a client still sends one", async () => {
    // ccaweb, ccaui and every installed APK do.
    const dto = await register({ ...CREDENTIALS, username: "brenda_a" });
    expect(dto.username).toBe("brenda_a");
  });

  it("carries the join code through untouched, club or no club", async () => {
    // Nothing in this change made a club mandatory or optional — it was always
    // optional on this endpoint. Asserted so a later edit to the two lines
    // above cannot quietly drop it.
    const dto = await register({ ...CREDENTIALS, joinCode: "BOTA24" });
    expect(dto.joinCode).toBe("BOTA24");
  });
});
