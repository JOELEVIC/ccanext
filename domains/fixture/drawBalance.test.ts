import { describe, expect, it } from "vitest";

import { roundRobinSchedule } from "../tournament/pairing";
import { balanceHomeAway, homeCounts, hostingSpread, type DrawPairing } from "./drawBalance";

/** The draw script's shape: the pairing engine's output as home/away ties. */
function drawFor(clubCount: number): DrawPairing[][] {
  const ids = Array.from({ length: clubCount }, (_, i) => `c${i + 1}`);
  return roundRobinSchedule(ids).map((round) =>
    round.map((p) => ({ homeClubId: p.whiteUserId, awayClubId: p.blackUserId }))
  );
}

describe("balanceHomeAway", () => {
  it("fixes the five-club draw that was 0 to 4", () => {
    const raw = drawFor(5);
    // The bug, asserted so a regression in the pairing engine is visible here.
    expect(hostingSpread(raw)).toBeGreaterThan(1);

    const balanced = balanceHomeAway(raw);
    expect(hostingSpread(balanced)).toBeLessThanOrEqual(1);
  });

  it("keeps hosting within one across every realistic division size", () => {
    // A catchment division is 3 to 12 clubs. Both parities matter: an odd
    // field carries a bye, which is what unbalanced the raw schedule.
    for (let n = 3; n <= 12; n += 1) {
      const balanced = balanceHomeAway(drawFor(n));
      expect(hostingSpread(balanced), `division of ${n}`).toBeLessThanOrEqual(1);
    }
  });

  it("never invents, drops or reverses a pairing", () => {
    const raw = drawFor(7);
    const balanced = balanceHomeAway(raw);

    const key = (t: DrawPairing) =>
      [t.homeClubId, t.awayClubId ?? "BYE"].sort().join("|");
    const before = raw.flat().map(key).sort();
    const after = balanced.flat().map(key).sort();

    // Same ties, same byes, same rounds — only which side hosts changes.
    expect(after).toEqual(before);
    expect(balanced.map((r) => r.length)).toEqual(raw.map((r) => r.length));
  });

  it("leaves byes alone", () => {
    const balanced = balanceHomeAway(drawFor(5));
    const byes = balanced.flat().filter((t) => t.awayClubId === null);
    // Five clubs, five rounds, one bye each.
    expect(byes).toHaveLength(5);
    expect(new Set(byes.map((b) => b.homeClubId)).size).toBe(5);
  });

  it("is deterministic — the same draw twice is the same fixture list", () => {
    // This is what makes the draw script idempotent: re-running must move a
    // date without reassigning who hosts.
    const a = balanceHomeAway(drawFor(6));
    const b = balanceHomeAway(drawFor(6));
    expect(b).toEqual(a);
  });

  it("counts a club that never hosts", () => {
    const counts = homeCounts([
      [{ homeClubId: "a", awayClubId: "b" }],
      [{ homeClubId: "a", awayClubId: "b" }],
    ]);
    // "b" hosting zero times must be a zero, not an absence — an absence is
    // how the original imbalance hid from a spread check.
    expect(counts.get("b")).toBe(0);
    expect(hostingSpread([[{ homeClubId: "a", awayClubId: "b" }]])).toBe(1);
  });
});
