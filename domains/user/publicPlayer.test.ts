import { describe, it, expect } from "vitest";
import {
  ADULT_AGE,
  ageInYears,
  effectivePublicNameMode,
  isMinor,
  parseCrest,
  publicNameModeOnConsentChange,
  reducedName,
  toPublicPlayer,
  toPublicPlayers,
  type PublicPlayerSource,
} from "./publicPlayer";

/**
 * The consent rule is a SAFETY property, not a feature: the failure mode is a
 * child's full name and photograph on a public web page, and nothing about the
 * response would look wrong. These tests walk every row of the BUILD_PLAN §4.3
 * truth table, in order, plus the ways a caller can get it wrong by omission.
 */

const NOW = new Date("2026-08-21T00:00:00Z");

function player(over: Partial<PublicPlayerSource> = {}): PublicPlayerSource {
  return {
    id: "u1",
    username: "brenda_a",
    rating: 1420,
    publicNameMode: "INITIAL",
    profile: {
      firstName: "Brenda",
      lastName: "Ateba",
      dateOfBirth: new Date("2012-01-01T00:00:00Z"),
      avatarUrl: "https://cdn.example/brenda.jpg",
    },
    guardianConsent: null,
    ...over,
  };
}

describe("age", () => {
  it("counts whole years and treats a birthday later this year as not yet reached", () => {
    expect(ageInYears(new Date("2008-08-20T00:00:00Z"), NOW)).toBe(18);
    expect(ageInYears(new Date("2008-08-22T00:00:00Z"), NOW)).toBe(17);
  });

  it("treats an unusable date of birth as unknown", () => {
    expect(ageInYears(null, NOW)).toBeNull();
    expect(ageInYears(undefined, NOW)).toBeNull();
    expect(ageInYears("not a date", NOW)).toBeNull();
  });

  it("treats unknown age as a minor — the protective default", () => {
    expect(isMinor(null, NOW)).toBe(true);
    expect(isMinor(undefined, NOW)).toBe(true);
    expect(isMinor({ firstName: "A", lastName: "B", dateOfBirth: null }, NOW)).toBe(true);
    expect(isMinor({ dateOfBirth: "rubbish" }, NOW)).toBe(true);
  });

  it("18 is the line", () => {
    expect(ADULT_AGE).toBe(18);
    expect(isMinor({ dateOfBirth: new Date("2008-08-21T00:00:00Z") }, NOW)).toBe(false);
    expect(isMinor({ dateOfBirth: new Date("2008-08-22T00:00:00Z") }, NOW)).toBe(true);
  });
});

describe("the §4.3 truth table, row by row", () => {
  it("row 1 — adult: full name, avatar shown", () => {
    const out = toPublicPlayer(
      player({ profile: { firstName: "Etienne", lastName: "Fotso", dateOfBirth: new Date("2004-03-02T00:00:00Z"), avatarUrl: "a.jpg" } }),
      { now: NOW }
    );
    expect(out.displayName).toBe("Etienne Fotso");
    expect(out.avatarUrl).toBe("a.jpg");
  });

  it("row 1 holds even when the adult's publicNameMode is INITIAL — the mode is a MINOR's control", () => {
    const out = toPublicPlayer(
      player({
        publicNameMode: "INITIAL",
        profile: { firstName: "Etienne", lastName: "Fotso", dateOfBirth: new Date("2000-01-01T00:00:00Z"), avatarUrl: "a.jpg" },
      }),
      { now: NOW }
    );
    expect(out.displayName).toBe("Etienne Fotso");
  });

  it("row 2 — minor, consent GRANTED, mode FULL: full name, avatar shown", () => {
    const out = toPublicPlayer(
      player({ publicNameMode: "FULL", guardianConsent: { status: "GRANTED" } }),
      { now: NOW }
    );
    expect(out.displayName).toBe("Brenda Ateba");
    expect(out.avatarUrl).toBe("https://cdn.example/brenda.jpg");
  });

  it("row 3 — minor, consent GRANTED, mode INITIAL: reduced, avatar hidden", () => {
    const out = toPublicPlayer(
      player({ publicNameMode: "INITIAL", guardianConsent: { status: "GRANTED" } }),
      { now: NOW }
    );
    expect(out.displayName).toBe("Brenda A.");
    expect(out.avatarUrl).toBeNull();
  });

  it("row 4 — minor with PENDING / DECLINED / WITHDRAWN / no row: reduced, avatar hidden", () => {
    for (const status of ["PENDING", "DECLINED", "WITHDRAWN"] as const) {
      const out = toPublicPlayer(
        player({ publicNameMode: "FULL", guardianConsent: { status } }),
        { now: NOW }
      );
      expect(out.displayName, status).toBe("Brenda A.");
      expect(out.avatarUrl, status).toBeNull();
    }
    const noRow = toPublicPlayer(player({ publicNameMode: "FULL", guardianConsent: null }), { now: NOW });
    expect(noRow.displayName).toBe("Brenda A.");
    expect(noRow.avatarUrl).toBeNull();
  });

  it("row 5 — no Profile at all: reduced, avatar hidden, even with consent GRANTED and mode FULL", () => {
    const out = toPublicPlayer(
      player({ profile: null, publicNameMode: "FULL", guardianConsent: { status: "GRANTED" } }),
      { now: NOW }
    );
    expect(out.displayName).toBe("brenda_a");
    expect(out.avatarUrl).toBeNull();
  });

  it("row 5 — a Profile with no dateOfBirth is unknown age, therefore a minor", () => {
    const out = toPublicPlayer(
      player({
        profile: { firstName: "Brenda", lastName: "Ateba", dateOfBirth: null, avatarUrl: "b.jpg" },
        publicNameMode: "FULL",
        guardianConsent: { status: "GRANTED" },
      }),
      { now: NOW }
    );
    expect(out.displayName).toBe("Brenda Ateba");
    expect(out.avatarUrl).toBe("b.jpg");
  });
});

describe("withdrawing consent forces the mode back to INITIAL", () => {
  it("on read: a stale FULL beside a WITHDRAWN consent still reduces", () => {
    expect(effectivePublicNameMode("FULL", { status: "WITHDRAWN" })).toBe("INITIAL");
    expect(effectivePublicNameMode("FULL", { status: "GRANTED" })).toBe("FULL");
    expect(effectivePublicNameMode("FULL", null)).toBe("INITIAL");
    expect(effectivePublicNameMode("INITIAL", { status: "GRANTED" })).toBe("INITIAL");
  });

  it("on write: the mode a consent change must produce", () => {
    expect(publicNameModeOnConsentChange("GRANTED", "FULL")).toBe("FULL");
    expect(publicNameModeOnConsentChange("GRANTED", "INITIAL")).toBe("INITIAL");
    expect(publicNameModeOnConsentChange("WITHDRAWN", "FULL")).toBe("INITIAL");
    expect(publicNameModeOnConsentChange("DECLINED", "FULL")).toBe("INITIAL");
    expect(publicNameModeOnConsentChange("PENDING", "FULL")).toBe("INITIAL");
    expect(publicNameModeOnConsentChange(null, "FULL")).toBe("INITIAL");
  });
});

describe("the reduced form", () => {
  it("is first name plus last initial and a full stop", () => {
    expect(reducedName({ firstName: "Brenda", lastName: "Ateba" })).toBe("Brenda A.");
  });

  it("keeps accents intact and upper-cases the initial", () => {
    expect(reducedName({ firstName: "Nadege", lastName: "efon" })).toBe("Nadege E.");
    expect(reducedName({ firstName: "Etienne", lastName: "éffo" })).toBe("Etienne É.");
  });

  it("falls back to the first name alone, then to the username, then to a placeholder", () => {
    expect(reducedName({ firstName: "Brenda", lastName: "  " }, "handle")).toBe("Brenda");
    expect(reducedName(null, "handle")).toBe("handle");
    expect(reducedName(null, null)).toBe("Player");
  });
});

describe("a caller who forgets an include degrades to the protective branch", () => {
  it("no profile and no consent given: reduced", () => {
    const out = toPublicPlayer({ id: "u9", username: "someone", rating: 1200 }, { now: NOW });
    expect(out.displayName).toBe("someone");
    expect(out.avatarUrl).toBeNull();
  });

  it("never emits a date of birth or any field beyond the PublicPlayer shape", () => {
    const out = toPublicPlayer(player(), { now: NOW });
    expect(Object.keys(out).sort()).toEqual(
      [
        "avatarUrl",
        "boardOrder",
        "clubName",
        "clubShortName",
        "clubSlug",
        "crest",
        "displayName",
        "id",
        "rating",
        "schoolYear",
      ].sort()
    );
  });
});

describe("club attachment", () => {
  const club = { slug: "gbhs-limbe", name: "GBHS Limbe Chess Club", shortName: "GL", crestJson: { shield: "#0B4A32", band: "#D4A72C", charge: "knight" } };

  it("uses an explicit membership over the memberships array", () => {
    const out = toPublicPlayer(
      player({
        membership: { schoolYear: "Form 4", boardOrder: 2, club },
        memberships: [{ schoolYear: "Wrong", boardOrder: 9, club: { slug: "other", name: "Other", shortName: "OT" } }],
      }),
      { now: NOW }
    );
    expect(out.clubSlug).toBe("gbhs-limbe");
    expect(out.schoolYear).toBe("Form 4");
    expect(out.boardOrder).toBe(2);
    expect(out.crest).toEqual({ shield: "#0B4A32", band: "#D4A72C", charge: "knight" });
  });

  it("is all null for a player with no active membership", () => {
    const out = toPublicPlayer(player({ memberships: [] }), { now: NOW });
    expect(out.clubSlug).toBeNull();
    expect(out.clubName).toBeNull();
    expect(out.crest).toBeNull();
    expect(out.boardOrder).toBeNull();
  });

  it("rejects a half-written crest so the client falls back to deriving one", () => {
    expect(parseCrest(null)).toBeNull();
    expect(parseCrest({ shield: "#000", band: "#fff" })).toBeNull();
    expect(parseCrest({ shield: "#000", band: "#fff", charge: "" })).toBeNull();
    expect(parseCrest([1, 2, 3])).toBeNull();
    expect(parseCrest({ shield: "#000", band: "#fff", charge: "rook" })).toEqual({ shield: "#000", band: "#fff", charge: "rook" });
  });
});

describe("ratings", () => {
  it("rounds and defaults to zero rather than emitting null on a non-null field", () => {
    expect(toPublicPlayer(player({ rating: 1420.6 }), { now: NOW }).rating).toBe(1421);
    expect(toPublicPlayer(player({ rating: null }), { now: NOW }).rating).toBe(0);
  });
});

describe("toPublicPlayers", () => {
  it("applies one `now` across a whole page so a list cannot disagree with itself", () => {
    const eighteenToday = { id: "a", username: "a", rating: 1, profile: { firstName: "Ada", lastName: "Bell", dateOfBirth: new Date("2008-08-21T00:00:00Z") } };
    const [out] = toPublicPlayers([eighteenToday], { now: NOW });
    expect(out.displayName).toBe("Ada Bell");
  });
});
