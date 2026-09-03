/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Minting a club's join code.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lifted out of `scripts/onboard-clubs.ts`, which was the only place a club
 * could be created and therefore the only place a code was ever made. Now that
 * staff can create a club from the console, the alphabet and the shape have to
 * be one thing both callers share — two generators would eventually disagree
 * about which characters are safe, and the whole point of the alphabet is that
 * it is the same everywhere.
 *
 * ── The alphabet ─────────────────────────────────────────────────────────
 *
 * No 0/O and no 1/I/L: those are the pairs people get wrong reading a code off
 * a whiteboard, and a mistyped code is indistinguishable from a rejected one.
 * Six characters from thirty symbols is about 730 million combinations, which
 * is far more than guessing warrants — the code only ever creates a PENDING
 * membership a patron must then admit, so it is a convenience, not a
 * credential.
 */

export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;

/** The characters a person can confuse for one another, and so never used. */
export const EXCLUDED_CHARACTERS = "01OIL";

/**
 * One candidate code, from a supplied source of randomness.
 *
 * `random` is a parameter so the shape can be tested without a mock: a
 * generator that returned a code of the wrong length, or one containing a
 * zero, would be caught by a run of real `randomInt` only by luck.
 */
export function makeJoinCode(random: (bound: number) => number): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[random(CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Whether a string is a code this system could have minted.
 *
 * Used to reject an operator's hand-typed code before it reaches the database,
 * where the only thing waiting is a unique-constraint error that says nothing
 * about why. A code containing an O is not a near miss — it is a code somebody
 * will read aloud as a zero.
 */
export function joinCodeProblem(code: string): "length" | "alphabet" | null {
  if (code.length !== CODE_LENGTH) return "length";
  for (const character of code) {
    if (!CODE_ALPHABET.includes(character)) return "alphabet";
  }
  return null;
}

/** A URL-safe slug from a club's name: "GBHS Limbe" -> "gbhs-limbe". */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    // Strip the accents rather than the letters: "Lycée" must become "lycee",
    // not "lyce".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * The first slug in the `base`, `base-2`, `base-3` … series that nothing has
 * taken.
 *
 * Two schools in Cameroon are called "GBHS Limbe" often enough that this is a
 * normal case rather than a collision to be surprised by. The suffix starts at
 * 2 because the first one is not "gbhs-limbe-1" — it is the club that got
 * there first, and renumbering it would break its public URL.
 */
export function nextFreeSlug(base: string, taken: ReadonlySet<string>): string {
  const root = base || "club";
  if (!taken.has(root)) return root;
  for (let n = 2; n < 500; n += 1) {
    const candidate = `${root}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Could not find a free slug for "${root}"`);
}
