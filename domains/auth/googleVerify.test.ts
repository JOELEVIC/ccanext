import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_AUDIENCE_ALLOW_LIST,
  GOOGLE_CLIENT_ID,
  parseAudienceAllowList,
  verifyGoogleIdToken,
} from "./googleVerify";

/**
 * The audience check, which is the load-bearing line of the whole Google path.
 *
 * `loginWithGoogle` finds-or-creates a CCA account from whatever email address
 * comes out of this function, with no password and no further proof. So every
 * question about who may sign in as whom reduces to: which tokens does this
 * accept? Google's tokeninfo endpoint answers "was this signed by Google and is
 * it still valid" — it does NOT answer "was this meant for us". `aud` is that
 * answer, and it is the only one.
 *
 * Which makes the failure mode specific and quiet: a check that is too loose
 * does not error, does not log, and does not look different from a working
 * sign-in. It just means somebody who walked a user through an unrelated app's
 * Google consent screen is holding a token this server treats as identity.
 *
 * There was no test over any of this before. These are written to fail closed:
 * every case that is not an exact match of an id we listed must return null.
 */

// A believable second client in the SAME project — this is the iOS client that
// M4 exists to admit, and the reason a single hardcoded id was not enough.
const IOS_CLIENT_ID = "649457496601-9k2q4v0m1abcdefghijklmnopqrstuv.apps.googleusercontent.com";
// Same shape, DIFFERENT project number. This is the dangerous neighbour: it
// ends in the same suffix and looks entirely legitimate.
const OTHER_PROJECT_ID = "111122223333-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz.apps.googleusercontent.com";

const ALLOW = new Set([GOOGLE_CLIENT_ID, IOS_CLIENT_ID]);

/** A tokeninfo response with everything valid except what a test overrides. */
function tokeninfo(overrides: Record<string, unknown> = {}) {
  return {
    iss: "https://accounts.google.com",
    aud: GOOGLE_CLIENT_ID,
    email: "brenda@school.cm",
    email_verified: "true",
    name: "Brenda Ateba",
    ...overrides,
  };
}

/** Stub the one network call this module makes. */
function respondWith(body: Record<string, unknown>, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, json: async () => body })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the allow-list built from GOOGLE_CLIENT_IDS", () => {
  it("falls back to the shipped web client when the variable is not set", () => {
    // The deploy this ships onto has no GOOGLE_CLIENT_IDS. If an unset variable
    // meant an empty list, every Google sign-in in the field would break the
    // moment this deploys, and the only symptom would be a generic failure
    // message on a phone in Cameroon.
    expect([...parseAudienceAllowList(undefined)]).toEqual([GOOGLE_CLIENT_ID]);
    expect([...parseAudienceAllowList("")]).toEqual([GOOGLE_CLIENT_ID]);
    expect([...parseAudienceAllowList("   ")]).toEqual([GOOGLE_CLIENT_ID]);
    expect([...parseAudienceAllowList("\t\n  ")]).toEqual([GOOGLE_CLIENT_ID]);
  });

  it("never puts an empty entry in the list, however the variable is punctuated", () => {
    // A single stray comma is all it takes. An "" in the set matches a token
    // whose `aud` is the empty string — which is exactly the shape a hand-rolled
    // or malformed token has — so this is the difference between a typo in an
    // env var and an open door.
    for (const raw of [",", ",,", " , , ", `${IOS_CLIENT_ID},`, `,${IOS_CLIENT_ID}`, `a,,b`]) {
      expect(parseAudienceAllowList(raw).has("")).toBe(false);
      expect(parseAudienceAllowList(raw).has(" ")).toBe(false);
    }
  });

  it("trims each entry, because a comma-separated list is typed by a human", () => {
    const list = parseAudienceAllowList(`  ${GOOGLE_CLIENT_ID} ,\n ${IOS_CLIENT_ID}  `);
    expect(list.has(GOOGLE_CLIENT_ID)).toBe(true);
    expect(list.has(IOS_CLIENT_ID)).toBe(true);
    expect(list.size).toBe(2);
  });

  it("stops falling back the moment the variable names anything at all", () => {
    // Setting the variable REPLACES the default rather than adding to it, so a
    // deployment that lists only the iOS client stops accepting Android. That is
    // the intended reading of an allow-list and it is the trap in configuring
    // one: whoever sets this must list every platform, not the new one.
    const list = parseAudienceAllowList(IOS_CLIENT_ID);
    expect(list.has(IOS_CLIENT_ID)).toBe(true);
    expect(list.has(GOOGLE_CLIENT_ID)).toBe(false);
  });

  it("is what the module actually verifies against", () => {
    // Pins the wiring, not the value: the exported set must be the parse of the
    // environment, so a future refactor cannot leave the env var declared,
    // documented and quietly unread.
    expect([...GOOGLE_AUDIENCE_ALLOW_LIST]).toEqual([
      ...parseAudienceAllowList(process.env.GOOGLE_CLIENT_IDS),
    ]);
    expect(GOOGLE_AUDIENCE_ALLOW_LIST.size).toBeGreaterThan(0);
  });
});

describe("audience matching is exact", () => {
  it("accepts a token minted for a client we listed", async () => {
    respondWith(tokeninfo({ aud: IOS_CLIENT_ID }));
    // The iOS client, which is the entire point of M4: iOS mints against its
    // own client id, so before the list existed iOS could not sign in at all.
    await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toEqual({
      email: "brenda@school.cm",
      name: "Brenda Ateba",
    });
  });

  it("refuses a mistyped id", async () => {
    // One character. A typo in an env var must fail closed and visibly, not
    // widen anything.
    respondWith(tokeninfo({ aud: GOOGLE_CLIENT_ID.replace("649457496601", "649457496602") }));
    await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toBeNull();
  });

  it("refuses a well-formed id from another Google Cloud project", async () => {
    // The one that matters. This id is real-looking, correctly signed by Google
    // and completely valid — for somebody else's app. Accepting it means anyone
    // who can get a person through THAT app's consent screen holds a token this
    // server calls identity.
    respondWith(tokeninfo({ aud: OTHER_PROJECT_ID }));
    await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toBeNull();
  });

  it("refuses anything that merely contains, prefixes or suffixes a listed id", async () => {
    // Every Google client id ends `.apps.googleusercontent.com` and starts with
    // a public project number, so `endsWith` would accept every Google client on
    // earth and `startsWith` every client in our own project — including ones
    // created later for something entirely different.
    const nearMisses = [
      `${GOOGLE_CLIENT_ID}x`,
      `x${GOOGLE_CLIENT_ID}`,
      `${GOOGLE_CLIENT_ID} `,
      ` ${GOOGLE_CLIENT_ID}`,
      `${GOOGLE_CLIENT_ID}.evil.com`,
      "649457496601-402n1u69bjcev77ntndni2ms4o22b03k.apps.googleusercontent.com.evil.com",
      GOOGLE_CLIENT_ID.toUpperCase(),
      GOOGLE_CLIENT_ID.slice(0, -1),
    ];
    for (const aud of nearMisses) {
      respondWith(tokeninfo({ aud }));
      await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toBeNull();
    }
  });

  it("refuses an empty, missing or non-string audience", async () => {
    // `aud: ""` against a list built from a stray comma is the concrete way a
    // configuration typo becomes an authentication bypass, so it is asserted
    // against the list that typo would produce as well as against a good one.
    const strayComma = parseAudienceAllowList(`,,${GOOGLE_CLIENT_ID},,`);
    for (const aud of ["", " ", null, undefined, 0, [GOOGLE_CLIENT_ID], { aud: GOOGLE_CLIENT_ID }]) {
      respondWith(tokeninfo({ aud }));
      await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toBeNull();
      await expect(verifyGoogleIdToken("t", strayComma)).resolves.toBeNull();
    }
  });

  it("refuses everything when the list is genuinely empty", async () => {
    // `parseAudienceAllowList` never produces this, but the parameter can be
    // handed one, and the direction of failure has to be closed: no list means
    // no sign-in, never "anything goes".
    respondWith(tokeninfo());
    await expect(verifyGoogleIdToken("t", new Set())).resolves.toBeNull();
  });
});

describe("the issuer", () => {
  it("accepts both spellings Google actually uses", async () => {
    for (const iss of ["accounts.google.com", "https://accounts.google.com"]) {
      respondWith(tokeninfo({ iss }));
      await expect(verifyGoogleIdToken("t", ALLOW)).resolves.not.toBeNull();
    }
  });

  it("refuses a lookalike, a missing issuer and a non-string one", async () => {
    for (const iss of [
      "accounts.google.com.evil.com",
      "https://accounts.google.com.evil.com",
      "https://accounts.google.co",
      "ACCOUNTS.GOOGLE.COM",
      undefined,
      null,
      1,
    ]) {
      respondWith(tokeninfo({ iss }));
      await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toBeNull();
    }
  });
});

describe("the rest of the claim check", () => {
  it("refuses an unverified email address", async () => {
    // An unverified address is a string somebody typed into Google, not proof
    // they hold the mailbox — and `loginWithGoogle` matches CCA accounts BY
    // address, so accepting one would hand over whoever already registered it.
    for (const email_verified of ["false", false, undefined, null, "", "TRUE"]) {
      respondWith(tokeninfo({ email_verified }));
      await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toBeNull();
    }
  });

  it("accepts the boolean form as well as the string form", async () => {
    // tokeninfo has returned both over the years.
    respondWith(tokeninfo({ email_verified: true }));
    await expect(verifyGoogleIdToken("t", ALLOW)).resolves.not.toBeNull();
  });

  it("normalises the address it hands back", async () => {
    // The service matches accounts on this string, so it has to arrive in the
    // one spelling the database stores. See `normaliseEmail`.
    respondWith(tokeninfo({ email: "  Brenda@School.CM  " }));
    await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toEqual({
      email: "brenda@school.cm",
      name: "Brenda Ateba",
    });
  });

  it("refuses a response with no email at all", async () => {
    for (const email of [undefined, null, "", "   ", 42]) {
      respondWith(tokeninfo({ email }));
      await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toBeNull();
    }
  });

  it("refuses a tokeninfo error body, a non-200 and a dead network", async () => {
    respondWith(tokeninfo({ error: "invalid_token" }));
    await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toBeNull();

    respondWith(tokeninfo(), false);
    await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toBeNull();

    // A school connection drops mid-request far more often than a token is
    // forged. It must read as "not signed in", never as "signed in".
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ENOTFOUND");
      }),
    );
    await expect(verifyGoogleIdToken("t", ALLOW)).resolves.toBeNull();
  });

  it("does not call the network at all for an absent token", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await expect(verifyGoogleIdToken("", ALLOW)).resolves.toBeNull();
    await expect(verifyGoogleIdToken(undefined as unknown as string, ALLOW)).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
