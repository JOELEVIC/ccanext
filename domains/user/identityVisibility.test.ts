import { describe, it, expect } from "vitest";
import {
  isPrivilegedViewer,
  isSelfDisclosed,
  markSelfDisclosed,
  mayRevealIdentity,
  visibleAvatarUrl,
  visibleDateOfBirth,
  visibleEmail,
  visibleFirstName,
  visibleLastName,
  type IdentitySubject,
  type Viewer,
} from "./identityVisibility";
import { createConsentLoader, IdentityGate, type ConsentInputs } from "./identityGate";

/**
 * These guards are what stands between an anonymous HTTP request and 28
 * children's names, emails and photographs. The tests below are written the way
 * the leak was found: ask as nobody, and check what comes back.
 */

const NOW = new Date("2026-08-22T00:00:00Z");
const ADULT_DOB = new Date("1990-01-01T00:00:00Z");
const MINOR_DOB = new Date("2014-01-01T00:00:00Z");

const ANON: Viewer = {};
const STAFF: Viewer = { isStaff: true };
const SELF: Viewer = { userId: "u1" };
const OTHER_PLAYER: Viewer = { userId: "u2" };

function subject(over: Partial<IdentitySubject> = {}): IdentitySubject {
  return {
    userId: "u1",
    publicNameMode: "INITIAL",
    guardianConsent: null,
    ...over,
    profile: {
      firstName: "Brenda",
      lastName: "Ateba",
      dateOfBirth: MINOR_DOB,
      avatarUrl: "https://cdn.example/brenda.jpg",
      ...(over.profile ?? {}),
    },
  };
}

// ── Who counts as privileged ──────────────────────────────────────────────────

describe("isPrivilegedViewer", () => {
  it("is false for an anonymous caller", () => {
    expect(isPrivilegedViewer(ANON, "u1")).toBe(false);
    expect(isPrivilegedViewer(undefined, "u1")).toBe(false);
    expect(isPrivilegedViewer(null, "u1")).toBe(false);
  });

  it("is true for the subject themselves", () => {
    expect(isPrivilegedViewer(SELF, "u1")).toBe(true);
  });

  it("is false for a DIFFERENT logged-in player", () => {
    expect(isPrivilegedViewer(OTHER_PLAYER, "u1")).toBe(false);
  });

  it("is true for staff, for anyone", () => {
    expect(isPrivilegedViewer(STAFF, "u1")).toBe(true);
    expect(isPrivilegedViewer(STAFF, "someone-else")).toBe(true);
  });

  it("never matches two missing ids against each other", () => {
    // The failure mode this guards: `undefined === undefined` making every
    // anonymous caller "self" for every profile with no userId.
    expect(isPrivilegedViewer({ userId: null }, null)).toBe(false);
    expect(isPrivilegedViewer({ userId: undefined }, undefined)).toBe(false);
    expect(isPrivilegedViewer({ userId: "" }, "")).toBe(false);
  });
});

// ── email ─────────────────────────────────────────────────────────────────────

describe("visibleEmail", () => {
  it("is null for an anonymous caller — the leak that started this", () => {
    expect(visibleEmail(ANON, "u1", "brenda@example.cm")).toBeNull();
  });

  it("is null for another logged-in player", () => {
    expect(visibleEmail(OTHER_PLAYER, "u1", "brenda@example.cm")).toBeNull();
  });

  it("is returned to the account owner", () => {
    expect(visibleEmail(SELF, "u1", "brenda@example.cm")).toBe("brenda@example.cm");
  });

  it("is returned to staff", () => {
    expect(visibleEmail(STAFF, "u1", "brenda@example.cm")).toBe("brenda@example.cm");
  });

  it("has no consent branch — an ADULT's email is public-invisible too", () => {
    // Consent gates DISPLAY. An email is not a display, so being 40 years old
    // does not make yours public.
    expect(visibleEmail(ANON, "u9", "adult@example.cm")).toBeNull();
  });
});

// ── dateOfBirth ───────────────────────────────────────────────────────────────

describe("visibleDateOfBirth", () => {
  it("is null for an anonymous caller", () => {
    expect(visibleDateOfBirth(ANON, "u1", MINOR_DOB)).toBeNull();
  });

  it("is null for another logged-in player", () => {
    expect(visibleDateOfBirth(OTHER_PLAYER, "u1", MINOR_DOB)).toBeNull();
  });

  it("is returned to self and staff", () => {
    expect(visibleDateOfBirth(SELF, "u1", MINOR_DOB)).toBe(MINOR_DOB);
    expect(visibleDateOfBirth(STAFF, "u1", MINOR_DOB)).toBe(MINOR_DOB);
  });
});

// ── the §4.3 name rules ───────────────────────────────────────────────────────

describe("visibleLastName — BUILD_PLAN §4.3", () => {
  it("reduces to the initial for a minor with no consent row", () => {
    expect(visibleLastName(ANON, subject({ guardianConsent: null }), { now: NOW })).toBe("A.");
  });

  it("reduces to the initial for PENDING, DECLINED and WITHDRAWN", () => {
    for (const status of ["PENDING", "DECLINED", "WITHDRAWN"] as const) {
      expect(
        visibleLastName(ANON, subject({ guardianConsent: { status } }), { now: NOW }),
      ).toBe("A.");
    }
  });

  it("reduces to the initial for GRANTED + INITIAL", () => {
    expect(
      visibleLastName(
        ANON,
        subject({ guardianConsent: { status: "GRANTED" }, publicNameMode: "INITIAL" }),
        { now: NOW },
      ),
    ).toBe("A.");
  });

  it("shows the surname in full for GRANTED + FULL", () => {
    expect(
      visibleLastName(
        ANON,
        subject({ guardianConsent: { status: "GRANTED" }, publicNameMode: "FULL" }),
        { now: NOW },
      ),
    ).toBe("Ateba");
  });

  it("shows the surname in full for an adult, whatever the mode says", () => {
    expect(
      visibleLastName(ANON, subject({ profile: { dateOfBirth: ADULT_DOB } }), { now: NOW }),
    ).toBe("Ateba");
  });

  it("REDUCES when there is no date of birth — unknown age is a minor", () => {
    // Every one of the 28 production accounts is in this row today.
    expect(
      visibleLastName(ANON, subject({ profile: { dateOfBirth: null } }), { now: NOW }),
    ).toBe("A.");
  });

  it("REDUCES when there is no profile at all", () => {
    expect(
      visibleLastName(ANON, { userId: "u1", profile: null }, { now: NOW }),
    ).toBe("");
  });

  it("ignores a stale FULL mode when consent is not GRANTED", () => {
    expect(
      visibleLastName(
        ANON,
        subject({ publicNameMode: "FULL", guardianConsent: { status: "WITHDRAWN" } }),
        { now: NOW },
      ),
    ).toBe("A.");
  });

  it("gives the full surname to self and to staff, consent notwithstanding", () => {
    expect(visibleLastName(SELF, subject(), { now: NOW })).toBe("Ateba");
    expect(visibleLastName(STAFF, subject(), { now: NOW })).toBe("Ateba");
  });

  it("keeps another logged-in player on the public rule", () => {
    expect(visibleLastName(OTHER_PLAYER, subject(), { now: NOW })).toBe("A.");
  });

  it("returns a string, never null — lastName is String! in the SDL", () => {
    expect(visibleLastName(ANON, { userId: "u1" }, { now: NOW })).toBe("");
  });
});

describe("visibleFirstName", () => {
  it("stays whole for a non-consented minor, so the pair renders 'Brenda A.'", () => {
    const s = subject();
    const rendered = `${visibleFirstName(ANON, s)} ${visibleLastName(ANON, s, { now: NOW })}`;
    expect(rendered).toBe("Brenda A.");
  });
});

describe("visibleAvatarUrl", () => {
  it("is null for a non-consented minor — the photograph travels with the name", () => {
    expect(visibleAvatarUrl(ANON, subject(), { now: NOW })).toBeNull();
  });

  it("is shown for an adult, and to self and staff", () => {
    expect(
      visibleAvatarUrl(ANON, subject({ profile: { dateOfBirth: ADULT_DOB } }), { now: NOW }),
    ).toBe("https://cdn.example/brenda.jpg");
    expect(visibleAvatarUrl(SELF, subject(), { now: NOW })).toBe("https://cdn.example/brenda.jpg");
    expect(visibleAvatarUrl(STAFF, subject(), { now: NOW })).toBe("https://cdn.example/brenda.jpg");
  });
});

describe("mayRevealIdentity", () => {
  it("agrees with the §4.3 table for an anonymous caller", () => {
    expect(mayRevealIdentity(ANON, subject(), { now: NOW })).toBe(false);
    expect(
      mayRevealIdentity(ANON, subject({ profile: { dateOfBirth: ADULT_DOB } }), { now: NOW }),
    ).toBe(true);
  });
});

// ── self-disclosure (login / register) ────────────────────────────────────────

describe("markSelfDisclosed", () => {
  it("marks an object without adding an enumerable, serialisable field", () => {
    const user = { id: "u1", email: "brenda@example.cm" };
    markSelfDisclosed(user);
    expect(isSelfDisclosed(user)).toBe(true);
    expect(Object.keys(user)).toEqual(["id", "email"]);
    expect(JSON.stringify(user)).toBe('{"id":"u1","email":"brenda@example.cm"}');
  });

  it("does not consider an unmarked object, or a spread copy of one, self-disclosed", () => {
    const user = markSelfDisclosed({ id: "u1", email: "brenda@example.cm" });
    expect(isSelfDisclosed({ ...user })).toBe(false);
    expect(isSelfDisclosed({ id: "u1" })).toBe(false);
    expect(isSelfDisclosed(null)).toBe(false);
    expect(isSelfDisclosed("cca.identity.selfDisclosed")).toBe(false);
  });
});

// ── the batching loader ───────────────────────────────────────────────────────

function inputs(over: Partial<ConsentInputs> & { userId: string }): ConsentInputs {
  return { publicNameMode: null, dateOfBirth: null, consentStatus: null, ...over };
}

describe("createConsentLoader", () => {
  it("coalesces every id asked for in the same tick into ONE read", async () => {
    const calls: string[][] = [];
    const load = createConsentLoader(async (ids) => {
      calls.push(ids);
      return ids.map((id) => inputs({ userId: id }));
    });

    const rows = await Promise.all(["a", "b", "c", "a"].map((id) => load(id)));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(["a", "b", "c"]); // "a" deduped by the cache
    expect(rows.map((r) => r?.userId)).toEqual(["a", "b", "c", "a"]);
  });

  it("returns null for an id the reader does not know", async () => {
    const load = createConsentLoader(async () => []);
    expect(await load("ghost")).toBeNull();
  });

  it("fails CLOSED when the read throws — null, not a rejected promise", async () => {
    const load = createConsentLoader(async () => {
      throw new Error("column users.publicNameMode does not exist");
    });
    await expect(load("a")).resolves.toBeNull();
  });
});

describe("IdentityGate", () => {
  const reader = async (ids: string[]): Promise<ConsentInputs[]> =>
    ids.map((id) =>
      inputs({
        userId: id,
        dateOfBirth: id === "adult" ? ADULT_DOB : MINOR_DOB,
        consentStatus: id === "granted" ? "GRANTED" : "PENDING",
        publicNameMode: id === "granted" ? "FULL" : "INITIAL",
      }),
    );

  const profile = (userId: string) => ({
    userId,
    firstName: "Brenda",
    lastName: "Ateba",
    avatarUrl: "https://cdn.example/brenda.jpg",
    dateOfBirth: MINOR_DOB,
  });

  it("redacts for an anonymous caller", async () => {
    const gate = new IdentityGate(ANON, reader, { now: NOW });
    expect(gate.email({ id: "u1", email: "brenda@example.cm" })).toBeNull();
    expect(gate.dateOfBirth(profile("u1"))).toBeNull();
    expect(await gate.lastName(profile("u1"))).toBe("A.");
    expect(await gate.avatarUrl(profile("u1"))).toBeNull();
    expect(gate.firstName(profile("u1"))).toBe("Brenda");
  });

  it("applies §4.3 per person, from the loaded row", async () => {
    const gate = new IdentityGate(ANON, reader, { now: NOW });
    expect(await gate.lastName(profile("adult"))).toBe("Ateba");
    expect(await gate.lastName(profile("granted"))).toBe("Ateba");
    expect(await gate.lastName(profile("minor"))).toBe("A.");
  });

  it("trusts the LOADED date of birth over a parent row that omitted it", async () => {
    // A resolver whose parent was selected without `dateOfBirth` must not wrongly
    // reduce an adult, nor wrongly reveal a minor.
    const gate = new IdentityGate(ANON, reader, { now: NOW });
    const partial = { userId: "adult", firstName: "Brenda", lastName: "Ateba" };
    expect(await gate.lastName(partial)).toBe("Ateba");
  });

  it("gives self and staff everything, without consulting consent at all", async () => {
    let reads = 0;
    const counting = async (ids: string[]) => {
      reads += 1;
      return reader(ids);
    };
    const selfGate = new IdentityGate({ userId: "u1" }, counting, { now: NOW });
    expect(selfGate.email({ id: "u1", email: "brenda@example.cm" })).toBe("brenda@example.cm");
    expect(selfGate.dateOfBirth(profile("u1"))).toBe(MINOR_DOB);
    expect(await selfGate.lastName(profile("u1"))).toBe("Ateba");
    expect(await selfGate.avatarUrl(profile("u1"))).toBe("https://cdn.example/brenda.jpg");

    const staffGate = new IdentityGate(STAFF, counting, { now: NOW });
    expect(staffGate.email({ id: "u1", email: "brenda@example.cm" })).toBe("brenda@example.cm");
    expect(await staffGate.lastName(profile("u1"))).toBe("Ateba");

    expect(reads).toBe(0);
  });

  it("answers a login payload's own email even with no token on the request", async () => {
    const gate = new IdentityGate(ANON, reader, { now: NOW });
    const payloadUser = markSelfDisclosed({ id: "u1", email: "brenda@example.cm" });
    expect(gate.email(payloadUser)).toBe("brenda@example.cm");
  });

  it("redacts everything when the consent read is completely broken", async () => {
    const broken = async (): Promise<ConsentInputs[]> => {
      throw new Error("database unreachable");
    };
    const gate = new IdentityGate(ANON, broken, { now: NOW });
    expect(await gate.lastName(profile("adult"))).toBe("A.");
    expect(await gate.avatarUrl(profile("adult"))).toBeNull();
  });
});
