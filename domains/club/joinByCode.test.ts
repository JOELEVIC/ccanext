import { describe, expect, it } from "vitest";
import { decideJoin, type HeldMembership } from "./joinByCode";

/**
 * The branch order matters more than any single branch, because the two halves
 * pull against each other: "you already hold this" has to beat "something else
 * blocks you", or a student with a stale row somewhere is refused entry to the
 * club they are already a member of.
 */

const held = (
  clubId: string,
  status: HeldMembership["status"],
  clubName = clubId.toUpperCase(),
): HeldMembership => ({ clubId, status, clubName });

describe("entering a code for a club you hold nothing at", () => {
  it("creates the request", () => {
    expect(decideJoin("limbe", [])).toEqual({ kind: "create" });
  });

  it("creates it even with history at other clubs that is over", () => {
    expect(
      decideJoin("limbe", [held("buea", "LEFT"), held("douala", "REMOVED")]),
    ).toEqual({ kind: "create" });
  });
});

describe("entering it again for the same club", () => {
  it("is a no-op while the patron has not decided", () => {
    // The promise the pending screen makes — "there is nothing else for you to
    // do" — is only true if this does not become a second request.
    expect(decideJoin("limbe", [held("limbe", "PENDING")])).toEqual({
      kind: "already",
      status: "PENDING",
    });
  });

  it("is a no-op once they are in", () => {
    expect(decideJoin("limbe", [held("limbe", "ACTIVE")])).toEqual({
      kind: "already",
      status: "ACTIVE",
    });
  });

  it("revives a request that was declined", () => {
    // A patron who declines a student they did not recognise, and then meets
    // them, must be able to admit them. The row is REMOVED, not gone.
    expect(decideJoin("limbe", [held("limbe", "REMOVED")])).toEqual({ kind: "revive" });
  });

  it("revives a membership somebody left", () => {
    expect(decideJoin("limbe", [held("limbe", "LEFT")])).toEqual({ kind: "revive" });
  });
});

describe("what another club blocks", () => {
  it("refuses while they are active somewhere else, and names it", () => {
    // Not a preference: one ACTIVE membership per user is a partial unique
    // index. Refusing here is the only place a person can be told why — the
    // alternative is a patron pressing admit and getting a database error.
    expect(decideJoin("limbe", [held("buea", "ACTIVE", "GBHS Buea")])).toEqual({
      kind: "refuse",
      reason: "active-elsewhere",
      clubName: "GBHS Buea",
    });
  });

  it("refuses while another patron has not answered yet", () => {
    expect(decideJoin("limbe", [held("buea", "PENDING", "GBHS Buea")])).toEqual({
      kind: "refuse",
      reason: "pending-elsewhere",
      clubName: "GBHS Buea",
    });
  });

  it("lets this club win over any other row", () => {
    // The case the branch order exists for. Someone ACTIVE at Limbe who also
    // has a stale PENDING row at Buea must not be told they cannot join Limbe.
    expect(
      decideJoin("limbe", [held("limbe", "ACTIVE"), held("buea", "PENDING")]),
    ).toEqual({ kind: "already", status: "ACTIVE" });
    expect(
      decideJoin("limbe", [held("limbe", "PENDING"), held("buea", "ACTIVE")]),
    ).toEqual({ kind: "already", status: "PENDING" });
  });

  it("blocks a revival too, not just a first request", () => {
    // Rejoining a club you left is still a new ACTIVE membership eventually,
    // so it has to answer to the same index.
    expect(
      decideJoin("limbe", [held("limbe", "LEFT"), held("buea", "ACTIVE", "GBHS Buea")]),
    ).toEqual({ kind: "refuse", reason: "active-elsewhere", clubName: "GBHS Buea" });
  });
});
