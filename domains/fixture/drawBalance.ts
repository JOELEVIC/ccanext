/**
 * ══════════════════════════════════════════════════════════════════════════
 * Balancing home and away across a division draw.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Pure and dependency-free, tested like `scoring.ts` and `lifecycle.ts`.
 *
 * ── The problem this fixes ────────────────────────────────────────────────
 *
 * `roundRobinSchedule` balances **colours** — which side has White — and that
 * is the right thing for a tournament played in one room. A league is not
 * played in one room: the first-named club hosts, which means paying for a
 * hall and not paying for a bus.
 *
 * Run over five clubs the raw schedule produced home counts of
 * **0, 2, 2, 2, 4** — one club hosting every one of its matches and one
 * travelling to every one of theirs. For a school in Kumba playing a season
 * entirely away, that is a real transport bill and a reason to stop entering.
 *
 * The imbalance comes from the dummy used for an odd field: a club's bye
 * displaces it from the rotation and the alternation that would have evened
 * its hosting out.
 *
 * ── The approach ──────────────────────────────────────────────────────────
 *
 * A greedy pass in schedule order: for each tie, host it with whichever club
 * has hosted less so far. Ties in the tally keep the pairing engine's original
 * orientation, so the result is deterministic — the same draw twice produces
 * the same fixture list, which is what makes the draw script idempotent.
 *
 * Greedy rather than optimal on purpose. A perfect home/away assignment is a
 * constraint problem; this reaches a spread of at most one across every field
 * size a school league will ever have, and does it in a way that can be read
 * and checked by the person running the draw.
 */

export type DrawPairing = {
  /** The pairing engine's first-named club. Null opponent means a bye. */
  homeClubId: string;
  awayClubId: string | null;
};

/**
 * Reassign home and away so hosting is spread as evenly as the fixture list
 * allows. Byes pass through untouched — there is nothing to host.
 *
 * Rounds are processed in order and ties within a round in order, so the
 * output is a deterministic function of the input.
 */
export function balanceHomeAway(rounds: DrawPairing[][]): DrawPairing[][] {
  const hosted = new Map<string, number>();
  const bump = (id: string) => hosted.set(id, (hosted.get(id) ?? 0) + 1);
  const count = (id: string) => hosted.get(id) ?? 0;

  return rounds.map((round) =>
    round.map((tie) => {
      if (!tie.awayClubId) return tie;

      const { homeClubId: a, awayClubId: b } = tie;
      // Strictly fewer, not fewer-or-equal: on a tie the engine's own
      // orientation stands, which keeps the result stable across runs.
      const swap = count(b) < count(a);
      const home = swap ? b : a;
      const away = swap ? a : b;

      bump(home);
      return { homeClubId: home, awayClubId: away };
    })
  );
}

/** How many times each club hosts. For reporting and for the tests. */
export function homeCounts(rounds: DrawPairing[][]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const round of rounds) {
    for (const tie of round) {
      if (!tie.awayClubId) continue;
      counts.set(tie.homeClubId, (counts.get(tie.homeClubId) ?? 0) + 1);
      // An away side still needs an entry, or a club that never hosts is
      // invisible to a spread check — which is exactly the case that went
      // unnoticed in the first draw.
      if (!counts.has(tie.awayClubId)) counts.set(tie.awayClubId, 0);
    }
  }
  return counts;
}

/** The gap between the club that hosts most and the one that hosts least. */
export function hostingSpread(rounds: DrawPairing[][]): number {
  const values = [...homeCounts(rounds).values()];
  if (values.length === 0) return 0;
  return Math.max(...values) - Math.min(...values);
}
