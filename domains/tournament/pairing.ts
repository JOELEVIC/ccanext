/**
 * Tournament pairing engine — pure functions, no I/O, so they're easy to test.
 *
 * Formats:
 *  • ARENA       — continuous re-pairing of whoever is free; closest score/rating,
 *                  avoid an immediate rematch.
 *  • SWISS       — score-group pairing: sort by score then rating, pair players who
 *                  haven't met, balance colours, give the odd one out a bye.
 *  • ROUND_ROBIN — circle method (Berger): a fixed schedule where everyone meets once.
 *  • KNOCKOUT    — seeded single-elimination bracket; top seeds get byes to fill the
 *                  bracket to a power of two.
 *
 * Tiebreaks: Buchholz (sum of opponents' scores) and Sonneborn-Berger (score-weighted
 * by opponents' scores).
 */

export type Color = "w" | "b";

export interface PlayerState {
  userId: string;
  rating: number;
  score: number;
  colorHistory: Color[];
  opponentIds: string[];
  byes: number;
  withdrawn?: boolean;
}

export interface Pairing {
  whiteUserId: string;
  /** null = a bye for whiteUserId. */
  blackUserId: string | null;
}

const active = (players: PlayerState[]) => players.filter((p) => !p.withdrawn);

/** Color balance: #whites − #blacks. Negative ⇒ "due" a white. */
function colorBalance(p: PlayerState): number {
  let bal = 0;
  for (const c of p.colorHistory) bal += c === "w" ? 1 : -1;
  return bal;
}

/** Decide colors for a pair: the player more "due" white (lower balance) gets white. */
function assignColors(a: PlayerState, b: PlayerState): Pairing {
  const ba = colorBalance(a);
  const bb = colorBalance(b);
  if (ba !== bb) {
    return ba < bb
      ? { whiteUserId: a.userId, blackUserId: b.userId }
      : { whiteUserId: b.userId, blackUserId: a.userId };
  }
  // Equal balance: alternate from each player's last colour if possible, else seed.
  const lastA = a.colorHistory[a.colorHistory.length - 1];
  if (lastA === "w") return { whiteUserId: b.userId, blackUserId: a.userId };
  if (lastA === "b") return { whiteUserId: a.userId, blackUserId: b.userId };
  // No history: higher rating takes white.
  return a.rating >= b.rating
    ? { whiteUserId: a.userId, blackUserId: b.userId }
    : { whiteUserId: b.userId, blackUserId: a.userId };
}

const byScoreThenRating = (a: PlayerState, b: PlayerState) =>
  b.score - a.score || b.rating - a.rating;

// ── SWISS ─────────────────────────────────────────────────────────────────────

/**
 * One Swiss round. Greedy score-group pairing: walk the standings top-down, pair
 * each unpaired player with the nearest unpaired player they haven't faced (and,
 * where possible, one who keeps colours balanced). The odd player out gets a bye
 * (preferring someone who hasn't had one). Falls back to allowing a rematch only
 * if there is genuinely no fresh opponent, so it never deadlocks.
 */
export function swissPairings(players: PlayerState[]): Pairing[] {
  const field = active(players).slice().sort(byScoreThenRating);
  const pairings: Pairing[] = [];

  // Bye first (odd field): lowest-ranked player with the fewest byes.
  let pool = field;
  if (pool.length % 2 === 1) {
    const byeCandidate = [...pool].sort((a, b) => a.byes - b.byes || byScoreThenRating(b, a))[0];
    pairings.push({ whiteUserId: byeCandidate.userId, blackUserId: null });
    pool = pool.filter((p) => p.userId !== byeCandidate.userId);
  }

  const used = new Set<string>();
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i];
    if (used.has(a.userId)) continue;
    // Prefer a not-yet-faced opponent; remember a fallback in case all are repeats.
    let opp: PlayerState | undefined;
    let fallback: PlayerState | undefined;
    for (let j = i + 1; j < pool.length; j++) {
      const b = pool[j];
      if (used.has(b.userId)) continue;
      if (!fallback) fallback = b;
      if (!a.opponentIds.includes(b.userId)) {
        opp = b;
        break;
      }
    }
    const chosen = opp ?? fallback;
    if (!chosen) continue; // a is the last one left (shouldn't happen with even pool)
    used.add(a.userId);
    used.add(chosen.userId);
    pairings.push(assignColors(a, chosen));
  }
  return pairings;
}

// ── ARENA ─────────────────────────────────────────────────────────────────────

/**
 * Pair whoever is currently free. Closest score/rating, skipping an immediate
 * rematch with the most recent opponent. Leftover player waits for the next cycle.
 */
export function arenaPairings(freePlayers: PlayerState[]): Pairing[] {
  const pool = active(freePlayers).slice().sort(byScoreThenRating);
  const used = new Set<string>();
  const pairings: Pairing[] = [];
  for (let i = 0; i < pool.length; i++) {
    const a = pool[i];
    if (used.has(a.userId)) continue;
    const lastOpp = a.opponentIds[a.opponentIds.length - 1];
    let opp: PlayerState | undefined;
    let fallback: PlayerState | undefined;
    for (let j = i + 1; j < pool.length; j++) {
      const b = pool[j];
      if (used.has(b.userId)) continue;
      if (!fallback) fallback = b;
      if (b.userId !== lastOpp) {
        opp = b;
        break;
      }
    }
    const chosen = opp ?? fallback;
    if (!chosen) continue; // odd one out waits
    used.add(a.userId);
    used.add(chosen.userId);
    pairings.push(assignColors(a, chosen));
  }
  return pairings;
}

// ── ROUND ROBIN (Berger / circle method) ───────────────────────────────────────

/**
 * Full schedule: rounds[r] is the list of pairings for round r (0-based). Uses the
 * circle method with a dummy for odd fields (dummy ⇒ that player has a bye).
 * Colours alternate so each player gets a balanced split.
 */
export function roundRobinSchedule(playerIds: string[]): Pairing[][] {
  const ids = playerIds.slice();
  const hasDummy = ids.length % 2 === 1;
  if (hasDummy) ids.push("__BYE__");
  const n = ids.length;
  const rounds: Pairing[][] = [];
  const arr = ids.slice();

  for (let r = 0; r < n - 1; r++) {
    const round: Pairing[] = [];
    for (let i = 0; i < n / 2; i++) {
      const p1 = arr[i];
      const p2 = arr[n - 1 - i];
      if (p1 === "__BYE__" || p2 === "__BYE__") {
        const real = p1 === "__BYE__" ? p2 : p1;
        round.push({ whiteUserId: real, blackUserId: null });
      } else {
        // Alternate colours by round + board so the split stays balanced.
        const whiteFirst = (r + i) % 2 === 0;
        round.push(
          whiteFirst
            ? { whiteUserId: p1, blackUserId: p2 }
            : { whiteUserId: p2, blackUserId: p1 }
        );
      }
    }
    rounds.push(round);
    // Rotate all but the first element.
    arr.splice(1, 0, arr.pop()!);
  }
  return rounds;
}

// ── KNOCKOUT (seeded single elimination) ────────────────────────────────────────

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Standard 1-seed-meets-last-seed bracket order for a bracket of size `size`. */
function seedOrder(size: number): number[] {
  let rounds = [1, 2];
  while (rounds.length < size) {
    const next: number[] = [];
    const sum = rounds.length * 2 + 1;
    for (const s of rounds) {
      next.push(s);
      next.push(sum - s);
    }
    rounds = next;
  }
  return rounds; // values are 1-based seeds; some may exceed the real field (byes)
}

/**
 * First knockout round. Players are seeded by rating; the bracket is padded to a
 * power of two with byes, and the top seeds receive those byes.
 */
export function knockoutFirstRound(players: PlayerState[]): Pairing[] {
  const seeds = active(players)
    .slice()
    .sort((a, b) => b.rating - a.rating);
  const size = nextPowerOfTwo(Math.max(2, seeds.length));
  const order = seedOrder(size); // e.g. size 8 → [1,8,4,5,2,7,3,6]
  const pairings: Pairing[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const sHigh = order[i] - 1; // 0-based seed index
    const sLow = order[i + 1] - 1;
    const a = seeds[sHigh];
    const b = seeds[sLow];
    if (a && b) pairings.push(assignColors(a, b));
    else if (a && !b) pairings.push({ whiteUserId: a.userId, blackUserId: null }); // bye
  }
  return pairings;
}

/** Pair the round's winners (already in bracket order) for the next knockout round. */
export function knockoutNextRound(advancing: PlayerState[]): Pairing[] {
  const pairings: Pairing[] = [];
  for (let i = 0; i < advancing.length; i += 2) {
    const a = advancing[i];
    const b = advancing[i + 1];
    if (a && b) pairings.push(assignColors(a, b));
    else if (a) pairings.push({ whiteUserId: a.userId, blackUserId: null });
  }
  return pairings;
}

// ── TIEBREAKS ───────────────────────────────────────────────────────────────────

export interface ResultRecord {
  userId: string;
  opponentId: string;
  /** From userId's perspective: 1 win, 0.5 draw, 0 loss. */
  score: number;
}

export interface Tiebreaks {
  buchholz: number;
  sonnebornBerger: number;
}

/**
 * Buchholz   = Σ (final score of each opponent faced).
 * Sonneborn-Berger = Σ (your result vs opponent × that opponent's final score).
 */
export function computeTiebreaks(
  standings: { userId: string; score: number }[],
  results: ResultRecord[]
): Map<string, Tiebreaks> {
  const scoreOf = new Map(standings.map((s) => [s.userId, s.score]));
  const out = new Map<string, Tiebreaks>();
  for (const s of standings) out.set(s.userId, { buchholz: 0, sonnebornBerger: 0 });
  for (const r of results) {
    const tb = out.get(r.userId);
    if (!tb) continue;
    const oppScore = scoreOf.get(r.opponentId) ?? 0;
    tb.buchholz += oppScore;
    tb.sonnebornBerger += r.score * oppScore;
  }
  return out;
}

/** Recommended number of Swiss rounds for a field of `n` (ceil(log2 n), min 3, cap 9). */
export function recommendedSwissRounds(n: number): number {
  if (n < 2) return 1;
  return Math.min(9, Math.max(3, Math.ceil(Math.log2(n))));
}
