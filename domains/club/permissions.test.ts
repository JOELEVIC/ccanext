import { describe, expect, it } from "vitest";

import {
  can,
  canValidateFixture,
  wouldOrphanClub,
  type ClubAction,
  type MembershipRoleValue,
} from "./permissions";

const active = (role: MembershipRoleValue) => ({ role, status: "ACTIVE" as const });

const EVERY_ACTION: ClubAction[] = [
  "club:manage",
  "member:admit",
  "member:setRole",
  "member:remove",
  "session:manage",
  "attendance:mark",
  "teamSheet:submit",
  "result:record",
];

describe("can", () => {
  it("gives a patron every club action", () => {
    for (const action of EVERY_ACTION) {
      expect(can(active("PATRON"), action)).toBe(true);
    }
  });

  it("gives a player none of them", () => {
    for (const action of EVERY_ACTION) {
      expect(can(active("PLAYER"), action)).toBe(false);
    }
  });

  it("lets a captain run the match day and nothing else", () => {
    expect(can(active("CAPTAIN"), "teamSheet:submit")).toBe(true);
    expect(can(active("CAPTAIN"), "result:record")).toBe(true);

    // A captain is not a junior patron: no membership changes, no sessions,
    // and no sight of the console (which carries the join code).
    expect(can(active("CAPTAIN"), "club:manage")).toBe(false);
    expect(can(active("CAPTAIN"), "member:admit")).toBe(false);
    expect(can(active("CAPTAIN"), "member:remove")).toBe(false);
    expect(can(active("CAPTAIN"), "session:manage")).toBe(false);
  });

  it("lets an assistant coach admit but not set roles or remove", () => {
    expect(can(active("ASSISTANT_COACH"), "member:admit")).toBe(true);
    expect(can(active("ASSISTANT_COACH"), "member:setRole")).toBe(false);
    expect(can(active("ASSISTANT_COACH"), "member:remove")).toBe(false);
  });

  it("grants nothing on a membership that is not ACTIVE", () => {
    for (const status of ["PENDING", "LEFT", "REMOVED"] as const) {
      // Deliberately the most senior role: status gates before role is read.
      expect(can({ role: "PATRON", status }, "member:admit")).toBe(false);
      expect(can({ role: "PATRON", status }, "club:manage")).toBe(false);
    }
  });

  it("grants nothing when there is no membership at all", () => {
    expect(can(null, "result:record")).toBe(false);
    expect(can(undefined, "club:manage")).toBe(false);
  });
});

describe("canValidateFixture", () => {
  const base = { userId: "u1", platformRole: "STUDENT", fixtureArbiterId: null };

  it("admits the fixture's appointed arbiter", () => {
    expect(canValidateFixture({ ...base, fixtureArbiterId: "u1" })).toBe(true);
  });

  it("refuses an arbiter appointed to a different fixture", () => {
    expect(canValidateFixture({ ...base, fixtureArbiterId: "someone-else" })).toBe(false);
  });

  it("admits national and regional admins", () => {
    expect(canValidateFixture({ ...base, platformRole: "NATIONAL_ADMIN" })).toBe(true);
    expect(canValidateFixture({ ...base, platformRole: "REGIONAL_ADMIN" })).toBe(true);
  });

  it("refuses a school admin and a coach", () => {
    // The integrity boundary: senior-sounding platform roles that belong to
    // the school rather than to the academy do not get to freeze a result.
    expect(canValidateFixture({ ...base, platformRole: "SCHOOL_ADMIN" })).toBe(false);
    expect(canValidateFixture({ ...base, platformRole: "COACH" })).toBe(false);
  });

  it("refuses a fixture with no arbiter appointed", () => {
    // It falls to the academy, not to the clubs.
    expect(canValidateFixture(base)).toBe(false);
  });
});

describe("wouldOrphanClub", () => {
  it("refuses to demote the last patron", () => {
    expect(
      wouldOrphanClub({
        targetIsSelf: true,
        targetCurrentRole: "PATRON",
        nextRole: "PLAYER",
        activePatronCount: 1,
      })
    ).toBe(true);
  });

  it("allows demoting a patron while another remains", () => {
    expect(
      wouldOrphanClub({
        targetIsSelf: false,
        targetCurrentRole: "PATRON",
        nextRole: "ASSISTANT_COACH",
        activePatronCount: 2,
      })
    ).toBe(false);
  });

  it("allows promoting somebody to patron", () => {
    expect(
      wouldOrphanClub({
        targetIsSelf: false,
        targetCurrentRole: "ASSISTANT_COACH",
        nextRole: "PATRON",
        activePatronCount: 1,
      })
    ).toBe(false);
  });

  it("is not tripped by a patron keeping their role", () => {
    expect(
      wouldOrphanClub({
        targetIsSelf: true,
        targetCurrentRole: "PATRON",
        nextRole: "PATRON",
        activePatronCount: 1,
      })
    ).toBe(false);
  });
});
